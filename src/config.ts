// Local user config (~/.config/marketers-eye/config.json), written by the web UI.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = process.env.MARKETERS_EYE_CONFIG_DIR || join(homedir(), ".config", "marketers-eye");
const FILE = join(DIR, "config.json");

export type ApiKeyProvider = "anthropic" | "gemini" | "openai" | "deepseek";

const API_KEY_ENV: Record<ApiKeyProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
};

let originalApiEnv: Partial<Record<ApiKeyProvider, string>> | undefined;

export interface UserConfig {
  scrapecreatorsKey?: string;
  apiKeys?: Partial<Record<ApiKeyProvider, string>>;
}

export function readConfig(): UserConfig {
  try {
    return existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as UserConfig) : {};
  } catch {
    return {};
  }
}

export function writeConfig(patch: UserConfig): UserConfig {
  const next = { ...readConfig(), ...patch };
  for (const [k, v] of Object.entries(next)) if (v === "" || v == null) delete (next as any)[k];
  if (next.apiKeys) {
    for (const provider of Object.keys(next.apiKeys) as ApiKeyProvider[]) if (!next.apiKeys[provider]?.trim()) delete next.apiKeys[provider];
    if (!Object.keys(next.apiKeys).length) delete next.apiKeys;
  }
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  chmodSync(FILE, 0o600);
  applyConfig(next, true);
  return next;
}

/** Env vars win over the config file unless `override` (set from the UI just now). */
export function applyConfig(cfg = readConfig(), override = false): void {
  originalApiEnv ??= Object.fromEntries(Object.entries(API_KEY_ENV).flatMap(([provider, env]) => process.env[env] ? [[provider, process.env[env]]] : [])) as Partial<Record<ApiKeyProvider, string>>;
  if (cfg.scrapecreatorsKey && (override || !process.env.SCRAPECREATORS_API_KEY)) process.env.SCRAPECREATORS_API_KEY = cfg.scrapecreatorsKey;
  if (override && !cfg.scrapecreatorsKey) delete process.env.SCRAPECREATORS_API_KEY;
  for (const [provider, env] of Object.entries(API_KEY_ENV) as [ApiKeyProvider, string][]) {
    const key = cfg.apiKeys?.[provider];
    if (key && (override || !process.env[env])) process.env[env] = key;
    else if (override && !key) {
      if (originalApiEnv[provider]) process.env[env] = originalApiEnv[provider]!;
      else delete process.env[env];
    }
  }
}
