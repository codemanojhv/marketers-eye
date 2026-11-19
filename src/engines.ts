// Report writers. "claude-code" and "codex" run the locally installed CLIs,
// so the report is billed to the user's Claude or ChatGPT subscription, not an
// API key. API keys are stripped from their env so the subscription login wins.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import Anthropic from "@anthropic-ai/sdk";
import { synthesize, userPrompt } from "./analyze/synthesize.js";
import { loadHarness, systemPrompt } from "./harness.js";
import type { EvidenceBundle } from "./index.js";

export type ApiEngineId = "anthropic-api" | "gemini" | "openai" | "deepseek";
export type EngineId = "claude-code" | "codex" | "anthropic-api" | ApiEngineId | "none";

export interface EngineInfo {
  id: EngineId;
  label: string;
  available: boolean;
  detail: string;
}

export async function detectEngines(): Promise<EngineInfo[]> {
  const [claude, codex] = await Promise.all([version("claude"), version("codex")]);
  const api = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  return [
    { id: "claude-code", label: "Claude Code", available: Boolean(claude), detail: claude ? `${claude} · uses your Claude subscription` : "not installed (npm i -g @anthropic-ai/claude-code)" },
    { id: "codex", label: "Codex", available: Boolean(codex), detail: codex ? `${codex} · uses your ChatGPT subscription` : "not installed (npm i -g @openai/codex)" },
    { id: "anthropic-api", label: "Anthropic API", available: api, detail: api ? "API key configured · billed per token" : "add a key under API keys" },
    { id: "gemini", label: "Gemini API", available: Boolean(process.env.GEMINI_API_KEY), detail: process.env.GEMINI_API_KEY ? "API key configured · billed by Google" : "add a key under API keys" },
    { id: "openai", label: "OpenAI API", available: Boolean(process.env.OPENAI_API_KEY), detail: process.env.OPENAI_API_KEY ? "API key configured · billed by OpenAI" : "add a key under API keys" },
    { id: "deepseek", label: "DeepSeek API", available: Boolean(process.env.DEEPSEEK_API_KEY), detail: process.env.DEEPSEEK_API_KEY ? "API key configured · billed by DeepSeek" : "add a key under API keys" },
    { id: "none", label: "Evidence only", available: true, detail: "no AI, raw evidence report" },
  ];
}

const API_KEY: Record<ApiEngineId, string> = { "anthropic-api": "ANTHROPIC_API_KEY", gemini: "GEMINI_API_KEY", openai: "OPENAI_API_KEY", deepseek: "DEEPSEEK_API_KEY" };
const apiLabel: Record<ApiEngineId, string> = { "anthropic-api": "Anthropic", gemini: "Gemini", openai: "OpenAI", deepseek: "DeepSeek" };

/** Keep only models that can write text reports, using each provider's model-list response. */
export function textModelIds(engine: ApiEngineId, payload: unknown): string[] {
  const rows = (payload as any)?.models ?? (payload as any)?.data;
  if (!Array.isArray(rows)) return [];
  const ids = rows.flatMap((row: any) => {
    if (engine === "gemini") {
      if (!row.supportedGenerationMethods?.includes("generateContent")) return [];
      const id = String(row.baseModelId ?? row.name ?? "").replace(/^models\//, "");
      return id ? [id] : [];
    }
    const id = String(row.id ?? "");
    if (!id) return [];
    if (engine === "openai" && /^(whisper|tts-|dall-e|gpt-image|chatgpt-image|sora|text-embedding|omni-moderation|text-moderation|babbage-|davinci-|gpt-(audio|.*(audio|transcrib|realtime|tts|instruct)))/i.test(id)) return [];
    if (engine === "deepseek" && Array.isArray(row.output_modalities) && !row.output_modalities.includes("text")) return [];
    return [id];
  });
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

function keyFor(engine: ApiEngineId): string {
  const key = process.env[API_KEY[engine]] || (engine === "anthropic-api" ? process.env.ANTHROPIC_AUTH_TOKEN : undefined);
  if (!key) throw new Error("Add an API key under API keys to use " + apiLabel[engine] + ".");
  return key;
}

async function requestJson(engine: ApiEngineId, url: string, body?: unknown, signal?: AbortSignal): Promise<any> {
  const key = keyFor(engine);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (engine === "gemini") headers["x-goog-api-key"] = key;
  else headers.authorization = "Bearer " + key;
  const timeout = AbortSignal.timeout(body === undefined ? 30_000 : 180_000);
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(apiLabel[engine] + " API returned HTTP " + response.status);
  return response.json();
}

export async function listTextModels(engine: ApiEngineId): Promise<string[]> {
  if (engine === "anthropic-api") {
    const models: string[] = [];
    keyFor(engine);
    const client = process.env.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, authToken: null })
      : new Anthropic();
    for await (const model of client.models.list({ lifecycle: ["active"] })) models.push(model.id);
    return [...new Set(models)];
  }
  if (engine === "deepseek") return textModelIds(engine, await requestJson(engine, "https://api.deepseek.com/models"));
  if (engine === "openai") {
    const result = await requestJson(engine, "https://api.openai.com/v1/models");
    const current = (result.data ?? []).filter((row: any) => !row.shutdown_date || Date.parse(row.shutdown_date) > Date.now());
    return textModelIds(engine, { data: current });
  }
  const models: any[] = [];
  const seen = new Set<string>();
  let pageToken = "";
  do {
    const query = pageToken ? "?pageToken=" + encodeURIComponent(pageToken) : "";
    const result = await requestJson(engine, "https://generativelanguage.googleapis.com/v1beta/models" + query);
    if (Array.isArray(result.models)) models.push(...result.models);
    pageToken = typeof result.nextPageToken === "string" ? result.nextPageToken : "";
    if (pageToken && seen.has(pageToken)) break;
    if (pageToken) seen.add(pageToken);
  } while (pageToken);
  return textModelIds(engine, { models });
}

