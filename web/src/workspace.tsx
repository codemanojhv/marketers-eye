import { useEffect, useState, type FormEvent } from "react";
import { Decisions } from "./decisions.js";

type Profile = Record<string, string | string[]>;
type Workspace = { id: string; revision: number; profile: Profile };
type Scan = { run_id: string; bundle: { brand: string; generatedAt: string; evidence: { id: string; title: string; url?: string; observedAt: string }[]; unknowns: { reason: string }[]; sources?: { status: string }[] } };
type Run = { id: string; brand: string; at: string };
type Experiment = { id: string; revision: number; data: Record<string, string> };

function safeSource(url?: string) {
  try {
    const parsed = new URL(url || "");
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : undefined;
  } catch { return undefined; }
}
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json" } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body as T;
}
const fields = [
  ["name", "Brand name"], ["website", "Website"], ["goal", "Business goal"], ["question", "Decision question"],
  ["product", "Product"], ["category", "Category"], ["market", "Market"], ["location", "Location"],
  ["audience", "Target audience"], ["problem", "Customer problem"], ["positioning", "Positioning"],
  ["alternatives", "Main alternatives"], ["channels", "Current channels"], ["constraints", "Constraints"],
  ["metric", "Key metric"], ["baseline", "Baseline and source"],
] as const;
const experimentFields = [
  ["hypothesis", "Hypothesis"], ["audience", "Audience"], ["channel", "Channel"],
  ["treatment", "Variant or offer"], ["comparison", "Comparison group or period"], ["metric", "Primary metric"],
  ["guardrail", "Guardrail metric"], ["baseline", "Baseline and source"], ["owner", "Owner"],
  ["startDate", "Start date"], ["endDate", "End date"], ["reviewDate", "Review date"],
  ["budget", "Budget and currency"], ["comparisonType", "Comparison design"], ["evidence", "Supporting evidence"], ["result", "Result and source"], ["learning", "What was learned"], ["decision", "Next decision"],
] as const;
const emptyProfile = Object.fromEntries(fields.map(([key]) => [key, ""]));
const emptyExperiment = { ...Object.fromEntries(experimentFields.map(([key]) => [key, ""])), status: "planned" };

