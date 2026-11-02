import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { connectors } from "@/db/schema";
import { getDb } from "@/db";
import { publicError, runtimeOwnerId, safeUrl } from "@/lib/runtime";

type InvokePayload = { input?: unknown };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const connectorId = Number(id);
    if (!Number.isSafeInteger(connectorId) || connectorId < 1) {
      return Response.json({ error: "Conector no válido." }, { status: 400 });
    }
    const ownerId = await runtimeOwnerId();
    const [connector] = await getDb().select().from(connectors).where(and(eq(connectors.id, connectorId), eq(connectors.ownerId, ownerId))).limit(1);
    if (!connector) return Response.json({ error: "No se encontró el conector." }, { status: 404 });

    const url = safeUrl(connector.endpoint);
    const payload = (await request.json().catch(() => ({}))) as InvokePayload;
    const input = payload.input && typeof payload.input === "object" ? payload.input : {};
    const headers = new Headers({ Accept: "application/json" });
    const runtimeSecrets = env as unknown as Record<string, string | undefined>;
    const secret = connector.secretRef ? runtimeSecrets[connector.secretRef] : undefined;

    if (connector.authMode !== "none" && !secret) {
      return Response.json({ error: `Falta el secreto de entorno ${connector.secretRef}.` }, { status: 412 });
    }
    if (connector.authMode === "bearer" && secret) headers.set("Authorization", `Bearer ${secret}`);
    if (connector.authMode === "api_key" && secret) headers.set("X-API-Key", secret);

    if (connector.method === "GET") {
      for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") url.searchParams.set(key, String(value));
      }
    } else {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(url.toString(), {
      method: connector.method,
      headers,
      body: connector.method === "POST" ? JSON.stringify(input) : undefined,
      redirect: "error",
    });
    const responseText = (await response.text()).slice(0, 32000);
    const contentType = response.headers.get("content-type") || "text/plain";
    return Response.json({
      ok: response.ok,
      status: response.status,
      contentType,
      data: responseText,
      connector: connector.name,
    }, { status: response.ok ? 200 : 502 });
  } catch (error) {
    return Response.json({ error: publicError(error) }, { status: 400 });
  }
}
