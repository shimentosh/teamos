import { and, desc, eq, like, notLike } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { auth } from "../auth";
import db from "../database";
import { apikeyTable } from "../database/schema";
import { type AgentScope, permissionsFor } from "./scopes";

// Agent keys are ordinary API keys tagged in their metadata, so the REST API
// and MCP already accept them and enforce their permissions.
const AGENT_TAG = '%"kind":"agent"%';

function parseMetadata(raw: string | null): { scope?: AgentScope } {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    // Better Auth may store the metadata JSON-encoded twice.
    return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
  } catch {
    return {};
  }
}

export async function listAgentKeys(userId: string) {
  const rows = await db
    .select({
      id: apikeyTable.id,
      name: apikeyTable.name,
      start: apikeyTable.start,
      enabled: apikeyTable.enabled,
      metadata: apikeyTable.metadata,
      lastRequest: apikeyTable.lastRequest,
      createdAt: apikeyTable.createdAt,
    })
    .from(apikeyTable)
    .where(
      and(
        eq(apikeyTable.referenceId, userId),
        like(apikeyTable.metadata, AGENT_TAG),
        // One-request keys made by Ask TeamOS aren't the person's to manage.
        notLike(apikeyTable.metadata, '%"temporary":true%'),
      ),
    )
    .orderBy(desc(apikeyTable.createdAt));
  return rows.map((row) => ({
    id: row.id,
    name: row.name ?? "Claude",
    start: row.start,
    scope: parseMetadata(row.metadata).scope ?? "full",
    enabled: row.enabled !== false,
    lastUsedAt: row.lastRequest,
    createdAt: row.createdAt,
  }));
}

export async function createAgentKey(
  userId: string,
  input: { name?: string; scope: AgentScope },
) {
  const created = await auth.api.createApiKey({
    body: {
      userId,
      name: input.name?.trim() || "Claude",
      prefix: "tos_agent_",
      permissions: permissionsFor(input.scope),
      metadata: { kind: "agent", scope: input.scope },
      // Agents work in bursts (a triage run reads and writes dozens of
      // tasks); the default 100 a minute would stall them.
      rateLimitEnabled: true,
      rateLimitTimeWindow: 60_000,
      rateLimitMax: 600,
    },
  });
  if (!created?.key) {
    throw new HTTPException(500, { message: "Failed to create the key" });
  }
  return {
    id: created.id,
    key: created.key,
    name: created.name ?? "Claude",
    scope: input.scope,
  };
}

export async function revokeAgentKey(userId: string, id: string) {
  const [removed] = await db
    .delete(apikeyTable)
    .where(
      and(
        eq(apikeyTable.id, id),
        eq(apikeyTable.referenceId, userId),
        like(apikeyTable.metadata, AGENT_TAG),
      ),
    )
    .returning({ id: apikeyTable.id });
  if (!removed) throw new HTTPException(404, { message: "Key not found" });
  return { id: removed.id };
}

/** The kill switch: every agent key this person made stops working. */
export async function revokeAllAgentKeys(userId: string) {
  const removed = await db
    .delete(apikeyTable)
    .where(
      and(
        eq(apikeyTable.referenceId, userId),
        like(apikeyTable.metadata, AGENT_TAG),
      ),
    )
    .returning({ id: apikeyTable.id });
  return { revoked: removed.length };
}