export function WorkspaceApp() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState<Workspace | null>(null);
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [competitors, setCompetitors] = useState("");
  const [scans, setScans] = useState<Scan[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [experiment, setExperiment] = useState<Record<string, string>>(emptyExperiment);
  const [editing, setEditing] = useState<Experiment | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [scanning, setScanning] = useState(false);
  const refresh = async (id?: string) => {
    setWorkspaces(await api<Workspace[]>("/api/workspaces"));
    if (id) {
      const [current, savedScans, savedExperiments] = await Promise.all([
        api<Workspace>("/api/workspaces/" + id), api<Scan[]>("/api/workspaces/" + id + "/scans"),
        api<Experiment[]>("/api/workspaces/" + id + "/experiments"),
      ]);
      setSelected(current); setProfile(current.profile);
      localStorage.setItem("marketers-eye-workspace", current.id);
      setCompetitors((current.profile.competitors as string[] || []).join("\n"));
      setScans(savedScans); setExperiments(savedExperiments);
    }
    setRuns(await api<Run[]>("/api/runs"));
  };
  useEffect(() => { const last = localStorage.getItem("marketers-eye-workspace"); refresh(last || undefined).catch(() => { localStorage.removeItem("marketers-eye-workspace"); refresh().catch(e => setError(e.message)); }); }, []);
  async function saveProfile(event: FormEvent) {
    event.preventDefault(); setError("");
    try {
      const data = { ...profile, competitors: competitors.split("\n").map(s => s.trim()).filter(Boolean) };
      const saved = await api<Workspace>(selected ? "/api/workspaces/" + selected.id : "/api/workspaces", {
        method: selected ? "PUT" : "POST", body: JSON.stringify(selected ? { revision: selected.revision, profile: data } : data),
      });
      await refresh(saved.id); setNotice("Workspace saved.");
    } catch (e) { setError((e as Error).message); }
  }
  async function attach(runId: string) {
    if (!selected || !runId) return;
    try { await api("/api/workspaces/" + selected.id + "/scans", { method: "POST", body: JSON.stringify({ runId }) }); await refresh(selected.id); setNotice("Scan attached."); }
    catch (e) { setError((e as Error).message); }
  }
  async function scanTracked() {
    if (!selected || scanning) return;
    setScanning(true); setError("");
    const targets = [...new Set([String(selected.profile.website), ...(selected.profile.competitors as string[] || [])])];
    const errors: string[] = [];
    for (const target of targets) {
      setNotice("Scanning " + target + " using public website sources…");
      try {
        const job = await api<{ jobId: string }>("/api/runs", { method: "POST", body: JSON.stringify({ url: target, engine: "none", only: ["website"] }) });
        const runId = await new Promise<string>((resolve, reject) => {
          const stream = new EventSource("/api/jobs/" + encodeURIComponent(job.jobId) + "/events");
          let saved = ""; let failure = "";
          stream.onmessage = event => {
            const data = JSON.parse(event.data);
            if (data.type === "bundle") saved = data.runId;
            if (data.type === "error") failure = data.message;
            if (data.type === "done") { stream.close(); saved ? resolve(saved) : reject(new Error(failure || "Scan did not return a result.")); }
          };
          stream.onerror = () => { stream.close(); reject(new Error("Lost scan progress connection.")); };
        });
        await api("/api/workspaces/" + selected.id + "/scans", { method: "POST", body: JSON.stringify({ runId }) });
      } catch (e) { errors.push(target + ": " + (e as Error).message); }
    }
    try { await refresh(selected.id); } catch (e) { errors.push((e as Error).message); }
    setScanning(false); setNotice(errors.length ? "Some scans need attention." : "Tracked website scans saved.");
    if (errors.length) setError(errors.join(" "));
  }
  async function saveExperiment(event: FormEvent) {
    event.preventDefault(); if (!selected) return;
    try {
      await api("/api/workspaces/" + selected.id + "/experiments" + (editing ? "/" + editing.id : ""), {
        method: editing ? "PUT" : "POST", body: JSON.stringify(editing ? { revision: editing.revision, data: experiment } : experiment),
      });
      setExperiment(emptyExperiment); setEditing(null); await refresh(selected.id); setNotice("Experiment saved."); setError("");
    } catch (e) { setError((e as Error).message); }
  }
  return <div className="workspace-shell">
    <div className="workspace-heading"><div><p>MARKETER'S EYE</p><h1>Decision workspace</h1><span>Connect research to the work you plan to test.</span></div><a href="#/">Quick scan ↗</a></div>
    {error && <p role="alert" className="workspace-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="workspace-grid">
      <aside className="workspace-panel"><h2>Brands</h2><button type="button" onClick={() => { localStorage.removeItem("marketers-eye-workspace"); setSelected(null); setProfile(emptyProfile); setCompetitors(""); setScans([]); setExperiments([]); }}>+ New workspace</button>
        {workspaces.map(w => <button type="button" className="workspace-choice" key={w.id} onClick={() => refresh(w.id).catch(e => setError(e.message))}>{String(w.profile.name)}</button>)}
      </aside>
      <div className="workspace-content">
        <section className="workspace-panel workspace-profile"><details key={selected?.id || "new"} open={!selected}><summary><h2>{selected ? String(selected.profile.name) + " · Brand profile" : "Create a workspace"}</h2>{selected && <span>Edit profile</span>}</summary><p>Start with the brand, its goal, and the decision you want to make.</p>
          <form onSubmit={saveProfile}><div className="workspace-fields">{fields.map(([key, label], index) => <label key={key}>{label}{index < 4 && " *"}<input required={index < 4} value={String(profile[key] || "")} onChange={e => setProfile({ ...profile, [key]: e.target.value })} /></label>)}
          <label className="workspace-wide">Competitor websites, one per line<textarea value={competitors} onChange={e => setCompetitors(e.target.value)} /></label></div><button type="submit">Save workspace</button></form></details>
        </section>
        {selected && <>
          <section className="workspace-goal"><p>WORKSPACE · {String(selected.profile.name)}</p><h2>{String(selected.profile.question)}</h2><div>Goal · {String(selected.profile.goal)} {selected.profile.metric ? " · Metric · " + String(selected.profile.metric) : ""}</div></section>
          <Decisions key={selected.id} workspaceId={selected.id} scans={scans} onExperiment={(hypothesis, evidence) => { setEditing(null); setExperiment({ ...emptyExperiment, hypothesis, evidence }); document.getElementById("experiment-form")?.scrollIntoView({ behavior: "smooth" }); }} />
          <section className="workspace-panel"><h2>Market signals</h2><p>Attach a saved scan to keep its observations and unknowns with this workspace.</p>
            <button type="button" disabled={scanning} onClick={scanTracked}>{scanning ? "Scanning…" : "Scan tracked websites"}</button><p>Scans the brand and saved competitor websites using the website collector.</p>
            <label>Saved scans <select defaultValue="" onChange={e => { void attach(e.target.value); e.target.value = ""; }}><option value="">Choose a scan to attach</option>{runs.map(r => <option key={r.id} value={r.id}>{r.brand} · {r.at}</option>)}</select></label>
            {scans.length === 0 && <p>No scans attached yet. Run a quick scan, then add it here.</p>}
            {scans.map(s => <article className="workspace-record" key={s.run_id}><h3>{s.bundle.brand}</h3><p>Recorded {new Date(s.bundle.generatedAt).toLocaleDateString()} · {s.bundle.evidence.length} evidence records · {s.bundle.unknowns.length} unknowns</p>
              <p>{(s.bundle.sources || []).filter(v => v.status === "ok").length} collectors completed</p>
              <details><summary>View evidence</summary><ul>{s.bundle.evidence.map(e => <li key={e.id}>{e.title} · recorded {e.observedAt ? new Date(e.observedAt).toLocaleDateString() : "date unavailable"} {safeSource(e.url) && <a href={safeSource(e.url)} target="_blank" rel="noreferrer">Source</a>}</li>)}</ul><h4>Unknowns</h4><ul>{s.bundle.unknowns.map((u, i) => <li key={i}>{u.reason}</li>)}</ul></details>
            </article>)}
          </section>
          <section className="workspace-panel"><h2>Experiments</h2><p>Record a hypothesis, a review date, and what you learn.</p>
            {experiments.map(item => <article className="workspace-record" key={item.id}><h3>{item.data.hypothesis}</h3><p>{item.data.status} · {item.data.owner || "Owner not set"} · {item.data.reviewDate || "Review date not set"}</p><button type="button" onClick={() => { setEditing(item); setExperiment(item.data); }}>Edit experiment</button></article>)}
            <form id="experiment-form" onSubmit={saveExperiment}><h3>{editing ? "Edit experiment" : "Plan an experiment"}</h3><div className="workspace-fields">{experimentFields.map(([key, label]) => <label key={key}>{label}<input required={key === "hypothesis"} type={key.endsWith("Date") ? "date" : "text"} value={experiment[key] || ""} onChange={e => setExperiment({ ...experiment, [key]: e.target.value })} /></label>)}
              {editing && <label>Status<select value={experiment.status} onChange={e => setExperiment({ ...experiment, status: e.target.value })}><option value="planned">Planned</option><option value="running">Running</option><option value="paused">Paused</option><option value="complete">Complete</option></select></label>}
            </div><button type="submit">Save experiment</button>{editing && <button type="button" onClick={() => { setEditing(null); setExperiment(emptyExperiment); }}>Cancel edit</button>}</form>
          </section>
        </>}
      </div>
    </div>
  </div>;
}
