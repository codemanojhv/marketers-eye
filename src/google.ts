import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "./workspaces.js";

type Product = "ga4" | "search";
type Session = { workspace: string; product: Product; clientId: string; clientSecret: string; verifier: string; redirect: string; created: number; access?: string; refresh?: string; expires?: number };
const pending = new Map<string, Session>();
const connected = new Map<string, Session>();
const key = (workspace: string, product: string) => workspace + ":" + product;
const productSchema = z.enum(["ga4", "search"]);
const scopes = { ga4: "https://www.googleapis.com/auth/analytics.readonly", search: "https://www.googleapis.com/auth/webmasters.readonly" };

export function startGoogle(workspace: string, input: unknown, port: number) {
  const data = z.object({ product: productSchema, clientId: z.string().trim().min(1).max(500), clientSecret: z.string().trim().max(500).default("") }).parse(input);
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const redirect = `http://127.0.0.1:${port}/api/google/callback`;
  for (const [id, session] of pending) if (Date.now() - session.created > 600_000) pending.delete(id);
  pending.set(state, { workspace, ...data, verifier, redirect, created: Date.now() });
  const query = new URLSearchParams({ client_id: data.clientId, redirect_uri: redirect, response_type: "code", scope: scopes[data.product], state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", access_type: "offline", prompt: "consent" });
  return { url: "https://accounts.google.com/o/oauth2/v2/auth?" + query };
}

async function token(session: Session, body: URLSearchParams) {
  body.set("client_id", session.clientId);
  if (session.clientSecret) body.set("client_secret", session.clientSecret);
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(20000) });
  const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !data.access_token) throw new Error(data.error_description || "Google token request failed.");
  session.access = data.access_token;
  if (data.refresh_token) session.refresh = data.refresh_token;
  session.expires = Date.now() + (data.expires_in || 3600) * 1000;
}
export async function finishGoogle(state: string, code: string) {
  const session = pending.get(state);
  pending.delete(state);
  if (!session || Date.now() - session.created > 600_000 || !code) throw new Error("Authorization expired or was declined. Try connecting again.");
  await token(session, new URLSearchParams({ code, code_verifier: session.verifier, redirect_uri: session.redirect, grant_type: "authorization_code" }));
  connected.set(key(session.workspace, session.product), session);
}
async function authorized(workspace: string, product: Product, url: string, init: RequestInit = {}) {
  const session = connected.get(key(workspace, product));
  if (!session?.access) throw new Error("Connect this Google account first.");
  if ((session.expires ?? 0) < Date.now() + 30000) {
    if (!session.refresh) throw new Error("Google authorization expired. Connect again.");
    await token(session, new URLSearchParams({ refresh_token: session.refresh, grant_type: "refresh_token" }));
  }
  const response = await fetch(url, { ...init, headers: { ...init.headers, authorization: "Bearer " + session.access }, signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `Google returned HTTP ${response.status}.`);
  return data;
}
export function googleStatus(workspace: string) {
  return { ga4: connected.has(key(workspace, "ga4")), search: connected.has(key(workspace, "search")) };
}
export async function googleProperties(workspace: string, product: Product) {
  productSchema.parse(product);
  if (product === "search") {
    const data = await authorized(workspace, product, "https://www.googleapis.com/webmasters/v3/sites");
    return (data.siteEntry ?? []).map((site: { siteUrl: string }) => ({ id: site.siteUrl, name: site.siteUrl }));
  }
  const result: { id: string; name: string }[] = [];
  let next = "";
  do {
    const data = await authorized(workspace, product, "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200" + (next ? "&pageToken=" + encodeURIComponent(next) : ""));
    for (const account of data.accountSummaries ?? []) for (const property of account.propertySummaries ?? []) result.push({ id: property.property, name: account.displayName + " / " + property.displayName });
    next = data.nextPageToken || "";
  } while (next);
  return result;
}
export async function googleReport(workspace: string, input: unknown) {
  const data = z.object({ product: productSchema, property: z.string().min(1).max(500), start: z.iso.date(), end: z.iso.date() }).parse(input);
  if (data.start > data.end) throw new Error("Start date must be before end date.");
  const available = await googleProperties(workspace, data.product);
  if (!available.some((property: { id: string }) => property.id === data.property)) throw new Error("Property is not available to this account.");
  if (data.product === "search") {
    const result = await authorized(workspace, data.product, "https://www.googleapis.com/webmasters/v3/sites/" + encodeURIComponent(data.property) + "/searchAnalytics/query", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ startDate: data.start, endDate: data.end, dimensions: ["date"], rowLimit: 25000 }) });
    const report = { property: data.property, product: data.product, start: data.start, end: data.end, rows: result.rows ?? [], note: "Search Console may omit dates or limit data." };
    saveReport(workspace, report);
    return report;
  }
  if (!/^properties\/\d+$/.test(data.property)) throw new Error("Invalid GA4 property.");
  const result = await authorized(workspace, data.product, "https://analyticsdata.googleapis.com/v1beta/" + data.property + ":runReport", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dateRanges: [{ startDate: data.start, endDate: data.end }], dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }], metrics: [{ name: "sessions" }, { name: "engagedSessions" }], limit: "100000" }) });
  if ((result.rowCount ?? 0) > (result.rows ?? []).length) throw new Error("Report exceeds the supported row limit. Choose a shorter date range.");
  const report = { property: data.property, product: data.product, start: data.start, end: data.end, rows: result.rows ?? [], rowCount: result.rowCount, metadata: result.metadata };
  saveReport(workspace, report);
  return report;
}
function saveReport(workspace: string, report: { product: Product; property: string }) {
  db().prepare("INSERT INTO google_reports VALUES (?, ?, ?, ?, ?) ON CONFLICT(workspace_id, product, property) DO UPDATE SET report = excluded.report, updated_at = excluded.updated_at")
    .run(workspace, report.product, report.property, JSON.stringify(report), new Date().toISOString());
}
export function googleReports(workspace: string) {
  return db().prepare("SELECT report, updated_at FROM google_reports WHERE workspace_id = ? ORDER BY updated_at DESC").all(workspace).map(row => ({ report: JSON.parse(String(row.report)), updatedAt: row.updated_at }));
}
export function deleteGoogleReports(workspace: string, product: Product) {
  productSchema.parse(product);
  return db().prepare("DELETE FROM google_reports WHERE workspace_id = ? AND product = ?").run(workspace, product).changes;
}
export async function disconnectGoogle(workspace: string, product: Product) {
  productSchema.parse(product);
  const session = connected.get(key(workspace, product));
  connected.delete(key(workspace, product));
  if (session?.refresh || session?.access) await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: session.refresh || session.access! }), signal: AbortSignal.timeout(10000) }).catch(() => {});
}
