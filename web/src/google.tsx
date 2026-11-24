import { useEffect, useState } from "react";

type Product = "ga4" | "search";
type Property = { id: string; name: string };
type Report = { property: string; product: Product; start: string; end: string; rows: Array<{ keys?: string[]; clicks?: number; impressions?: number; dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }>; note?: string; metadata?: unknown };
type Saved = { report: Report; updatedAt: string };
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "content-type": "application/json" } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data as T;
}
export function GoogleConnections({ workspaceId }: { workspaceId: string }) {
  const base = "/api/workspaces/" + workspaceId + "/google/";
  const [product, setProduct] = useState<Product>("ga4");
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [authUrl, setAuthUrl] = useState("");
  const [status, setStatus] = useState({ ga4: false, search: false });
  const [properties, setProperties] = useState<Property[]>([]);
  const [property, setProperty] = useState("");
  const [reports, setReports] = useState<Saved[]>([]);
  const [end, setEnd] = useState(() => new Date(Date.now() - 86400000).toISOString().slice(0, 10));
  const [start, setStart] = useState(() => new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteReports, setDeleteReports] = useState(false);
  async function refresh() {
    const [state, saved] = await Promise.all([request<typeof status>(base + "status"), request<Saved[]>(base + "reports")]);
    setStatus(state); setReports(saved);
    if (state[product]) setProperties(await request<Property[]>(base + "properties?product=" + product));
  }
  useEffect(() => { setProperty(""); setProperties([]); setAuthUrl(""); refresh().catch(e => setError(e.message)); }, [workspaceId, product]);
  async function startAuth() {
    try { const result = await request<{ url: string }>(base + "start", { method: "POST", body: JSON.stringify({ product, clientId, clientSecret: secret }) }); setAuthUrl(result.url); setError(""); }
    catch (e) { setError((e as Error).message); }
  }
  async function loadReport() {
    setBusy(true);
    try { await request(base + "report", { method: "POST", body: JSON.stringify({ product, property, start, end }) }); await refresh(); setError(""); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div><h3>Google connections</h3><p>Connect a property you can access. Authorization requests read-only access. Tokens are kept in memory for this app session. Saved report snapshots remain local.</p>
    {error && <p className="workspace-error" role="alert">{error}</p>}
    <label>Service<select value={product} onChange={e => setProduct(e.target.value as Product)}><option value="ga4">Google Analytics 4</option><option value="search">Google Search Console</option></select></label>
    {!status[product] ? <div className="google-connect"><p>Create a Google OAuth desktop client with the relevant API enabled, then enter its client details.</p>
      <div className="workspace-fields"><label>OAuth client ID<input value={clientId} onChange={e => setClientId(e.target.value)} /></label><label>OAuth client secret, if provided<input type="password" value={secret} onChange={e => setSecret(e.target.value)} /></label></div>
      <button type="button" disabled={!clientId} onClick={startAuth}>Prepare authorization</button> {authUrl && <a className="google-auth-link" href={authUrl} target="_blank" rel="noreferrer">Open Google authorization ↗</a>} <button type="button" onClick={() => refresh().catch(e => setError(e.message))}>Check connection</button>
    </div> : <div className="google-connect"><p>Connected for this session.</p><label><input type="checkbox" checked={deleteReports} onChange={e => setDeleteReports(e.target.checked)} /> Remove saved reports when disconnecting</label><button type="button" onClick={async () => { try { await request(base + "disconnect", { method: "POST", body: JSON.stringify({ product, deleteReports }) }); setProperty(""); setDeleteReports(false); await refresh(); } catch (e) { setError((e as Error).message); } }}>Disconnect</button>
      <div className="workspace-fields"><label>Property<select value={property} onChange={e => setProperty(e.target.value)}><option value="">Choose property</option>{properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Start date<input type="date" value={start} onChange={e => setStart(e.target.value)} /></label><label>End date<input type="date" value={end} onChange={e => setEnd(e.target.value)} /></label></div>
      <button type="button" disabled={!property || busy} onClick={loadReport}>{busy ? "Loading…" : "Fetch report"}</button>
    </div>}
    <h3>Saved Google reports</h3>{reports.length === 0 && <p>No reports fetched yet.</p>}
    {reports.filter(entry => entry.report.product === product).map(({ report, updatedAt }) => <article className="workspace-record" key={report.property}><h3>{report.property}</h3><p>{report.product === "ga4" ? "GA4 sessions and engaged sessions" : "Search Console clicks and impressions"} · {report.start} to {report.end} · fetched {new Date(updatedAt).toLocaleString()}</p>{report.note && <p>{report.note}</p>}
      <div className="import-preview"><table><thead><tr>{report.product === "ga4" ? <><th>Date</th><th>Channel</th><th>Sessions</th><th>Engaged sessions</th></> : <><th>Date</th><th>Clicks</th><th>Impressions</th></>}</tr></thead><tbody>{report.rows.map((row, i) => <tr key={i}>{report.product === "ga4" ? <><td>{row.dimensionValues?.[0]?.value}</td><td>{row.dimensionValues?.[1]?.value}</td><td>{row.metricValues?.[0]?.value}</td><td>{row.metricValues?.[1]?.value}</td></> : <><td>{row.keys?.[0]}</td><td>{row.clicks}</td><td>{row.impressions}</td></>}</tr>)}</tbody></table></div>
    </article>)}
  </div>;
}
