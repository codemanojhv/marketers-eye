---
name: marketers-eye
description: Analyze a company's marketing from its website or app link using public evidence, channel signals, content, ads, positioning history and evidence-cited reports. Use for competitor research, customer acquisition analysis, ad research, or marketing strategy.
metadata:
  version: "1"
---

# Marketer's Eye

Use Marketer's Eye to collect public marketing evidence and build a grounded analysis.

## Connect

If the analyze_marketing MCP tool is available, use it. Otherwise, connect the MCP server from the repository:

    npm run build
    node dist/cli.js setup

Or run the CLI directly:

    npm run dev -- <url> --json

The doctor command shows which sources are configured. Without SCRAPECREATORS_API_KEY, ad-library and social metrics may be unavailable and will be reported as unknown. Website, SEO, history, app-store and community sources work independently where available.

## Workflow

1. Call analyze_marketing with the company's URL. The tool collects evidence and returns a deterministic channel scorecard, evidence index and unknowns.
2. Read the scorecard and evidence index. Explain the evidence; do not contradict the deterministic scorecard.
3. Call get_playbook for the analysis guide, then get_evidence and get_content for details you plan to cite.
4. Write an evidence-cited report. Cite every factual claim with [E#] and label inferences as likely.
5. Call validate_report and fix anything that fails before answering.
6. Use compare_runs to compare saved snapshots over time.

## Rules

- Unknown does not mean inactive. Only a checked-and-empty source is a negative.
- A pixel means intent or past use; only an ad library can confirm current ads.
- Do not state ad spend unless a source explicitly reports it.
- Treat low-confidence founder and social-account matches as unverified.
- Do not reproduce exact copy, footage or brand assets. Analyze the strategy and propose original work.
