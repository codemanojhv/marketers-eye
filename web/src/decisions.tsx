import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { GoogleConnections } from "./google.js";
import { McpShare } from "./mcp-share.js";
import { parse as parseCsv } from "csv-parse/browser/esm/sync";

type Evidence = { id: string; title: string; observedAt?: string; kind?: string; url?: string; data?: unknown };
type Scan = { run_id: string; bundle: { brand: string; generatedAt?: string; target?: { domain?: string }; evidence: Evidence[]; sources?: { source?: string; status: string; reason?: string }[]; unknowns?: { channel?: string; reason: string }[]; scorecard?: { channel: string; status: string; signal: string; evidence: string[] }[] } };
type InsightData = { observation: string; interpretation: string; action: string; validation: string; confidence: string; impact: string; reasoning: string; status: string; citations: { runId: string; evidenceId: string }[] };
type Insight = { id: string; revision: number; data: InsightData };
type Feedback = { id: string; excerpt: string; source: string; theme: string; created_at: string };
type Import = { id: string; source: string; grain: string; attribution: string; created_at: string };
type Measurement = { import_id: string; period: string; source: string; grain: string; attribution: string; channel: string; campaign: string; currency: string; values: Record<string, number> };
type Preview = { headers: string[]; mapping: Record<string, string>; rowCount: number; rows: { rowNumber: number; date: string; channel: string; campaign: string; currency: string; values: Record<string, number> }[]; errors: string[] };
const fields = ["date", "channel", "campaign", "spend", "impressions", "clicks", "visits", "leads", "purchases", "revenue", "currency"];
function periodEnd(row: Measurement) {
  const end = new Date(row.period + "T00:00:00Z");
  if (row.grain === "monthly") end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCDate(end.getUTCDate() + 7);
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}
function safeSource(value?: string) {
  try { const url = new URL(value || ""); return ["http:", "https:"].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...options, headers: { "content-type": "application/json" } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data as T;
}
const textField = (value: string, set: (value: string) => void, label: string, multiline = false) =>
  <label>{label}{multiline ? <textarea value={value} onChange={e => set(e.target.value)} /> : <input value={value} onChange={e => set(e.target.value)} />}</label>;

export function Decisions({ workspaceId, scans, onExperiment }: { workspaceId: string; scans: Scan[]; onExperiment: (hypothesis: string, evidence: string) => void }) {
  const base = "/api/workspaces/" + workspaceId;
  const [tab, setTab] = useState("overview");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [imports, setImports] = useState<Import[]>([]);
  const [rows, setRows] = useState<Measurement[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [csv, setCsv] = useState("");
  const [source, setSource] = useState("");
  const [grain, setGrain] = useState("weekly");
  const [attribution, setAttribution] = useState("Unknown");
  const [currency, setCurrency] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterImport, setFilterImport] = useState("");
  const [filterChannel, setFilterChannel] = useState("");
  const [filterCampaign, setFilterCampaign] = useState("");
  const [filterCurrency, setFilterCurrency] = useState("");
  const [filterGrain, setFilterGrain] = useState("");
  const [filterAttribution, setFilterAttribution] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [metric, setMetric] = useState("clicks");
  const [excerpt, setExcerpt] = useState("");
  const [feedbackSource, setFeedbackSource] = useState("");
  const [theme, setTheme] = useState("");
  const [feedbackHeaders, setFeedbackHeaders] = useState<string[]>([]);
  const [feedbackRows, setFeedbackRows] = useState<string[][]>([]);
  const [feedbackColumn, setFeedbackColumn] = useState("");
  const [observation, setObservation] = useState("");
  const [interpretation, setInterpretation] = useState("");
  const [action, setAction] = useState("");
  const [validation, setValidation] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [confidence, setConfidence] = useState("Low");
  const [impact, setImpact] = useState("Medium");
  const [citation, setCitation] = useState("");
  const [extraCitations, setExtraCitations] = useState<{ runId: string; evidenceId: string }[]>([]);
  const [editing, setEditing] = useState<Insight | null>(null);
  const [markdown, setMarkdown] = useState("");
  async function refresh() {
    const [a, b, c, d] = await Promise.all([
      request<Import[]>(base + "/imports"), request<Measurement[]>(base + "/measurements"),
      request<Feedback[]>(base + "/feedback"), request<Insight[]>(base + "/insights"),
    ]);
    setImports(a); setRows(b); setFeedback(c); setInsights(d);
  }
  useEffect(() => { refresh().catch(e => setError(e.message)); }, [workspaceId]);
  const filtered = useMemo(() => rows.filter(r => (!filterSource || r.source === filterSource) && (!filterImport || r.import_id === filterImport) && (!filterChannel || r.channel === filterChannel) && (!filterCampaign || r.campaign === filterCampaign) && (!filterCurrency || r.currency === filterCurrency) && (!filterGrain || r.grain === filterGrain) && (!filterAttribution || r.attribution === filterAttribution) && (!dateFrom || r.period >= dateFrom) && (!dateTo || periodEnd(r) <= dateTo)), [rows, filterSource, filterImport, filterChannel, filterCampaign, filterCurrency, filterGrain, filterAttribution, dateFrom, dateTo]);
  const comparable = new Set(filtered.map(r => [r.source, r.grain, r.attribution, r.currency, r.attribution === "Unknown" ? r.import_id : ""].join("|"))).size <= 1;
  const chart = useMemo(() => {
    const groups = new Map<string, { period: string; value: number; count: number }>();
    for (const row of filtered) {
      if (row.values[metric] === undefined) continue;
      const current = groups.get(row.period) || { period: row.period, value: 0, count: 0 };
      current.value += row.values[metric]; current.count++; groups.set(row.period, current);
    }
    const sorted = [...groups.values()].sort((a, b) => a.period.localeCompare(b.period));
    const withGaps: { period: string; value: number | null; count: number }[] = [];
    for (const item of sorted) {
      const previous = withGaps[withGaps.length - 1];
      if (previous) {
        const expected = new Date(previous.period + "T00:00:00Z");
        if (filtered[0]?.grain === "monthly") expected.setUTCMonth(expected.getUTCMonth() + 1);
        else expected.setUTCDate(expected.getUTCDate() + 7);
        const nextPeriod = expected.toISOString().slice(0, 10);
        if (nextPeriod < item.period) withGaps.push({ period: nextPeriod, value: null, count: 0 });
      }
      withGaps.push(item);
    }
    return withGaps;
  }, [filtered, metric]);
  const sums = (key: string) => filtered.reduce((sum, row) => sum + (row.values[key] ?? 0), 0);
  const ratio = (numerator: string, denominator: string, factor = 1) => comparable && filtered.length && filtered.every(r => r.values[numerator] !== undefined && r.values[denominator] !== undefined) && sums(denominator) > 0 ? factor * sums(numerator) / sums(denominator) : null;
  const rate = ratio("clicks", "impressions", 100);
  const periodCtr = (period: string) => {
    const group = filtered.filter(row => row.period === period);
    if (!group.length || group.some(row => row.values.clicks === undefined || row.values.impressions === undefined)) return null;
    const clicks = group.reduce((total, row) => total + row.values.clicks!, 0);
    const impressions = group.reduce((total, row) => total + row.values.impressions!, 0);
    return impressions > 0 ? { value: clicks / impressions * 100, clicks, impressions } : null;
  };
  const options = () => ({ csv, source, grain, attribution, currency, mapping });
  async function previewFile() {
    try { const data = await request<Preview>(base + "/imports/preview", { method: "POST", body: JSON.stringify(options()) }); setPreview(data); setMapping(data.mapping); setPreviewKey(JSON.stringify({ ...options(), mapping: data.mapping })); setError(""); }
    catch (e) { setError((e as Error).message); }
  }
  async function importFile() {
    try { const result = await request<{ duplicate: boolean }>(base + "/imports", { method: "POST", body: JSON.stringify(options()) }); setNotice(result.duplicate ? "This import is already saved." : "Campaign data saved."); setCsv(""); setPreview(null); setMapping({}); await refresh(); setError(""); }
    catch (e) { setError((e as Error).message); }
  }
  async function submitFeedback(e: FormEvent) {
    e.preventDefault();
    try { await request(base + "/feedback", { method: "POST", body: JSON.stringify({ excerpt, source: feedbackSource, theme }) }); setExcerpt(""); setTheme(""); await refresh(); setNotice("Reviewed feedback saved."); setError(""); }
    catch (err) { setError((err as Error).message); }
  }
  async function submitInsight(e: FormEvent) {
    e.preventDefault();
    const [runId, evidenceId] = citation.split("|");
    try {
      const citations = [{ runId, evidenceId }, ...extraCitations.filter(ref => ref.runId !== runId || ref.evidenceId !== evidenceId)];
      const data = { observation, interpretation, action, validation, reasoning, confidence, impact, status: editing?.data.status || "active", citations };
      await request(base + "/insights" + (editing ? "/" + editing.id : ""), { method: editing ? "PUT" : "POST", body: JSON.stringify(editing ? { revision: editing.revision, data } : data) });
      setEditing(null); setObservation(""); setInterpretation(""); setAction(""); setValidation(""); setReasoning(""); setCitation(""); setExtraCitations([]); await refresh(); setError(""); setNotice("Insight saved with its evidence.");
    } catch (err) { setError((err as Error).message); }
  }
  function editInsight(item: Insight) {
    setEditing(item); setObservation(item.data.observation); setInterpretation(item.data.interpretation); setAction(item.data.action);
    setValidation(item.data.validation); setReasoning(item.data.reasoning); setConfidence(item.data.confidence); setImpact(item.data.impact);
    setCitation(item.data.citations[0]?.runId + "|" + item.data.citations[0]?.evidenceId);
    setExtraCitations(item.data.citations.slice(1));
  }
  async function toggleInsight(item: Insight) {
    try { await request(base + "/insights/" + item.id, { method: "PUT", body: JSON.stringify({ revision: item.revision, data: { ...item.data, status: item.data.status === "active" ? "dismissed" : "active" } }) }); await refresh(); }
    catch (e) { setError((e as Error).message); }
  }
  async function showExport() {
    try { const data = await request<{ markdown: string }>(base + "/export"); setMarkdown(data.markdown); setTab("export"); }
    catch (e) { setError((e as Error).message); }
  }
  const trialEvidence = new Map<string, { scan: Scan; evidence: Evidence }>();
  for (const scan of scans) {
    const domain = scan.bundle.target?.domain || scan.bundle.brand.toLowerCase();
    if (trialEvidence.has(domain)) continue;
    const evidence = scan.bundle.evidence.find(e => e.kind === "observation" && e.data && typeof e.data === "object" && (e.data as { freeTrial?: boolean }).freeTrial === true);
    if (evidence) trialEvidence.set(domain, { scan, evidence });
  }
  const trialMatches = [...trialEvidence.values()];
  const latestScans = [...scans].sort((a, b) => (b.bundle.generatedAt || "").localeCompare(a.bundle.generatedAt || "")).filter((scan, index, all) => all.findIndex(other => (other.bundle.target?.domain || other.bundle.brand) === (scan.bundle.target?.domain || scan.bundle.brand)) === index);
  const channels = [...new Set(latestScans.flatMap(scan => (scan.bundle.scorecard || []).filter(item => ["active", "likely", "dormant"].includes(item.status) && item.evidence?.length).map(item => item.channel)))].sort();
  return <section className="workspace-panel decisions">
    <div className="decisions-head"><div><h2>Decision desk</h2><p>Bring evidence, performance and learning together.</p></div><button type="button" onClick={showExport}>Export case study</button></div>
    <nav className="decision-tabs" aria-label="Decision desk sections">{[["overview", "Overview"], ["insights", "Insights"], ["performance", "Performance"], ["feedback", "Feedback"], ["google", "Google"], ["assistant", "AI assistant"], ["export", "Export"]].map(([id, label]) => <button type="button" key={id} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {error && <p className="workspace-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {tab === "overview" && <div className="decision-overview">
      <article><span>MARKET SIGNALS</span><strong>{scans.length}</strong><p>Scans attached</p></article>
      <article><span>PRIORITY INSIGHTS</span><strong>{insights.filter(i => i.data.status === "active").length}</strong><p>Opportunities to review</p></article>
      <article><span>BRAND PERFORMANCE</span><strong>{imports.length}</strong><p>Campaign imports</p></article>
      <article><span>CUSTOMER VOICE</span><strong>{feedback.length}</strong><p>Reviewed excerpts</p></article>
      <div className="overview-note"><h3>Next decision</h3><p>{insights.find(i => i.data.status === "active")?.data.action || "Attach a scan and record an evidence-backed opportunity to begin."}</p><button type="button" onClick={() => setTab("insights")}>Review insights</button></div>
      <div className="overview-wide"><h3>Research coverage</h3>{latestScans.length === 0 ? <p>Attach research scans to see coverage.</p> : latestScans.map(scan => <p key={scan.run_id}><b>{scan.bundle.brand}</b> · recorded {scan.bundle.generatedAt ? new Date(scan.bundle.generatedAt).toLocaleDateString() : "date unavailable"} · {(scan.bundle.sources || []).filter(s => s.status === "ok").length} checks completed · {(scan.bundle.sources || []).filter(s => s.status === "error").length} errors · {(scan.bundle.unknowns || []).length} unknowns · <a href={"#/run/" + encodeURIComponent(scan.run_id)}>Open evidence</a></p>)}</div>
      {channels.length > 0 && <div className="overview-wide import-preview"><h3>Channel signals</h3><p>These labels summarize public evidence. They do not measure competitor performance.</p><table><thead><tr><th>Channel</th>{latestScans.map(scan => <th key={scan.run_id}>{scan.bundle.brand}</th>)}</tr></thead><tbody>{channels.map(channel => <tr key={channel}><th>{channel.replaceAll("_", " ")}</th>{latestScans.map(scan => { const item = scan.bundle.scorecard?.find(s => s.channel === channel); const label = item?.evidence?.length && item.status === "active" ? "Signal observed" : item?.evidence?.length && item.status === "likely" ? "Indirect signal" : item?.evidence?.length && item.status === "dormant" ? "Historical signal" : "Unknown"; return <td key={scan.run_id}><a href={"#/run/" + encodeURIComponent(scan.run_id)} title={item?.signal}>{label}</a></td>; })}</tr>)}</tbody></table></div>}
    </div>}
    {tab === "insights" && <div><h3>Evidence-backed opportunities</h3><p>Describe what was observed, what it might mean, and how you could check it.</p>
      {trialMatches.length >= 2 && <article className="workspace-record"><div className="insight-meta"><span>Observed pattern</span><span>{trialMatches.length} companies</span></div><h3>Free trial language appears in {trialMatches.length} company scans</h3><p>Review the original pages and dates before using this as a current market pattern.</p><button type="button" onClick={() => { const refs = trialMatches.map(({ scan, evidence }) => ({ runId: scan.run_id, evidenceId: evidence.id })); setEditing(null); setObservation(`${trialMatches.length} tracked companies mention a free trial.`); setInterpretation("A trial message may be relevant to our audience. This requires validation."); setAction("Test a trial-oriented message with the intended audience."); setValidation("Compare the selected outcome with a relevant alternative."); setConfidence("Medium"); setImpact("Medium"); setReasoning("Multiple companies have matching evidence; review freshness and relevance."); setCitation(refs[0]!.runId + "|" + refs[0]!.evidenceId); setExtraCitations(refs.slice(1)); }}>Review and save as insight</button></article>}
      {insights.map(item => <article className="workspace-record" key={item.id}><div className="insight-meta"><span>{item.data.status}</span><span>Confidence {item.data.confidence}</span><span>Impact {item.data.impact}</span></div><h3>{item.data.observation}</h3><p><b>Inference</b> · {item.data.interpretation}</p><p><b>Next action</b> · {item.data.action}</p><p><b>How to check</b> · {item.data.validation || "Not specified"}</p><p><b>Reason</b> · {item.data.reasoning || "Not specified"}</p>
        {item.data.citations.map(ref => { const scan = scans.find(s => s.run_id === ref.runId); const ev = scan?.bundle.evidence.find(e => e.id === ref.evidenceId); return <p key={ref.runId + ref.evidenceId}>Evidence · {scan?.bundle.brand || ref.runId} · {ev?.title || ref.evidenceId} · recorded {ev?.observedAt ? new Date(ev.observedAt).toLocaleDateString() : "date unavailable"} {safeSource(ev?.url) && <a href={safeSource(ev?.url)} target="_blank" rel="noreferrer">View source ↗</a>}</p>; })}
        <div className="decision-actions"><button type="button" onClick={() => editInsight(item)}>Edit</button><button type="button" onClick={() => toggleInsight(item)}>{item.data.status === "active" ? "Dismiss" : "Restore"}</button><button type="button" onClick={() => onExperiment(item.data.action, item.data.citations.map(ref => ref.runId + ":" + ref.evidenceId).join(", "))}>Plan experiment</button></div>
      </article>)}
      <form onSubmit={submitInsight}><h3>{editing ? "Edit insight" : "Create insight"}</h3><div className="workspace-fields">
        {textField(observation, setObservation, "What was observed", true)}{textField(interpretation, setInterpretation, "What it may mean for this brand", true)}
        {textField(action, setAction, "Suggested next action", true)}{textField(validation, setValidation, "What would confirm or disprove it", true)}
        <label>Evidence<select required value={citation} onChange={e => setCitation(e.target.value)}><option value="">Choose evidence</option>{scans.flatMap(s => s.bundle.evidence.map(ev => <option key={s.run_id + ev.id} value={s.run_id + "|" + ev.id}>{s.bundle.brand} · {ev.id} · {ev.title}</option>))}</select></label>
        <label>Confidence<select value={confidence} onChange={e => setConfidence(e.target.value)}><option>Low</option><option>Medium</option><option>High</option></select></label>
        <label>Impact<select value={impact} onChange={e => setImpact(e.target.value)}><option>Low</option><option>Medium</option><option>High</option></select></label>
        {textField(reasoning, setReasoning, "Reason for confidence and impact", true)}</div>
        <button type="submit">Save insight</button>{editing && <button type="button" onClick={() => setEditing(null)}>Cancel</button>}
      </form></div>}
    {tab === "performance" && <div><h3>Brand performance</h3><p>Figures come from your imported campaign data. Date filters include complete reporting periods only. Select comparable records to view a chart.</p>
      <div className="workspace-fields">
        <label>Source<select value={filterSource} onChange={e => setFilterSource(e.target.value)}><option value="">All sources</option>{[...new Set(rows.map(r => r.source))].map(v => <option key={v}>{v}</option>)}</select></label>
        <label>Import<select value={filterImport} onChange={e => setFilterImport(e.target.value)}><option value="">All imports</option>{imports.map(i => <option key={i.id} value={i.id}>{i.source} · {new Date(i.created_at).toLocaleString()}</option>)}</select></label>
        <label>Channel<select value={filterChannel} onChange={e => setFilterChannel(e.target.value)}><option value="">All channels</option>{[...new Set(rows.map(r => r.channel))].map(v => <option key={v}>{v}</option>)}</select></label>
        <label>Campaign<select value={filterCampaign} onChange={e => setFilterCampaign(e.target.value)}><option value="">All campaigns</option>{[...new Set(rows.map(r => r.campaign))].map(v => <option key={v}>{v}</option>)}</select></label>
        <label>Currency<select value={filterCurrency} onChange={e => setFilterCurrency(e.target.value)}><option value="">All currencies</option>{[...new Set(rows.map(r => r.currency).filter(Boolean))].map(v => <option key={v}>{v}</option>)}</select></label>
        <label>Frequency<select value={filterGrain} onChange={e => setFilterGrain(e.target.value)}><option value="">All frequencies</option>{[...new Set(rows.map(r => r.grain))].map(v => <option key={v}>{v}</option>)}</select></label>
        <label>Attribution window<select value={filterAttribution} onChange={e => setFilterAttribution(e.target.value)}><option value="">All windows</option>{[...new Set(rows.map(r => r.attribution))].map(v => <option key={v}>{v}</option>)}</select></label>
        <label>From period<input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></label>
        <label>To period<input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></label>
        <label>Metric<select value={metric} onChange={e => setMetric(e.target.value)}>{["impressions", "clicks", "visits", "leads", "purchases", "spend", "revenue"].map(v => <option key={v}>{v}</option>)}</select></label>
      </div>
      {!comparable ? <p>Select records from one source, reporting frequency, currency and attribution definition to chart them together.</p> : !chart.length ? <p>No values available for this selection.</p> : filtered.some(r => r.values[metric] === undefined) ? <p>Some selected records do not include {metric}. Refine the selection or import the missing values before calculating a total.</p> : <><p>Calculated total · {metric} · {sums(metric).toLocaleString()} {["spend", "revenue"].includes(metric) ? filtered[0]?.currency || "" : ""} · {filtered[0]?.source} · {chart[0]?.period} to {chart[chart.length - 1]?.period}</p><div className="performance-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chart}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="period" /><YAxis /><Tooltip /><Line type="monotone" dataKey="value" stroke="var(--chart-1)" strokeWidth={3} /></LineChart></ResponsiveContainer></div><table><thead><tr><th>Metric</th><th>Calculated value</th><th>Definition</th></tr></thead><tbody>{[
        ["CTR", rate, "clicks ÷ impressions", "%"],
        ["Lead conversion rate", ratio("leads", "visits", 100), "leads ÷ visits", "%"],
        ["Click-to-purchase rate", ratio("purchases", "clicks", 100), "purchases ÷ clicks", "%"],
        ["Cost per click", ratio("spend", "clicks"), "spend ÷ clicks", filtered[0]?.currency || ""],
        ["Cost per lead", ratio("spend", "leads"), "spend ÷ leads", filtered[0]?.currency || ""],
        ["Cost per purchase", ratio("spend", "purchases"), "spend ÷ purchases", filtered[0]?.currency || ""],
      ].map(([label, value, definition, unit]) => <tr key={String(label)}><td>{label}</td><td>{value === null ? "Unavailable" : Number(value).toFixed(2) + " " + unit}</td><td>{definition}</td></tr>)}</tbody></table><p>Rates use sums of all selected rows. Missing values or zero denominators make a rate unavailable.</p><table><thead><tr><th>Period</th><th>{metric}</th><th>Rows</th></tr></thead><tbody>{chart.map(r => <tr key={r.period}><td>{r.period}</td><td>{r.value === null ? "No data" : r.value}</td><td>{r.count}</td></tr>)}</tbody></table>
      {chart.length >= 2 && (() => { const first = chart[0]!; const last = chart[chart.length - 1]!; const a = periodCtr(first.period); const b = periodCtr(last.period); if (!a || !b) return null; return <p>CTR comparison · {first.period}: {a.value.toFixed(2)}% ({a.clicks} clicks / {a.impressions} impressions) · {last.period}: {b.value.toFixed(2)}% ({b.clicks} clicks / {b.impressions} impressions) · {(b.value - a.value).toFixed(2)} percentage points{a.value !== 0 ? " · " + ((b.value - a.value) / a.value * 100).toFixed(2) + "% relative" : ""}. Descriptive comparison, with no causal claim.</p>; })()}</>}
      <hr /><h3>Import campaign CSV</h3><p>Use ISO dates (YYYY-MM-DD). Review the mapping and validation results before saving.</p>
      <div className="workspace-fields"><label>CSV file<input type="file" accept=".csv,text/csv" onChange={async e => { const file = e.target.files?.[0]; if (file && file.size <= 10_000_000) { setCsv(await file.text()); setPreview(null); setMapping({}); } else if (file) setError("File must be under 10 MB."); }} /></label>
        {textField(source, setSource, "Source name")}<label>Reporting frequency<select value={grain} onChange={e => setGrain(e.target.value)}><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
        {textField(currency, setCurrency, "Default currency (e.g. USD)")}{textField(attribution, setAttribution, "Attribution window")}</div><button type="button" disabled={!csv || !source} onClick={previewFile}>Preview import</button>
      {preview && <div><h3>Column mapping · {preview.rowCount} rows</h3><div className="workspace-fields">{fields.map(field => <label key={field}>{field}<select value={mapping[field] || ""} onChange={e => setMapping({ ...mapping, [field]: e.target.value })}><option value="">Not mapped</option>{preview.headers.map(h => <option key={h}>{h}</option>)}</select></label>)}</div>{preview.errors.map((message, i) => <p className="workspace-error" key={i}>{message}</p>)}{previewKey !== JSON.stringify(options()) && <p>Settings changed. Preview again before saving.</p>}<div className="import-preview"><table><thead><tr><th>Row</th><th>Date</th><th>Channel</th><th>Campaign</th><th>Values</th></tr></thead><tbody>{preview.rows.map(r => <tr key={r.rowNumber}><td>{r.rowNumber}</td><td>{r.date}</td><td>{r.channel}</td><td>{r.campaign}</td><td>{Object.entries(r.values).map(([k,v]) => k + ": " + v).join(", ")}</td></tr>)}</tbody></table></div><button type="button" disabled={!!preview.errors.length || previewKey !== JSON.stringify(options())} onClick={importFile}>Save import</button></div>}
      <h3>Import history</h3>{imports.map(i => <div className="workspace-record" key={i.id}><p>{i.source} · {i.grain} · {i.attribution} · {new Date(i.created_at).toLocaleDateString()}</p><button type="button" onClick={async () => { const data = await request<{original:string}>(base + "/imports/" + i.id); const url = URL.createObjectURL(new Blob([data.original], { type: "text/csv" })); const a = document.createElement("a"); a.href = url; a.download = "campaign-data.csv"; a.click(); URL.revokeObjectURL(url); }}>Download original</button> <button type="button" onClick={async () => { if (!confirm("Remove this import and its measurements?")) return; try { await request(base + "/imports/" + i.id, { method: "DELETE" }); await refresh(); } catch (e) { setError((e as Error).message); } }}>Remove</button></div>)}
    </div>}
    {tab === "feedback" && <div><h3>Customer feedback</h3><p>Review and remove names or identifying details before saving. Theme counts describe only the excerpts entered here.</p>
      <label>Load a text or CSV file for review<input type="file" accept=".txt,.csv,text/plain,text/csv" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 1_000_000) { setError("Feedback file must be under 1 MB."); return; } try { const content = await file.text(); if (file.name.toLowerCase().endsWith(".csv")) { const all = parseCsv(content, { bom: true, skip_empty_lines: true }) as string[][]; setFeedbackHeaders(all[0] || []); setFeedbackRows(all.slice(1)); setFeedbackColumn(""); } else { setFeedbackHeaders([]); setFeedbackRows([]); setExcerpt(content); } setError(""); } catch { setError("Could not read feedback file."); } }} /></label>
      {feedbackHeaders.length > 0 && <div className="workspace-fields"><label>Excerpt column<select value={feedbackColumn} onChange={e => setFeedbackColumn(e.target.value)}><option value="">Choose column</option>{feedbackHeaders.map((h, i) => <option key={i} value={String(i)}>{h}</option>)}</select></label>{feedbackColumn !== "" && <label>Choose a response to review<select defaultValue="" onChange={e => { if (e.target.value !== "") setExcerpt(feedbackRows[Number(e.target.value)]?.[Number(feedbackColumn)] || ""); }}><option value="">Choose response</option>{feedbackRows.map((row, i) => <option key={i} value={String(i)}>{(row[Number(feedbackColumn)] || "").slice(0, 100)}</option>)}</select></label>}</div>}
      <form onSubmit={submitFeedback}><div className="workspace-fields">{textField(excerpt, setExcerpt, "Reviewed excerpt", true)}{textField(feedbackSource, setFeedbackSource, "Source")}{textField(theme, setTheme, "Theme")}</div>
        {/(\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\+?\d[\d\s()-]{8,}\d)/i.test(excerpt) && <p className="workspace-error">Possible email or phone number detected. Edit the excerpt before saving.</p>}
        <button type="submit" disabled={!excerpt.trim() || !feedbackSource.trim() || !theme.trim() || /(\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\+?\d[\d\s()-]{8,}\d)/i.test(excerpt)}>Save reviewed excerpt</button></form>
      {[...new Set(feedback.map(f => f.theme))].map(t => <article className="workspace-record" key={t}><h3>{t}</h3><p>{feedback.filter(f => f.theme === t).length} of {feedback.length} saved excerpts</p>{feedback.filter(f => f.theme === t).map(f => <blockquote key={f.id}><p>“{f.excerpt}”</p><small>{f.source} · {new Date(f.created_at).toLocaleDateString()}</small> <button type="button" onClick={async () => { await request(base + "/feedback/" + f.id, { method: "DELETE" }); await refresh(); }}>Remove</button></blockquote>)}</article>)}
    </div>}
    {tab === "google" && <GoogleConnections workspaceId={workspaceId} />}
    {tab === "assistant" && <McpShare workspaceId={workspaceId} />}
    {tab === "export" && <div className="case-export"><h3>Case-study export</h3><p>Review the generated document before sharing. It includes workspace details, attached public evidence, insights and experiments.</p><button type="button" onClick={showExport}>Refresh preview</button> <button type="button" disabled={!markdown} onClick={() => { const url = URL.createObjectURL(new Blob([markdown], {type:"text/markdown"})); const a = document.createElement("a"); a.href = url; a.download = "marketing-case-study.md"; a.click(); URL.revokeObjectURL(url); }}>Download Markdown</button> <button type="button" disabled={!markdown} onClick={() => window.print()}>Print / save PDF</button><pre>{markdown || "Choose refresh preview to generate the case study."}</pre></div>}
  </section>;
}
