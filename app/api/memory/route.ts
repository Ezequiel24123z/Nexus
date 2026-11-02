import { desc, eq } from "drizzle-orm";
import { memories } from "@/db/schema";
import { getDb } from "@/db";
import { boundedText, nowIso, publicError, runtimeOwnerId } from "@/lib/runtime";

export async function GET() {
  try {
    const ownerId = await runtimeOwnerId();
    const rows = await getDb().select().from(memories).where(eq(memories.ownerId, ownerId)).orderBy(desc(memories.createdAt)).limit(30);
    return Response.json({ memories: rows });
  } catch (error) {
    return Response.json({ memories: [], unavailable: publicError(error) });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const content = boundedText(payload.content, 5000);
    const namespace = boundedText(payload.namespace, 60) || "operating-context";
    if (!content) return Response.json({ error: "No hay contexto para guardar." }, { status: 400 });
    const [memory] = await getDb().insert(memories).values({
      ownerId: await runtimeOwnerId(), namespace, content, source: "operator", createdAt: nowIso(),
    }).returning();
    return Response.json({ memory }, { status: 201 });
  } catch (error) {
    return Response.json({ error: publicError(error) }, { status: 400 });
  }
}
