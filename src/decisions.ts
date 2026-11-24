import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, getWorkspace, listExperiments, listWorkspaceScans } from "./workspaces.js";

const feedbackSchema = z.object({
  excerpt: z.string().trim().min(1).max(10000),
  source: z.string().trim().min(1).max(200),
  theme: z.string().trim().min(1).max(200),
});
const insightSchema = z.object({
  observation: z.string().trim().min(1).max(4000),
  interpretation: z.string().trim().min(1).max(4000),
  action: z.string().trim().min(1).max(4000),
  validation: z.string().trim().max(4000).default(""),
  confidence: z.enum(["Low", "Medium", "High"]),
  impact: z.enum(["Low", "Medium", "High"]),
  reasoning: z.string().trim().max(4000).default(""),
  status: z.enum(["active", "dismissed"]).default("active"),
  citations: z.array(z.object({ runId: z.string(), evidenceId: z.string() })).min(1),
});
export function listFeedback(id: string) {
  return db().prepare("SELECT id, excerpt, source, theme, created_at FROM feedback WHERE workspace_id = ? ORDER BY created_at DESC").all(id);
}
export function addFeedback(id: string, input: unknown) {
  const value = feedbackSchema.parse(input);
  const entry = randomUUID();
  db().prepare("INSERT INTO feedback VALUES (?, ?, ?, ?, ?, ?)").run(entry, id, value.excerpt, value.source, value.theme, new Date().toISOString());
  return entry;
}
export function removeFeedback(id: string, entry: string) {
  return db().prepare("DELETE FROM feedback WHERE workspace_id = ? AND id = ?").run(id, entry).changes > 0;
}
export function listInsights(id: string) {
  return db().prepare("SELECT id, data, revision, updated_at FROM insights WHERE workspace_id = ? ORDER BY updated_at DESC").all(id)
    .map(row => ({ ...row, data: insightSchema.parse(JSON.parse(String(row.data))) }));
}
export function saveInsight(id: string, input: unknown, insightId?: string, revision?: number) {
  const data = insightSchema.parse(input);
  const scans = listWorkspaceScans(id);
  for (const ref of data.citations) {
    const scan = scans.find(s => s.run_id === ref.runId);
    if (!scan?.bundle.evidence.some((entry: { id: string }) => entry.id === ref.evidenceId)) throw new Error("Evidence reference not found in this workspace.");
  }
  const now = new Date().toISOString();
  if (insightId) {
    const result = db().prepare("UPDATE insights SET data = ?, revision = revision + 1, updated_at = ? WHERE workspace_id = ? AND id = ? AND revision = ?")
      .run(JSON.stringify(data), now, id, insightId, revision ?? 0);
    if (!result.changes) throw new Error("Insight changed or was not found. Refresh and try again.");
    return insightId;
  }
  const newId = randomUUID();
  db().prepare("INSERT INTO insights VALUES (?, ?, ?, 1, ?)").run(newId, id, JSON.stringify(data), now);
  return newId;
}
export function exportCaseStudy(id: string) {
  const workspace = getWorkspace(id);
  if (!workspace) throw new Error("Workspace not found.");
  const p = workspace.profile;
  const scans = listWorkspaceScans(id);
  const insights = listInsights(id).filter(i => i.data.status === "active");
  const experiments = listExperiments(id);
  const clean = (value: unknown) => String(value ?? "").replace(/[\r\n]+/g, " ").trim();
  const lines = [
    `# ${clean(p.name)} — marketing case study`, "",
    `**Question:** ${clean(p.question)}`, `**Goal:** ${clean(p.goal)}`, `**Audience:** ${clean(p.audience) || "Not specified"}`,
    `**Baseline:** ${clean(p.baseline) || "Unknown"}`, "", "## Evidence", "",
  ];
  for (const scan of scans) {
    lines.push(`### ${clean(scan.bundle.brand)} — recorded ${clean(scan.bundle.generatedAt)}`);
    for (const item of scan.bundle.evidence) lines.push(`- [${clean(scan.run_id)}:${clean(item.id)}] ${clean(item.title)}${item.url && /^https?:\/\//i.test(item.url) ? ` — ${item.url}` : ""}`);
    for (const unknown of scan.bundle.unknowns) lines.push(`- Unknown: ${clean(unknown.reason)}`);
    lines.push("");
  }
  lines.push("## Decisions and opportunities", "");
  for (const item of insights) lines.push(`### ${clean(item.data.observation)}`, `Inference: ${clean(item.data.interpretation)}`, `Action: ${clean(item.data.action)}`, `Evidence: ${item.data.citations.map(c => `[${c.runId}:${c.evidenceId}]`).join(", ")}`, "");
  lines.push("## Experiments", "");
  for (const item of experiments) lines.push(`### ${clean(item.data.hypothesis)}`, `Status: ${clean(item.data.status)}`, `Metric: ${clean(item.data.metric) || "Not specified"}`, `Result: ${clean(item.data.result) || "Not yet recorded"}`, `Learning: ${clean(item.data.learning) || "Not yet recorded"}`, "");
  if (!experiments.length) lines.push("No experiment recorded.", "");
  lines.push("## Limitations", "", "Public market signals do not establish competitor revenue or campaign performance. Metrics and results appear only when supplied by the workspace owner.", "");
  return lines.join("\n");
}
