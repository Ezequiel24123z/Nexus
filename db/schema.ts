import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Credentials never live in this table. `secretRef` is the name of a server-side
 * runtime secret (for example, CONNECTOR_LINEAR_TOKEN) configured by the owner.
 */
export const connectors = sqliteTable(
  "connectors",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    endpoint: text("endpoint").notNull(),
    method: text("method").notNull().default("GET"),
    authMode: text("auth_mode").notNull().default("none"),
    secretRef: text("secret_ref"),
    description: text("description").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_connectors_owner_updated").on(table.ownerId, table.updatedAt)],
);

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    model: text("model").notNull(),
    status: text("status").notNull(),
    inputSummary: text("input_summary").notNull(),
    outputSummary: text("output_summary").notNull().default(""),
    toolSummary: text("tool_summary").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_agent_runs_owner_created").on(table.ownerId, table.createdAt)],
);

export const memories = sqliteTable(
  "memories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerId: text("owner_id").notNull(),
    namespace: text("namespace").notNull(),
    content: text("content").notNull(),
    source: text("source").notNull().default("operator"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_memories_owner_namespace").on(table.ownerId, table.namespace)],
);
