# Marketer's Eye

![Marketer's Eye](assets/marketers-eye.svg)

An evidence-backed marketing intelligence dashboard. Enter a company website or app link to explore channel signals, ads and social posts, public positioning, and source evidence.

## Quick start

Requires Node.js 22.13 or newer.

    git clone https://github.com/codemanojhv/marketers-eye.git
    cd marketers-eye
    npm install
    cp .env.example .env
    npm run dev -- web --no-open

Open http://localhost:4321. For a recorded example without provider keys:

    npm run dev -- demo --no-open

## Brand workspaces

Choose **Workspaces** in the dashboard to save a brand profile, attach existing scans, and keep an experiment record. Create a scan using **Quick scan** before attaching it to a workspace. Each attached scan includes a local copy of its evidence.

Workspace records are stored in `~/.local/share/marketers-eye/workspace.sqlite`. Set `MARKETERS_EYE_DATA_DIR` before starting the app to choose another directory. Back up the database file to keep these records.

The **Decision desk** brings together attached research, evidence-linked insights, campaign performance, reviewed feedback, experiments, and case-study export. Insights distinguish an observation from its interpretation and link to saved scan evidence. Public channel labels are research signals and do not establish competitor revenue or campaign performance.

### Campaign CSVs

In **Performance**, choose a CSV, name its source, select weekly or monthly reporting, and preview the column mapping before saving. Dates use `YYYY-MM-DD`; monthly dates start on the first day of the month. Supported columns are `date, channel, campaign, spend, impressions, clicks, visits, leads, purchases, revenue, currency`. Monetary values require a three-letter currency, supplied in the file or as the import default. Values are nonnegative and count fields are whole numbers.

The app stores the original file and can download or remove an import. Exact reimports do not add rows. Overlapping periods for the same source, channel, campaign, and currency are rejected. The performance view groups compatible records and calculates CTR from total clicks and impressions; missing values prevent an incomplete total from being presented as complete.

### Google Analytics and Search Console

The **Google** tab supports session-only, read-only authorization for GA4 and Search Console. Create a Google Cloud project, configure its OAuth consent screen and a Desktop OAuth client, and enable the Analytics Admin and Data APIs for GA4 or the Search Console API for Search Console. Add your Google account as a test user if your OAuth consent screen is in testing. Enter the client ID and, when supplied, the client secret in the app, authorize in the browser, then check the connection and select a property.

Access and refresh tokens stay in the local server's memory and are cleared when it restarts. A fetched report snapshot is stored in the workspace database. Disconnect attempts to revoke the Google token and offers the option to remove saved snapshots. Google may limit or omit Search Console data. GA4 and Search Console figures stay separate from uploaded campaign records.

### Feedback, exports and assistant access

In **Feedback**, edit excerpts to remove identifying details before saving, add a source and theme, and review counts for the saved sample. In **Export**, preview a case study and download Markdown or use the browser's print dialog to save a PDF.

The **AI assistant** tab lets you review a workspace profile and public evidence snapshot, then generate a 24-hour token for the local MCP server. Campaign data, feedback, Google reports, and provider keys are excluded from that snapshot. The assistant can call `get_workspace_summary` and `draft_workspace_change`; review and accept or discard its drafts in the dashboard. Active shares can be revoked there.

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

### Install it in an AI client

From the repository root, build the app once:

    npm install
    npm run build

The MCP server runs locally on your computer. It does not need a hosted URL. The client starts it with Node.js whenever it needs the tools.
It reads this checkout's `.env` when it starts; keep provider keys there instead of putting them in the client configuration.

To run it directly while developing:

    npm run dev -- mcp

#### Codex ([MCP docs](https://developers.openai.com/learn/docs-mcp))

Codex CLI and its supported editor integrations share the MCP configuration. In PowerShell, run this from the repository folder:

    $server = Join-Path (Get-Location) "dist/cli.js"
    codex mcp add marketers-eye -- node $server mcp
    codex mcp list

On macOS or Linux, use `codex mcp add marketers-eye -- node "$(pwd)/dist/cli.js" mcp`. Restart Codex after adding the server.

#### Antigravity ([MCP docs](https://antigravity.google/docs/ide-mcp))

Open **Settings → Customizations → MCP Servers → Manage MCP Servers → View raw config**. Add this entry to the `mcpServers` object in the global config (`~/.gemini/config/mcp_config.json`) or the workspace config (`.agents/mcp_config.json`):

    {
      "mcpServers": {
        "marketers-eye": {
          "command": "node",
          "args": ["C:/path/to/marketers-eye/dist/cli.js", "mcp"]
        }
      }
    }

Replace the example path with the absolute path to this checkout's `dist/cli.js`. Save the file, then refresh the MCP server list or restart Antigravity. In Antigravity CLI, `/mcp` opens the server manager.

#### Claude Code ([MCP docs](https://docs.anthropic.com/en/docs/mcp))

Register it for all projects:

    claude mcp add --scope user marketers-eye -- node "C:/path/to/marketers-eye/dist/cli.js" mcp

Use the absolute path to your `dist/cli.js`, then run `claude mcp list` or `/mcp` to confirm it is connected.

#### Gemini CLI ([MCP docs](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md))

Register a user-level server (replace the path with the absolute path to your checkout):

    gemini mcp add -s user marketers-eye node C:/path/to/marketers-eye/dist/cli.js mcp

Check it with `gemini mcp list`, then restart Gemini CLI.

#### Cursor ([MCP docs](https://docs.cursor.com/context/model-context-protocol)) and other MCP clients

In Cursor, open **Settings → Tools & MCP** and add a local stdio server, or place the same JSON entry under `mcpServers` in `.cursor/mcp.json` (project-level) or `~/.cursor/mcp.json` (user-level). The Antigravity JSON example above also works in clients that accept standard local stdio MCP entries; use that client's config file and an absolute path to `dist/cli.js`. These steps are for clients that can launch local stdio servers. ChatGPT web and other remote-only clients need an HTTP MCP endpoint or a secure bridge; this repository currently provides stdio only.

The project also includes a setup command that can register the built server with detected Claude Code and Codex clients. Preview the plan first, then run it to apply:

    node dist/cli.js setup --dry-run
    node dist/cli.js setup

Setup asks before changing client configuration. It does not configure Antigravity, Gemini CLI, Cursor, or other clients; use their manual steps above.

Once connected, restart or refresh the client and ask it to analyze a company, for example: `Analyze marketing at linear.app`.

The MCP tools include analyze_marketing, get_evidence, get_content, get_playbook, validate_report, write_report, and compare_runs. The connected MCP client's model can write a report from collected evidence; server-side report writing is optional.

To disconnect, use `codex mcp remove marketers-eye`, `claude mcp remove marketers-eye`, or `gemini mcp remove marketers-eye`; for manual JSON configurations, remove the `marketers-eye` entry.

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
