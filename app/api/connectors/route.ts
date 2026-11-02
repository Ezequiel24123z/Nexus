import { desc, eq } from "drizzle-orm";
import { connectors } from "@/db/schema";
import { getDb } from "@/db";
import { boundedText, nowIso, publicError, runtimeOwnerId, safeUrl } from "@/lib/runtime";

export async function GET() {
  try {
    const ownerId = await runtimeOwnerId();
    const rows = await getDb().select().from(connectors).where(eq(connectors.ownerId, ownerId)).orderBy(desc(connectors.updatedAt));
    return Response.json({ connectors: rows });
  } catch (error) {
    return Response.json({ connectors: [], unavailable: publicError(error) });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const name = boundedText(payload.name, 80);
    const endpoint = boundedText(payload.endpoint, 1400);
    const description = boundedText(payload.description, 400);
    const method = payload.method === "POST" ? "POST" : "GET";
    const authMode = ["none", "bearer", "api_key"].includes(String(payload.authMode)) ? String(payload.authMode) : "none";
    const secretRef = boundedText(payload.secretRef, 64);

    if (!name || !endpoint) return Response.json({ error: "El nombre y el endpoint son obligatorios." }, { status: 400 });
    safeUrl(endpoint);
    if (authMode !== "none" && !/^[A-Z][A-Z0-9_]{2,63}$/.test(secretRef)) {
      return Response.json({ error: "Usa un nombre de secreto de entorno válido, por ejemplo CONNECTOR_GITHUB_TOKEN." }, { status: 400 });
    }

    const ownerId = await runtimeOwnerId();
    const timestamp = nowIso();
    const [connector] = await getDb().insert(connectors).values({
      ownerId, name, endpoint, method, authMode, secretRef: secretRef || null, description, createdAt: timestamp, updatedAt: timestamp,
    }).returning();
    return Response.json({ connector }, { status: 201 });
  } catch (error) {
    return Response.json({ error: publicError(error) }, { status: 400 });
  }
}
