import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { EvidenceBundle } from "../src/index.js";
import type * as WorkspaceModule from "../src/workspaces.js";
import type * as DecisionModule from "../src/decisions.js";

let workspaces: typeof WorkspaceModule;
let decisions: typeof DecisionModule;
beforeAll(async () => {
  process.env.MARKETERS_EYE_DATA_DIR = mkdtempSync(join(tmpdir(), "marketers-eye-decisions-"));
  workspaces = await import("../src/workspaces.js");
  decisions = await import("../src/decisions.js");
});
describe("evidence-backed decisions", () => {
  it("checks citations within the workspace and exports a planned result accurately", () => {
    const workspace = workspaces.createWorkspace({ name: "Brand", website: "example.com", goal: "sales", question: "What to test?" })!;
    const bundle = { brand: "Competitor", generatedAt: "2026-11-24", evidence: [{ id: "E1", title: "Free trial", url: "https://example.com/pricing" }], unknowns: [] } as unknown as EvidenceBundle;
    workspaces.attachScan(workspace.id, "run-1", bundle);
    const insight = { observation: "A free trial is offered", interpretation: "A trial may matter", action: "Test a trial message", confidence: "Medium", impact: "Medium", citations: [{ runId: "run-1", evidenceId: "E1" }] };
    expect(() => decisions.saveInsight(workspace.id, { ...insight, citations: [{ runId: "run-2", evidenceId: "E1" }] })).toThrow("not found");
    decisions.saveInsight(workspace.id, insight);
    workspaces.createExperiment(workspace.id, { hypothesis: "A trial message increases signup starts" });
    const report = decisions.exportCaseStudy(workspace.id);
    expect(report).toContain("[run-1:E1]");
    expect(report).toContain("Status: planned");
    expect(report).toContain("Result: Not yet recorded");
  });
});
