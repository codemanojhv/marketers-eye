import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type * as GoogleModule from "../src/google.js";
import type * as WorkspaceModule from "../src/workspaces.js";

let google: typeof GoogleModule;
let workspaces: typeof WorkspaceModule;
beforeAll(async () => {
  process.env.MARKETERS_EYE_DATA_DIR = mkdtempSync(join(tmpdir(), "marketers-eye-google-"));
  workspaces = await import("../src/workspaces.js");
  google = await import("../src/google.js");
});
afterEach(() => vi.unstubAllGlobals());
describe("Google authorization and reports", () => {
  it("requires state, lists an authorized property, and saves a report", async () => {
    const workspace = workspaces.createWorkspace({ name: "Brand", website: "example.com", goal: "sales", question: "Which offer?" })!;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "test-access", expires_in: 3600 });
      if (url.includes("accountSummaries")) return Response.json({ accountSummaries: [{ displayName: "Account", propertySummaries: [{ property: "properties/123", displayName: "Property" }] }] });
      if (url.includes(":runReport")) return Response.json({ rows: [{ dimensionValues: [{ value: "20261101" }, { value: "Organic Search" }], metricValues: [{ value: "10" }, { value: "8" }] }], rowCount: 1 });
      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const auth = google.startGoogle(workspace.id, { product: "ga4", clientId: "client" }, 4321);
    const url = new URL(auth.url);
    expect(url.searchParams.get("scope")).toContain("analytics.readonly");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    await expect(google.finishGoogle("invalid", "code")).rejects.toThrow("expired");
    await google.finishGoogle(url.searchParams.get("state")!, "code");
    await expect(google.finishGoogle(url.searchParams.get("state")!, "code")).rejects.toThrow("expired");
    expect(await google.googleProperties(workspace.id, "ga4")).toEqual([{ id: "properties/123", name: "Account / Property" }]);
    await google.googleReport(workspace.id, { product: "ga4", property: "properties/123", start: "2026-11-01", end: "2026-11-02" });
    expect(google.googleReports(workspace.id)).toHaveLength(1);
    await expect(google.googleReport(workspace.id, { product: "ga4", property: "properties/999", start: "2026-11-01", end: "2026-11-02" })).rejects.toThrow("not available");
  });
});
