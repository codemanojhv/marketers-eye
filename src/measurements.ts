import { createHash, randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { db } from "./workspaces.js";

const fields = ["date", "channel", "campaign", "spend", "impressions", "clicks", "visits", "leads", "purchases", "revenue", "currency"] as const;
const metrics = ["spend", "impressions", "clicks", "visits", "leads", "purchases", "revenue"] as const;
type Metric = typeof metrics[number];
type Row = { rowNumber: number; date: string; channel: string; campaign: string; currency: string; values: Partial<Record<Metric, number>> };
const inputSchema = z.object({
  csv: z.string().min(1).max(10_000_000), source: z.string().trim().min(1).max(200),
  grain: z.enum(["weekly", "monthly"]), attribution: z.string().trim().max(200).default("Unknown"),
  currency: z.string().trim().max(3).default(""),
  mapping: z.record(z.string(), z.string()).default({}),
});

export function previewImport(input: unknown) {
  const parsed = inputSchema.parse(input);
  const records = parse(parsed.csv, { bom: true, skip_empty_lines: true, relax_column_count: false }) as string[][];
  const headers = records.shift()?.map(value => value.trim()) ?? [];
  if (!headers.length || new Set(headers).size !== headers.length) throw new Error("CSV headers must be present and unique.");
  if (records.length > 50_000) throw new Error("CSV exceeds 50,000 rows.");
  const mapping: Record<string, string> = {};
  for (const field of fields) mapping[field] = parsed.mapping[field] ?? headers.find(h => h.toLowerCase().replace(/[\s-]+/g, "_") === field) ?? "";
  const indices = Object.fromEntries(fields.map(field => [field, headers.indexOf(mapping[field] ?? "")]));
  const errors: string[] = [];
  if (!mapping.date || !metrics.some(field => mapping[field])) errors.push("Map a date and at least one metric.");
  for (const field of fields) if (mapping[field] && indices[field] === -1) errors.push(`Column mapped to ${field} was not found.`);
  const mapped = fields.map(field => mapping[field]).filter(Boolean);
  if (new Set(mapped).size !== mapped.length) errors.push("A CSV column can only be mapped once.");
  const rows: Row[] = records.map((record, index) => {
    const get = (key: string) => (record[indices[key] ?? -1] ?? "").trim();
    const date = get("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) errors.push(`Row ${index + 2}: date must be YYYY-MM-DD.`);
    if (parsed.grain === "monthly" && !date.endsWith("-01")) errors.push(`Row ${index + 2}: monthly dates must be the first day of the month.`);
    const currency = (get("currency") || parsed.currency).toUpperCase();
    const values: Row["values"] = {};
    for (const metric of metrics) {
      const raw = get(metric);
      if (!raw) continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || (["impressions", "clicks", "visits", "leads", "purchases"].includes(metric) && !Number.isInteger(value))) errors.push(`Row ${index + 2}: invalid ${metric}.`);
      else values[metric] = value;
    }
    if (!Object.keys(values).length) errors.push(`Row ${index + 2}: no metric values.`);
    if ((values.spend !== undefined || values.revenue !== undefined) && !/^[A-Z]{3}$/.test(currency)) errors.push(`Row ${index + 2}: enter a three-letter currency.`);
    return { rowNumber: index + 2, date, channel: get("channel") || "Unspecified", campaign: get("campaign") || "Unspecified", currency, values };
  });
  if (!rows.length) errors.push("The file has no data rows.");
  return { headers, mapping, rows, errors, options: parsed };
}

export function commitImport(workspaceId: string, input: unknown) {
  const preview = previewImport(input);
  if (preview.errors.length) throw new Error(preview.errors.slice(0, 10).join(" "));
  const { options, rows, mapping } = preview;
  const hash = createHash("sha256").update(JSON.stringify({ csv: options.csv, source: options.source, grain: options.grain, attribution: options.attribution, currency: options.currency, mapping })).digest("hex");
  const existing = db().prepare("SELECT id FROM imports WHERE workspace_id = ? AND hash = ?").get(workspaceId, hash);
  if (existing) return { id: String(existing.id), duplicate: true };
  const id = randomUUID();
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    const prior = database.prepare(`SELECT m.period, m.channel, m.campaign, m.currency, i.grain FROM measurements m
      JOIN imports i ON i.id = m.import_id WHERE m.workspace_id = ? AND i.source = ?`).all(workspaceId, options.source);
    const grouped = new Map<string, { date: string; grain: string; rowNumber?: number }[]>();
    const add = (channel: string, campaign: string, currency: string, item: { date: string; grain: string; rowNumber?: number }) => {
      const key = JSON.stringify([channel, campaign, currency]);
      const group = grouped.get(key) ?? [];
      group.push(item);
      grouped.set(key, group);
    };
    for (const row of prior) add(String(row.channel), String(row.campaign), String(row.currency), { date: String(row.period), grain: String(row.grain) });
    const endDate = (date: string, grain: string) => {
      const end = new Date(date + "T00:00:00Z");
      if (grain === "monthly") end.setUTCMonth(end.getUTCMonth() + 1);
      else end.setUTCDate(end.getUTCDate() + 7);
      return end.toISOString().slice(0, 10);
    };
    for (const row of rows) add(row.channel, row.campaign, row.currency, { date: row.date, grain: options.grain, rowNumber: row.rowNumber });
    for (const group of grouped.values()) {
      group.sort((a, b) => a.date.localeCompare(b.date));
      let lastEnd = "";
      for (const item of group) {
        if (item.date < lastEnd) throw new Error(`Row ${item.rowNumber ?? "in the import"} overlaps an existing period or another row in this file.`);
        lastEnd = endDate(item.date, item.grain);
      }
    }
    database.prepare("INSERT INTO imports VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, workspaceId, options.source, options.grain, options.attribution || "Unknown", hash, options.csv, JSON.stringify(mapping), new Date().toISOString());
    const insert = database.prepare("INSERT INTO measurements VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const row of rows) insert.run(id, workspaceId, row.rowNumber, row.date, row.channel, row.campaign, row.currency, JSON.stringify(row.values));
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }
  return { id, duplicate: false };
}
export function listImports(workspaceId: string) {
  return db().prepare("SELECT id, source, grain, attribution, created_at FROM imports WHERE workspace_id = ? ORDER BY created_at DESC").all(workspaceId);
}
export function getImport(workspaceId: string, id: string) {
  return db().prepare("SELECT original FROM imports WHERE workspace_id = ? AND id = ?").get(workspaceId, id);
}
export function deleteImport(workspaceId: string, id: string) {
  return db().prepare("DELETE FROM imports WHERE workspace_id = ? AND id = ?").run(workspaceId, id).changes > 0;
}
export function measurements(workspaceId: string) {
  return db().prepare(`SELECT m.*, i.source, i.grain, i.attribution FROM measurements m JOIN imports i ON i.id = m.import_id WHERE m.workspace_id = ? ORDER BY m.period`).all(workspaceId)
    .map(row => ({ ...row, values: JSON.parse(String(row.data)), data: undefined }));
}
