import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type * as WorkspaceModule from "../src/workspaces.js";

let workspaces: typeof WorkspaceModule;
beforeAll(async () => {
  process.env.MARKETERS_EYE_DATA_DIR = mkdtempSync(join(tmpdir(), "marketers-eye-workspaces-"));
  workspaces = await import("../src/workspaces.js");
});

describe("workspace persistence", () => {
  it("keeps profiles isolated and detects stale updates", () => {
    const profile = { name: "Example", website: "example.com", goal: "leads", question: "What to test?" };
    const one = workspaces.createWorkspace(profile)!;
    const two = workspaces.createWorkspace({ ...profile, name: "Another" })!;
    expect(one.id).not.toBe(two.id);
    expect(workspaces.updateWorkspace(String(one.id), 1, { ...profile, name: "Updated" })?.revision).toBe(2);
    expect(() => workspaces.updateWorkspace(String(one.id), 1, profile)).toThrow("changed");
    expect(workspaces.getWorkspace(String(two.id))?.profile.name).toBe("Another");
  });

  it("enforces experiment transitions and required review fields", () => {
    const workspace = workspaces.createWorkspace({ name: "Brand", website: "example.com", goal: "sales", question: "Which offer?" })!;
    const id = String(workspace.id);
    const experiment = { hypothesis: "A trial improves signup", status: "planned" };
    const experimentId = workspaces.createExperiment(id, experiment);
    expect(() => workspaces.updateExperiment(id, experimentId, 1, { ...experiment, status: "running" })).toThrow("need a treatment");
    workspaces.updateExperiment(id, experimentId, 1, { ...experiment, status: "running", treatment: "Trial", owner: "Owner", metric: "Signups", startDate: "2026-11-24", reviewDate: "2026-12-01" });
    expect(() => workspaces.updateExperiment(id, experimentId, 1, experiment)).toThrow("changed");
    expect(workspaces.listExperiments(id)[0]?.data.status).toBe("running");
  });
});
