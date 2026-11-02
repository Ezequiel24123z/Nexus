import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { agentRuns } from "@/db/schema";
import { getDb } from "@/db";
import { boundedText, nowIso, runtimeOwnerId } from "@/lib/runtime";

type AgentPayload = {
  prompt?: string;
  model?: string;
  temperature?: number;
  plugins?: string[];
  mode?: "execute" | "plan" | "structured";
};

const systemPrompt = `Eres NEXUS, un operador agentic riguroso. Trabajas con el usuario para producir resultados verificables. Antes de tomar acciones externas, enumera la acción, el sistema de destino y el impacto; pide aprobación si puede cambiar datos o enviar información. Separa hechos, hipótesis y próximos pasos. Mantén respuestas claras, accionables y compactas.`;

function supportedPlugins(selected: string[]) {
  return selected
    .filter((name) => ["web", "file-parser", "response-healing", "context-compression"].includes(name))
    .map((id) => ({ id }));
}

export async function POST(request: Request) {
  const payload = (await request.json()) as AgentPayload;
  const prompt = boundedText(payload.prompt, 16000);
  const model = boundedText(payload.model, 180) || "openai/gpt-5.2";
  const mode = payload.mode ?? "execute";
  const selectedPlugins = Array.isArray(payload.plugins) ? payload.plugins : [];

  if (!prompt) return Response.json({ error: "Describe una misión antes de ejecutarla." }, { status: 400 });

  const ownerId = await runtimeOwnerId();
  const createdAt = nowIso();
  let runId: number | null = null;
  try {
    const [run] = await getDb()
      .insert(agentRuns)
      .values({
        ownerId,
        title: prompt.slice(0, 72),
        model,
        status: "running",
        inputSummary: prompt.slice(0, 1200),
        outputSummary: "",
        toolSummary: JSON.stringify(selectedPlugins),
        createdAt,
      })
      .returning({ id: agentRuns.id });
    runId = run?.id ?? null;
  } catch {
    // D1 is intentionally non-blocking for a single live run.
  }

  const apiKey = (env as unknown as Record<string, string | undefined>).OPENROUTER_API_KEY;
  if (!apiKey) {
    const setupMessage = "NEXUS está listo para planificar, pero falta conectar OPENROUTER_API_KEY en los secretos del entorno. La clave se mantiene solo en el servidor; cuando la configures, esta misma misión se enviará al modelo seleccionado sin cambios en el navegador.";
    return Response.json({
      runId,
      status: "needs_configuration",
      content: setupMessage,
      model,
      approvals: [],
      usage: null,
    });
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-OpenRouter-Title": "NEXUS Operator",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        temperature: Math.min(Math.max(Number(payload.temperature) || 0.3, 0), 2),
        plugins: supportedPlugins(selectedPlugins),
        response_format: mode === "structured" ? { type: "json_object" } : undefined,
      }),
    });
    const result = (await response.json()) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      model?: string;
    };

    if (!response.ok) {
      throw new Error(result.error?.message || "OpenRouter no pudo completar la misión.");
    }

    const content = result.choices?.[0]?.message?.content?.trim() || "El modelo no devolvió contenido.";
    if (runId) {
      try {
        await getDb().update(agentRuns).set({ status: "complete", outputSummary: content.slice(0, 5000) }).where(eq(agentRuns.id, runId));
      } catch {
        // The result remains usable even when durable history is temporarily unavailable.
      }
    }

    return Response.json({
      runId,
      status: "complete",
      content,
      model: result.model ?? model,
      approvals: [],
      usage: result.usage ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo completar la misión.";
    if (runId) {
      try {
        await getDb().update(agentRuns).set({ status: "failed", outputSummary: message }).where(eq(agentRuns.id, runId));
      } catch {
        // Ignore persistence failure here; the caller still receives the original error.
      }
    }
    return Response.json({ error: message, runId }, { status: 502 });
  }
}
