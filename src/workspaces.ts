import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { EvidenceBundle } from "./index.js";

const text = z.string().trim().max(4000);
const website = text.min(1).refine(value => {
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname.includes("."));
  } catch {
    return false;
  }
}, "Enter a valid website.");
export const profileSchema = z.object({
  name: text.min(1), website, goal: text.min(1), question: text.min(1),
  product: text.default(""), category: text.default(""), market: text.default(""),
  location: text.default(""), audience: text.default(""), problem: text.default(""),
  positioning: text.default(""), alternatives: text.default(""), channels: text.default(""),
  constraints: text.default(""), metric: text.default(""), baseline: text.default(""),
  competitors: z.array(text.min(1)).max(50).default([]),
});
export const experimentSchema = z.object({
  hypothesis: text.min(1), audience: text.default(""), channel: text.default(""),
  treatment: text.default(""), comparison: text.default(""), metric: text.default(""),
  guardrail: text.default(""), baseline: text.default(""), owner: text.default(""),
  startDate: text.default(""), endDate: text.default(""), reviewDate: text.default(""),
  budget: text.default(""), status: z.enum(["planned", "running", "paused", "complete"]).default("planned"),
  result: text.default(""), learning: text.default(""), evidence: text.default(""),
});

let database: DatabaseSync | undefined;
function db(): DatabaseSync {
  if (database) return database;
  const dir = process.env.MARKETERS_EYE_DATA_DIR || join(homedir(), ".local", "share", "marketers-eye");
  mkdirSync(dir, { recursive: true });
  database = new DatabaseSync(join(dir, "workspace.sqlite"));
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY, profile TEXT NOT NULL, revision INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspace_scans (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      run_id TEXT NOT NULL, bundle TEXT NOT NULL, attached_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, run_id)
    );
    CREATE TABLE IF NOT EXISTS experiments (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      data TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  return database;
}

function decode(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  return { id: String(row.id), revision: Number(row.revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at), profile: profileSchema.parse(JSON.parse(String(row.profile))) };
}

export function listWorkspaces() {
  return db().prepare("SELECT * FROM workspaces ORDER BY updated_at DESC").all().map(decode);
}
export function getWorkspace(id: string) {
  return decode(db().prepare("SELECT * FROM workspaces WHERE id = ?").get(id));
}
export function createWorkspace(input: unknown) {
  const profile = profileSchema.parse(input);
  const id = randomUUID();
  const now = new Date().toISOString();
  db().prepare("INSERT INTO workspaces VALUES (?, ?, 1, ?, ?)").run(id, JSON.stringify(profile), now, now);
  return getWorkspace(id);
}
export function updateWorkspace(id: string, revision: number, input: unknown) {
  const profile = profileSchema.parse(input);
  const result = db().prepare("UPDATE workspaces SET profile = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?")
    .run(JSON.stringify(profile), new Date().toISOString(), id, revision);
  if (!result.changes) throw new Error("Workspace changed or was not found. Refresh before saving.");
  return getWorkspace(id);
}
export function attachScan(workspaceId: string, runId: string, bundle: EvidenceBundle) {
  db().prepare("INSERT OR IGNORE INTO workspace_scans VALUES (?, ?, ?, ?)")
    .run(workspaceId, runId, JSON.stringify(bundle), new Date().toISOString());
}
export function listWorkspaceScans(workspaceId: string) {
  return db().prepare("SELECT run_id, bundle, attached_at FROM workspace_scans WHERE workspace_id = ? ORDER BY attached_at DESC")
    .all(workspaceId).map(row => ({ ...row, bundle: JSON.parse(String(row.bundle)) }));
}
export function listExperiments(workspaceId: string) {
  return db().prepare("SELECT * FROM experiments WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspaceId)
    .map(row => ({ ...row, data: JSON.parse(String(row.data)) }));
}
export function createExperiment(workspaceId: string, input: unknown) {
  const data = experimentSchema.parse(input);
  if (data.status !== "planned") throw new Error("New experiments must begin as planned.");
  const id = randomUUID();
  db().prepare("INSERT INTO experiments VALUES (?, ?, ?, 1, ?)")
    .run(id, workspaceId, JSON.stringify(data), new Date().toISOString());
  return id;
}
export function updateExperiment(workspaceId: string, id: string, revision: number, input: unknown) {
  const data = experimentSchema.parse(input);
  const row = db().prepare("SELECT data, revision FROM experiments WHERE workspace_id = ? AND id = ?").get(workspaceId, id);
  if (!row || row.revision !== revision) throw new Error("Experiment changed or was not found. Refresh before saving.");
  const previous = experimentSchema.parse(JSON.parse(String(row.data)));
  const transitions: Record<string, string[]> = { planned: ["planned", "running"], running: ["running", "paused", "complete"], paused: ["paused", "running", "complete"], complete: ["complete"] };
  if (!transitions[previous.status]?.includes(data.status)) throw new Error("Invalid status transition.");
  if (data.status === "running" && (!data.treatment || !data.owner || !data.metric || !data.startDate || !data.reviewDate))
    throw new Error("Running experiments need a treatment, owner, metric, start date and review date.");
  if (data.status === "complete" && (!data.result || !data.learning)) throw new Error("Complete experiments need a result and learning.");
  const result = db().prepare("UPDATE experiments SET data = ?, revision = revision + 1, updated_at = ? WHERE workspace_id = ? AND id = ? AND revision = ?")
    .run(JSON.stringify(data), new Date().toISOString(), workspaceId, id, revision);
  if (!result.changes) throw new Error("Experiment changed. Refresh before saving.");
}
