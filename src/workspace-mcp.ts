import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { db, getWorkspace, listWorkspaceScans, createExperiment } from "./workspaces.js";
import { saveInsight } from "./decisions.js";

function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function sharePreview(workspaceId: string) {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) throw new Error("Workspace not found.");
  const snapshot = { profile: workspace.profile, evidence: listWorkspaceScans(workspaceId).map(scan => ({
    runId: scan.run_id, brand: scan.bundle.brand, generatedAt: scan.bundle.generatedAt,
    evidence: scan.bundle.evidence.map(({ id, title, kind, url, observedAt }) => ({ id, title, kind, url, observedAt })),
    unknowns: scan.bundle.unknowns,
  })) };
  return { snapshot, hash: digest(JSON.stringify(snapshot)) };
}
export function createShare(workspaceId: string, expectedHash: string) {
  const current = sharePreview(workspaceId);
  if (current.hash !== expectedHash) throw new Error("The workspace changed. Review the updated preview.");
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db().prepare("INSERT INTO mcp_shares VALUES (?, ?, ?, ?, ?)").run(id, workspaceId, digest(token), JSON.stringify(current.snapshot), expires);
  return { id, token, expires };
}
function resolveShare(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid or expired share.");
  const row = db().prepare("SELECT workspace_id, snapshot FROM mcp_shares WHERE token_hash = ? AND expires_at > ?").get(digest(token), new Date().toISOString());
  if (!row) throw new Error("Invalid or expired share.");
  return { workspaceId: String(row.workspace_id), snapshot: JSON.parse(String(row.snapshot)) };
}
export function sharedSummary(token: string) { return resolveShare(token).snapshot; }
const draftSchema = z.object({ kind: z.enum(["insight", "experiment"]), data: z.record(z.string(), z.unknown()) });
export function addMcpDraft(token: string, input: unknown) {
  const { workspaceId } = resolveShare(token);
  const draft = draftSchema.parse(input);
  if (JSON.stringify(draft.data).length > 20_000) throw new Error("Draft is too large.");
  const id = randomUUID();
  db().prepare("INSERT INTO mcp_drafts VALUES (?, ?, ?, ?, ?)").run(id, workspaceId, draft.kind, JSON.stringify(draft.data), new Date().toISOString());
  return id;
}
export function revokeShare(workspaceId: string, id: string) {
  return db().prepare("DELETE FROM mcp_shares WHERE workspace_id = ? AND id = ?").run(workspaceId, id).changes > 0;
}
export function listShares(workspaceId: string) {
  return db().prepare("SELECT id, expires_at FROM mcp_shares WHERE workspace_id = ? AND expires_at > ? ORDER BY expires_at DESC").all(workspaceId, new Date().toISOString());
}
export function listMcpDrafts(workspaceId: string) {
  return db().prepare("SELECT id, kind, data, created_at FROM mcp_drafts WHERE workspace_id = ? ORDER BY created_at DESC").all(workspaceId)
    .map(row => ({ id: row.id, kind: row.kind, data: JSON.parse(String(row.data)), createdAt: row.created_at }));
}
export function removeMcpDraft(workspaceId: string, id: string) {
  return db().prepare("DELETE FROM mcp_drafts WHERE workspace_id = ? AND id = ?").run(workspaceId, id).changes > 0;
}
export function acceptMcpDraft(workspaceId: string, id: string, data: unknown) {
  const row = db().prepare("SELECT kind FROM mcp_drafts WHERE workspace_id = ? AND id = ?").get(workspaceId, id);
  if (!row) throw new Error("Draft not found.");
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = row.kind === "insight" ? saveInsight(workspaceId, data) : createExperiment(workspaceId, data);
    removeMcpDraft(workspaceId, id);
    database.exec("COMMIT");
    return result;
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}