async function writeWithApi(engine: ApiEngineId, bundle: EvidenceBundle, opts: WriteOptions): Promise<{ markdown: string; model?: string }> {
  const model = opts.model;
  if (!model) throw new Error("Choose a text model before starting the report.");
  opts.onStatus?.(apiLabel[engine] + " is writing with " + model + "…");
  const system = systemPrompt(loadHarness());
  const input = userPrompt(bundle);
  let result: any;
  if (engine === "gemini") {
    result = await requestJson(engine, "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: input }] }],
      generationConfig: { maxOutputTokens: 8_192 },
    }, opts.signal);
  } else if (engine === "openai") {
    result = await requestJson(engine, "https://api.openai.com/v1/responses", { model, instructions: system, input, max_output_tokens: 8_192 }, opts.signal);
  } else {
    result = await requestJson(engine, "https://api.deepseek.com/chat/completions", {
      model, max_tokens: 8_192,
      messages: [{ role: "system", content: system }, { role: "user", content: input }],
    }, opts.signal);
  }
  const markdown = engine === "gemini"
    ? (result.candidates ?? []).flatMap((c: any) => c.content?.parts ?? []).map((p: any) => p.text ?? "").join("").trim()
    : engine === "openai"
      ? String(result.output_text ?? (result.output ?? []).flatMap((o: any) => o.content ?? []).filter((c: any) => c.type === "output_text").map((c: any) => c.text ?? "").join("")).trim()
      : String(result.choices?.[0]?.message?.content ?? "").trim();
  if (!markdown) throw new Error(apiLabel[engine] + " returned no report text.");
  opts.onText?.(markdown);
  return { markdown, model };
}

function version(bin: string): Promise<string | null> {
  return new Promise(resolve => {
    const p = spawn(bin, ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    p.stdout.on("data", d => (out += d));
    p.on("error", () => resolve(null));
    p.on("close", code => resolve(code === 0 ? out.trim().split("\n")[0]!.slice(0, 60) : null));
    setTimeout(() => (p.kill(), resolve(null)), 8000);
  });
}

export interface WriteOptions {
  model?: string;
  onText?: (delta: string) => void;
  onStatus?: (msg: string) => void;
  signal?: AbortSignal;
}

export async function writeReport(engine: EngineId, bundle: EvidenceBundle, opts: WriteOptions = {}): Promise<{ markdown: string; model?: string }> {
  // The model name becomes a CLI argument: never let it look like a flag.
  if (opts.model && !/^[A-Za-z0-9][A-Za-z0-9._:/\[\]-]{0,80}$/.test(opts.model)) throw new Error("Invalid model name");
  if (engine === "claude-code") return claudeCode(bundle, opts);
  if (engine === "codex") return codex(bundle, opts);
  if (engine === "gemini" || engine === "openai" || engine === "deepseek") return writeWithApi(engine, bundle, opts);
  if (engine === "anthropic-api") {
    const res = await synthesize(bundle, { model: opts.model, onText: opts.onText });
    return { markdown: res.markdown, model: res.model };
  }
  throw new Error(`Engine ${engine} does not write reports`);
}

/** A scratch cwd so the CLIs don't pick up a project's CLAUDE.md / AGENTS.md. */
function scratchDir(): string {
  const dir = join(tmpdir(), "marketers-eye-engine");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function envWithout(...keys: string[]): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of keys) delete env[k];
  return env;
}

