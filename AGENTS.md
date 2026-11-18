# Repository guidelines

Marketer's Eye collects public evidence about how a company acquires customers. The CLI, web dashboard and MCP server share one collection pipeline in src/index.ts.

## Evidence contract

- Collectors in src/sources add observations or derivations to EvidenceStore; they do not write conclusions.
- Anything not checked, blocked, or unavailable becomes an Unknown with a reason and, where possible, a manual-check URL.
- A negative needs a negative observation. Unknown is never the same as none.
- Keep evidence compact: clip long text, cap arrays, and preserve the fields an analyst would quote.

## Layout

- src/sources/ contains collectors; pure parsing lives in html.ts, seo.ts, tracking.ts and is unit-tested.
- src/analyze/scorecard.ts builds the deterministic channel scorecard.
- src/analyze/synthesize.ts writes an optional Anthropic API report from the evidence bundle and analysis guide.
- src/report/ contains deterministic Markdown, comparison output and the report validator.
- harness/ contains the versioned analysis guide and playbooks. harness/manifest.json lists files and version.
- src/engines.ts contains report writers for Claude Code, Codex, Anthropic API, Gemini, OpenAI and DeepSeek.
- src/web/server.ts and web/index.html implement the local dashboard. src/runs.ts stores runs shared by the web app and MCP server.
- src/mcp.ts defines the stdio MCP server and its tools and prompts.

## Changing the analysis guide

1. Edit a playbook, lesson or guardrail. Bump harness/manifest.json version for behavior changes.
2. Use the existing evaluation fixtures to review report changes.
3. Add a cue and lesson when a review shows a recurring miss.

## Paid APIs

Scrape Creators calls go through the budgeted, cached client. Verify response shapes against a live response before relying on a field, and read fields defensively.

## Checks

Run typecheck, tests and evals before opening a PR. Do not commit marketers-eye-reports/, keys, or dist/.
