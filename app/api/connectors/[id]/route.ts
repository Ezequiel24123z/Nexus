import { and, eq } from "drizzle-orm";
import { connectors } from "@/db/schema";
import { getDb } from "@/db";
import { publicError, runtimeOwnerId } from "@/lib/runtime";

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const connectorId = Number(id);
    if (!Number.isSafeInteger(connectorId) || connectorId < 1) {
      return Response.json({ error: "Conector no válido." }, { status: 400 });
    }
    const ownerId = await runtimeOwnerId();
    await getDb().delete(connectors).where(and(eq(connectors.id, connectorId), eq(connectors.ownerId, ownerId)));
    return new Response(null, { status: 204 });
  } catch (error) {
    return Response.json({ error: publicError(error) }, { status: 400 });
  }
}