function claudeCode(bundle: EvidenceBundle, opts: WriteOptions): Promise<{ markdown: string; model?: string }> {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--tools", "",
    "--no-session-persistence",
    "--strict-mcp-config",
    "--setting-sources", "project",
    "--system-prompt", systemPrompt(loadHarness()),
  ];
  if (opts.model) args.push("--model", opts.model);
  return new Promise((resolve, reject) => {
    const p = spawn("claude", args, { cwd: scratchDir(), env: envWithout("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"), signal: opts.signal });
    let text = "";
    let model: string | undefined;
    let final: string | undefined;
    let error: string | undefined;
    let stderr = "";
    p.stderr.on("data", d => (stderr = (stderr + d).slice(-2000)));
    createInterface({ input: p.stdout }).on("line", line => {
      let m: any;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      if (m.type === "system" && m.subtype === "init") {
        model = m.model;
        opts.onStatus?.(`Claude Code (${m.model}${m.apiKeySource && m.apiKeySource !== "none" ? `, ${m.apiKeySource}` : ", subscription"}) is writing…`);
      } else if (m.type === "stream_event" && m.event?.type === "content_block_delta" && m.event.delta?.type === "text_delta") {
        text += m.event.delta.text;
        opts.onText?.(m.event.delta.text);
      } else if (m.type === "result") {
        if (m.is_error) error = String(m.result || m.subtype || "Claude Code failed");
        else final = m.result;
      }
    });
    p.on("error", err => reject(err));
    p.on("close", code => {
      const markdown = (final ?? text).trim();
      if (error) reject(new Error(error));
      else if (!markdown) reject(new Error(`Claude Code exited ${code} with no output${stderr ? `: ${stderr.trim().slice(-400)}` : ""}`));
      else resolve({ markdown, model });
    });
    p.stdin.end(userPrompt(bundle));
  });
}

function codex(bundle: EvidenceBundle, opts: WriteOptions): Promise<{ markdown: string; model?: string }> {
  const args = ["exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules", "-s", "read-only", "--json"];
  if (opts.model) args.push("-m", opts.model);
  args.push("-");
  const prompt = [
    "<instructions>",
    systemPrompt(loadHarness()),
    "</instructions>",
    "",
    userPrompt(bundle),
    "",
    "Do not run shell commands or read files: everything you need is above. Reply with only the Markdown report.",
  ].join("\n");
  return new Promise((resolve, reject) => {
    const p = spawn("codex", args, { cwd: scratchDir(), env: envWithout("OPENAI_API_KEY"), signal: opts.signal });
    let last = "";
    let failure: string | undefined;
    let stderr = "";
    p.stderr.on("data", d => (stderr = (stderr + d).slice(-2000)));
    opts.onStatus?.("Codex (subscription) is thinking…");
    createInterface({ input: p.stdout }).on("line", line => {
      let m: any;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      const item = m.item;
      if (m.type === "item.completed" && item?.type === "agent_message" && item.text) {
        last = item.text;
        opts.onText?.(item.text);
      } else if ((m.type === "item.started" || m.type === "item.completed") && item?.type === "reasoning") {
        opts.onStatus?.("Codex is reasoning…");
      } else if ((m.type === "item.started" || m.type === "item.completed") && item?.type === "command_execution") {
        opts.onStatus?.(`Codex ran: ${String(item.command ?? "").slice(0, 80)}`);
      } else if (m.type === "turn.failed" || m.type === "error") {
        failure = m.error?.message ?? m.message ?? "Codex failed";
      }
    });
    p.on("error", err => reject(err));
    p.on("close", code => {
      if (last.trim()) resolve({ markdown: last.trim() });
      else reject(new Error(failure ?? `Codex exited ${code} with no output${stderr ? `: ${stderr.trim().slice(-400)}` : ""}`));
    });
    p.stdin.end(prompt);
  });
}
