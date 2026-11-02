import { env } from "cloudflare:workers";

const fallbackModels = [
  { id: "openai/gpt-5.2", name: "GPT-5.2", context_length: 400000 },
  { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6", context_length: 200000 },
  { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", context_length: 1000000 },
  { id: "deepseek/deepseek-v3.2", name: "DeepSeek V3.2", context_length: 128000 },
];

export async function GET() {
  const apiKey = (env as unknown as Record<string, string | undefined>).OPENROUTER_API_KEY;
  if (!apiKey) return Response.json({ models: fallbackModels, source: "curated" });

  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      cf: { cacheTtl: 600, cacheEverything: true },
    });
    if (!response.ok) throw new Error("Model catalog unavailable");

    const payload = (await response.json()) as {
      data?: Array<{ id?: string; name?: string; context_length?: number }>;
    };
    const models = (payload.data ?? [])
      .filter((model) => model.id && model.name)
      .slice(0, 250)
      .map((model) => ({
        id: model.id as string,
        name: model.name as string,
        context_length: model.context_length ?? null,
      }));

    return Response.json({ models: models.length ? models : fallbackModels, source: "openrouter" });
  } catch {
    return Response.json({ models: fallbackModels, source: "curated" });
  }
}
