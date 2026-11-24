import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type * as WorkspaceModule from "../src/workspaces.js";
import type * as ShareModule from "../src/workspace-mcp.js";

let workspaces: typeof WorkspaceModule;
let sharing: typeof ShareModule;
beforeAll(async () => {
  process.env.MARKETERS_EYE_DATA_DIR = mkdtempSync(join(tmpdir(), "marketers-eye-sharing-"));
  workspaces = await import("../src/workspaces.js");
  sharing = await import("../src/workspace-mcp.js");
});
describe("approved assistant shares", () => {
  it("freezes the approved snapshot and requires review for drafts", () => {
    const workspace = workspaces.createWorkspace({ name: "Brand", website: "example.com", goal: "leads", question: "What to test?" })!;
    const preview = sharing.sharePreview(workspace.id);
    const share = sharing.createShare(workspace.id, preview.hash);
    workspaces.updateWorkspace(workspace.id, 1, { ...workspace.profile, goal: "sales" });
    expect(sharing.sharedSummary(share.token).profile.goal).toBe("leads");
    expect(() => sharing.createShare(workspace.id, preview.hash)).toThrow("changed");
    const draft = sharing.addMcpDraft(share.token, { kind: "experiment", data: { hypothesis: "A better offer" } });
    expect(workspaces.listExperiments(workspace.id)).toHaveLength(0);
    sharing.acceptMcpDraft(workspace.id, draft, { hypothesis: "A better offer" });
    expect(workspaces.listExperiments(workspace.id)).toHaveLength(1);
    expect(sharing.listMcpDrafts(workspace.id)).toHaveLength(0);
    sharing.revokeShare(workspace.id, share.id);
    expect(() => sharing.sharedSummary(share.token)).toThrow("expired");
  });
});
