import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type * as WorkspaceModule from "../src/workspaces.js";
import type * as MeasurementModule from "../src/measurements.js";

let workspaces: typeof WorkspaceModule;
let measures: typeof MeasurementModule;
beforeAll(async () => {
  process.env.MARKETERS_EYE_DATA_DIR = mkdtempSync(join(tmpdir(), "marketers-eye-metrics-"));
  workspaces = await import("../src/workspaces.js");
  measures = await import("../src/measurements.js");
});
describe("campaign import", () => {
  const input = { source: "Ads", grain: "weekly", attribution: "7 days", currency: "USD", csv: 'date,channel,campaign,impressions,clicks,spend\n2026-11-02,Search,"Campaign, A",10,1,0\n2026-11-09,Search,"Campaign, A",990,9,10' };
  it("handles quotes and zero, and rejects invalid rows", () => {
    const result = measures.previewImport(input);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.campaign).toBe("Campaign, A");
    expect(result.rows[0]?.values.spend).toBe(0);
    expect(measures.previewImport({ ...input, csv: "date,clicks\n2026-11-02,-1" }).errors).not.toEqual([]);
  });
  it("deduplicates exact reimports and blocks overlapping periods", () => {
    const workspace = workspaces.createWorkspace({ name: "Brand", website: "example.com", goal: "sales", question: "What to test?" })!;
    const id = workspace.id;
    const first = measures.commitImport(id, input);
    expect(measures.commitImport(id, input)).toEqual({ id: first.id, duplicate: true });
    expect(measures.measurements(id)).toHaveLength(2);
    expect(() => measures.commitImport(id, { ...input, grain: "monthly", csv: 'date,channel,campaign,impressions\n2026-11-01,Search,"Campaign, A",1000' })).toThrow("overlap");
    expect(measures.measurements(id)).toHaveLength(2);
    expect(measures.deleteImport(id, first.id)).toBe(true);
    expect(measures.measurements(id)).toHaveLength(0);
  });
});
