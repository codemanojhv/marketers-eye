// Local web app: `marketers-eye web`. Binds to 127.0.0.1 only and rejects foreign
// Host/Origin headers, because it can spawn the user's Claude Code / Codex.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { readConfig, writeConfig, type ApiKeyProvider, type UserConfig } from "../config.js";
import { detectEngines, listTextModels, writeReport, type ApiEngineId, type EngineId } from "../engines.js";
import { AREAS, analyzeMarketing, VERSION, type Area, type EvidenceBundle } from "../index.js";
import { renderMarkdown } from "../report/markdown.js";
import { validateReport } from "../report/validate.js";
import { listRuns, loadReport, loadRun, saveReport, saveRun } from "../runs.js";
import { PAGE, WEB_ASSET_DIR } from "./page.js";
import { attachScan, createExperiment, createWorkspace, getWorkspace, listExperiments, listWorkspaceScans, listWorkspaces, updateExperiment, updateWorkspace } from "../workspaces.js";

type Event = { type: string; [k: string]: unknown };

interface Job {
  id: string;
  runId?: string;
  events: Event[];
  listeners: Set<ServerResponse>;
  done: boolean;
  abort: AbortController;
}

const jobs = new Map<string, Job>();
const API_KEY_PROVIDERS: ApiKeyProvider[] = ["anthropic", "gemini", "openai", "deepseek"];

function emit(job: Job, e: Event): void {
  job.events.push(e);
  const chunk = `data: ${JSON.stringify(e)}\n\n`;
  for (const res of job.listeners) res.write(chunk);
  if (e.type === "done") {
    job.done = true;
    for (const res of job.listeners) res.end();
    job.listeners.clear();
  }
}

/** Summary the UI renders while the report is being written. */
function bundleView(b: EvidenceBundle) {
  return {
    brand: b.brand,
    target: b.target,
    discovered: b.discovered,
    scorecard: b.scorecard,
    evidence: b.evidence,
    unknowns: b.unknowns,
    sources: b.sources ?? [],
    credits: b.credits,
    harness: b.harness,
    generatedAt: b.generatedAt,
    identity: b.identity ?? { logos: [], founders: [] },
    content: b.content ?? [],
  };
}

