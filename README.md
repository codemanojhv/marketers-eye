# Marketer's Eye

![Marketer's Eye](assets/marketers-eye.svg)

An evidence-backed marketing intelligence dashboard. Enter a company website or app link to explore channel signals, ads and social posts, public positioning, and source evidence.

## Quick start

Requires Node.js 22 or newer.

    git clone https://github.com/codemanojhv/marketers-eye.git
    cd marketers-eye
    npm install
    cp .env.example .env
    npm run dev -- web --no-open

Open http://localhost:4321. For a recorded example without provider keys:

    npm run dev -- demo --no-open

## Model providers

Add one or more keys to the local, ignored .env file, then restart the app:

    GEMINI_API_KEY=
    OPENAI_API_KEY=
    DEEPSEEK_API_KEY=

The app discovers compatible text-generation models for configured keys and shows them in dropdowns. Provider requests run through the Node server; keys are not sent to the browser. Reports include evidence-reference validation.

The CLI and MCP server can also use ANTHROPIC_API_KEY for their optional server-side report writer. Collecting public evidence and viewing the bundled example do not require a model key.

## Scrape Creators

Paste a Scrape Creators API key in the app when you want ad-library and social collectors. The app stores it in local configuration on this computer. It is not included in reports or GitHub.

## MCP server

The MCP server uses stdio and exposes marketing analysis, evidence and content lookup, analysis playbooks, report validation, report writing, comparisons, and guided workflows.

Run it directly from this checkout:

    npm run dev -- mcp

To register the built server with detected Claude Code or Codex clients, run:

    npm run build
    node dist/cli.js setup

Setup shows the changes and asks before applying them. Preview the plan with node dist/cli.js setup --dry-run.

The MCP tools include analyze_marketing, get_evidence, get_content, get_playbook, validate_report, write_report, and compare_runs. The connected MCP client's model can write a report from collected evidence; server-side report writing is optional.

## Reading the dashboard

- Evidence counts observed facts and computed derivations.
- Channel signal strength is a heuristic from 0–3, not traffic, spend, or conversion performance.
- Unknown means a channel could not be verified from available sources. It does not imply the company is inactive.
- Every evidence record includes its source and, when available, a link to inspect it.

The app gathers public information only. Source availability and coverage vary by company, region, and provider.

## Development

    npm run typecheck
    npm test
    npm run build

The web server binds to localhost and is intended for local use. GitHub hosts the source repository; GitHub Pages cannot run this Node API app as a hosted dashboard.

## License

MIT. See LICENSE.
