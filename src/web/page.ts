import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// src/web/page.ts and dist/web/page.js both sit two levels below the package root.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PAGE = readFileSync(join(ROOT, "web-dist", "index.html"), "utf8");
export const WEB_ASSET_DIR = join(ROOT, "web-dist", "assets");