async function startJob(body: { url: string; engine: EngineId; model?: string; only?: Area[]; handles?: Record<string, string> }): Promise<Job> {
  const job: Job = { id: randomUUID().slice(0, 8), events: [], listeners: new Set(), done: false, abort: new AbortController() };
  jobs.set(job.id, job);
  void (async () => {
    try {
      emit(job, { type: "stage", stage: "collect", state: "start" });
      const bundle = await analyzeMarketing(body.url, {
        only: body.only?.filter(a => AREAS.includes(a)),
        handles: body.handles,
        log: msg => emit(job, { type: "log", msg }),
        onStage: (stage, state, detail) => emit(job, { type: "stage", stage, state, detail }),
      });
      const { id } = await saveRun(bundle);
      job.runId = id;
      emit(job, { type: "stage", stage: "collect", state: "done" });
      emit(job, { type: "bundle", runId: id, bundle: bundleView(bundle) });

      if (body.engine === "none") {
        emit(job, { type: "report", markdown: renderMarkdown(bundle), engine: "none" });
      } else {
        emit(job, { type: "stage", stage: "write", state: "start" });
        const res = await writeReport(body.engine, bundle, {
          model: body.model || undefined,
          signal: job.abort.signal,
          onText: delta => emit(job, { type: "delta", text: delta, replace: body.engine === "codex" }),
          onStatus: msg => emit(job, { type: "status", msg }),
        });
        const validation = validateReport(res.markdown, bundle);
        await saveReport(id, res.markdown, { engine: body.engine, model: res.model });
        emit(job, { type: "stage", stage: "write", state: "done" });
        emit(job, { type: "report", markdown: res.markdown, engine: body.engine, model: res.model, validation });
      }
    } catch (err) {
      emit(job, { type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      emit(job, { type: "done" });
      setTimeout(() => jobs.delete(job.id), 30 * 60_000);
    }
  })();
  return job;
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<any> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error("body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

export function startWeb(port: number): Promise<string> {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const server = createServer(async (req, res) => {
    try {
      // DNS-rebinding / CSRF guard: only our own origin may talk to us.
      if (!allowedHosts.has(req.headers.host ?? "")) return json(res, 403, { error: "forbidden host" });
      const origin = req.headers.origin;
      if (req.method !== "GET" && origin && !allowedHosts.has(origin.replace(/^https?:\/\//, ""))) return json(res, 403, { error: "forbidden origin" });

      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const path = url.pathname;

      if (path === "/api/workspaces") {
        if (req.method === "GET") return json(res, 200, listWorkspaces());
        if (req.method === "POST") return json(res, 201, createWorkspace(await readBody(req)));
      }
      const workspace = path.match(/^\/api\/workspaces\/([a-f0-9-]+)(?:\/(scans|experiments)(?:\/([a-f0-9-]+))?)?$/);
      if (workspace) {
        const [, id, section, item] = workspace;
        if (!id || !getWorkspace(id)) return json(res, 404, { error: "Workspace not found" });
        if (!section && req.method === "GET") return json(res, 200, getWorkspace(id));
        if (!section && req.method === "PUT") {
          const body = await readBody(req);
          return json(res, 200, updateWorkspace(id, body.revision, body.profile));
        }
        if (section === "scans" && req.method === "GET") return json(res, 200, listWorkspaceScans(id));
        if (section === "scans" && req.method === "POST") {
          const body = await readBody(req);
          if (typeof body.runId !== "string" || !/^[A-Za-z0-9._-]+$/.test(body.runId)) return json(res, 400, { error: "Invalid run ID" });
          attachScan(id, body.runId, await loadRun(body.runId));
          return json(res, 201, { ok: true });
        }
        if (section === "experiments" && !item && req.method === "GET") return json(res, 200, listExperiments(id));
        if (section === "experiments" && !item && req.method === "POST") return json(res, 201, { id: createExperiment(id, await readBody(req)) });
        if (section === "experiments" && item && req.method === "PUT") {
          const body = await readBody(req);
          updateExperiment(id, item, body.revision, body.data);
          return json(res, 200, { ok: true });
        }
      }

      if (req.method === "GET" && path === "/") {
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          "x-frame-options": "DENY",
          // Scripts only from us + the two pinned CDNs; no framing; API calls only to ourselves.
          "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src * data: blob:; media-src *; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        });
        return res.end(PAGE);
      }
      const asset = req.method === "GET" ? path.match(/^\/assets\/([A-Za-z0-9][A-Za-z0-9._-]*)$/) : null;
      if (asset) {
        const contentType: Record<string, string> = { ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
        try {
          const body = await readFile(join(WEB_ASSET_DIR, asset[1]!));
          res.writeHead(200, { "content-type": contentType[extname(asset[1]!).toLowerCase()] ?? "application/octet-stream", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" });
          return res.end(body);
        } catch {
          return json(res, 404, { error: "not found" });
        }
      }
      if (req.method === "GET" && path === "/api/status") {
        const cfg = readConfig();
        return json(res, 200, {
          version: VERSION,
          engines: await detectEngines(),
          scrapecreators: { set: Boolean(process.env.SCRAPECREATORS_API_KEY || process.env.SCRAPE_CREATORS_API_KEY), fromConfig: Boolean(cfg.scrapecreatorsKey) },
          apiKeys: {
            anthropic: { set: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || cfg.apiKeys?.anthropic), fromConfig: Boolean(cfg.apiKeys?.anthropic) },
            gemini: { set: Boolean(process.env.GEMINI_API_KEY || cfg.apiKeys?.gemini), fromConfig: Boolean(cfg.apiKeys?.gemini) },
            openai: { set: Boolean(process.env.OPENAI_API_KEY || cfg.apiKeys?.openai), fromConfig: Boolean(cfg.apiKeys?.openai) },
            deepseek: { set: Boolean(process.env.DEEPSEEK_API_KEY || cfg.apiKeys?.deepseek), fromConfig: Boolean(cfg.apiKeys?.deepseek) },
          },
          areas: AREAS,
        });
      }
      const modelList = path.match(/^\/api\/models\/(anthropic-api|gemini|openai|deepseek)$/);
      if (req.method === "GET" && modelList) return json(res, 200, { models: await listTextModels(modelList[1] as ApiEngineId) });
      if (req.method === "POST" && path === "/api/settings") {
        const body = await readBody(req);
        const patch: UserConfig = {};
        if (body.removeScrapeCreatorsKey === true) patch.scrapecreatorsKey = "";
        else if (typeof body.scrapecreatorsKey === "string") {
          if (body.scrapecreatorsKey.length > 4096) return json(res, 400, { error: "Scrape Creators key is too long" });
          patch.scrapecreatorsKey = body.scrapecreatorsKey.trim();
        }
        const config = readConfig();
        const apiKeys = { ...(config.apiKeys ?? {}) };
        if (body.apiKeys !== undefined) {
          if (!body.apiKeys || typeof body.apiKeys !== "object" || Array.isArray(body.apiKeys)) return json(res, 400, { error: "apiKeys must be an object" });
          for (const [provider, value] of Object.entries(body.apiKeys)) {
            if (!API_KEY_PROVIDERS.includes(provider as ApiKeyProvider)) return json(res, 400, { error: "Unknown API key provider" });
            if (typeof value !== "string" || value.length > 4096) return json(res, 400, { error: "API keys must be strings no longer than 4096 characters" });
            if (value.trim()) apiKeys[provider as ApiKeyProvider] = value.trim();
          }
        }
        if (body.removeApiKeys !== undefined) {
          if (!Array.isArray(body.removeApiKeys) || body.removeApiKeys.some((provider: unknown) => typeof provider !== "string" || !API_KEY_PROVIDERS.includes(provider as ApiKeyProvider))) return json(res, 400, { error: "removeApiKeys must contain supported providers" });
          for (const provider of body.removeApiKeys as ApiKeyProvider[]) delete apiKeys[provider];
        }
        if (body.apiKeys !== undefined || body.removeApiKeys !== undefined) patch.apiKeys = Object.keys(apiKeys).length ? apiKeys : undefined;
        if (!Object.keys(patch).length) return json(res, 400, { error: "No settings were provided" });
        writeConfig(patch);
        return json(res, 200, { ok: true });
      }
      if (req.method === "GET" && path === "/api/runs") return json(res, 200, await listRuns());
      if (req.method === "POST" && path === "/api/runs") {
        const body = await readBody(req);
        if (typeof body.url !== "string" || !body.url.trim()) return json(res, 400, { error: "url is required" });
        if (!["claude-code", "codex", "anthropic-api", "gemini", "openai", "deepseek", "none"].includes(body.engine)) return json(res, 400, { error: "bad engine" });
        const job = await startJob(body);
        return json(res, 200, { jobId: job.id });
      }
      const ev = path.match(/^\/api\/jobs\/([a-z0-9-]+)\/events$/);
      if (req.method === "GET" && ev) {
        const job = jobs.get(ev[1]!);
        if (!job) return json(res, 404, { error: "unknown job" });
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        for (const e of job.events) res.write(`data: ${JSON.stringify(e)}\n\n`);
        if (job.done) return res.end();
        job.listeners.add(res);
        req.on("close", () => job.listeners.delete(res));
        return;
      }
      const cancel = path.match(/^\/api\/jobs\/([a-z0-9-]+)\/cancel$/);
      if (req.method === "POST" && cancel) {
        jobs.get(cancel[1]!)?.abort.abort();
        return json(res, 200, { ok: true });
      }
      const run = path.match(/^\/api\/runs\/([A-Za-z0-9._-]+)$/);
      if (req.method === "GET" && run) {
        const bundle = await loadRun(run[1]!);
        const report = await loadReport(run[1]!);
        return json(res, 200, { runId: run[1], bundle: bundleView(bundle), report, validation: report ? validateReport(report.markdown, bundle) : null });
      }
      json(res, 404, { error: "not found" });
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(`http://localhost:${port}`));
  });
}
