import { useEffect, useState } from "react";

type Preview = { snapshot: unknown; hash: string };
type Draft = { id: string; kind: string; data: unknown; createdAt: string };
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "content-type": "application/json" } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data as T;
}
export function McpShare({ workspaceId }: { workspaceId: string }) {
  const base = "/api/workspaces/" + workspaceId + "/mcp/";
  const [preview, setPreview] = useState<Preview | null>(null);
  const [share, setShare] = useState<{ id: string; token: string; expires: string } | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [shares, setShares] = useState<{ id: string; expires_at: string }[]>([]);
  const [editing, setEditing] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  async function refresh() {
    const [pending, active] = await Promise.all([request<Draft[]>(base + "drafts"), request<{ id: string; expires_at: string }[]>(base + "shares")]);
    setDrafts(pending); setShares(active);
  }
  useEffect(() => { refresh().catch(e => setError(e.message)); }, [workspaceId]);
  return <div><h3>AI assistant access</h3><p>Review the exact workspace profile and public evidence to share with a local MCP client. Feedback, campaign figures, Google reports and keys are excluded. A share expires after 24 hours.</p>
    {error && <p className="workspace-error" role="alert">{error}</p>}
    <button type="button" onClick={async () => { try { setPreview(await request<Preview>(base + "preview")); setError(""); } catch (e) { setError((e as Error).message); } }}>Preview shared data</button>
    {preview && <div><pre className="mcp-preview">{JSON.stringify(preview.snapshot, null, 2)}</pre><button type="button" onClick={async () => { try { setShare(await request(base + "shares", { method: "POST", body: JSON.stringify({ hash: preview.hash }) })); setPreview(null); await refresh(); setError(""); } catch (e) { setError((e as Error).message); } }}>Approve this snapshot</button></div>}
    {share && <div className="workspace-record"><p>Share token, valid until {new Date(share.expires).toLocaleString()}. Give it to the MCP client to use with <code>get_workspace_summary</code>. Copy it now, it will not be displayed again.</p><input aria-label="Share token" readOnly value={share.token} /><div className="decision-actions"><button type="button" onClick={() => navigator.clipboard.writeText(share.token)}>Copy token</button></div></div>}
    {shares.map(active => <div className="workspace-record" key={active.id}><p>Active share · expires {new Date(active.expires_at).toLocaleString()}</p><button type="button" onClick={async () => { await request(base + "shares/" + active.id, { method: "DELETE" }); if (share?.id === active.id) setShare(null); await refresh(); }}>Revoke share</button></div>)}
    <h3>Pending assistant drafts</h3><p>Drafts become workspace records only after you review and accept them.</p><button type="button" onClick={() => refresh().catch(e => setError(e.message))}>Refresh drafts</button>
    {drafts.length === 0 && <p>No drafts waiting.</p>}
    {drafts.map(draft => <article className="workspace-record" key={draft.id}><h3>{draft.kind} draft</h3><p>{new Date(draft.createdAt).toLocaleString()}</p>
      {editing === draft.id ? <textarea aria-label="Draft JSON" value={content} onChange={e => setContent(e.target.value)} rows={12} /> : <pre className="mcp-preview">{JSON.stringify(draft.data, null, 2)}</pre>}
      <div className="decision-actions"><button type="button" onClick={() => { setEditing(draft.id); setContent(JSON.stringify(draft.data, null, 2)); }}>Review / edit</button>{editing === draft.id && <button type="button" onClick={async () => { try { await request(base + "drafts/" + draft.id, { method: "POST", body: JSON.stringify(JSON.parse(content)) }); setEditing(""); setError(""); await refresh(); } catch (e) { setError((e as Error).message); } }}>Accept draft</button>}
        <button type="button" onClick={async () => { await request(base + "drafts/" + draft.id, { method: "DELETE" }); await refresh(); }}>Discard</button></div></article>)}
  </div>;
}
