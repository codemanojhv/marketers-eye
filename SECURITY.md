# Security

Marketer's Eye runs on your machine and reads public data.

## Keys and local data

- Provider and Scrape Creators keys can be read from environment variables, a local .env file, or the app's local configuration. Configuration is stored in ~/.config/marketers-eye/config.json with file mode 600.
- Keys are never written to reports, evidence bundles, logs, the response cache, or API responses. The status endpoint reports only whether a key is configured.
- The Scrape Creators key is sent only to api.scrapecreators.com. Provider keys are sent only to the selected provider's API.
- Subscription CLI engines remove API-key variables from their child process environment. Codex runs with a read-only sandbox and an ephemeral session; Claude Code runs without MCP servers or user hooks.
- The response cache at ~/.cache/marketers-eye contains collected public data, never keys.

## Local web app

- Listens on 127.0.0.1 only. Requests with an unexpected Host or cross-origin write are rejected.
- Uses a strict Content-Security-Policy. Reports are rendered through DOMPurify, with active content removed and links restricted to http(s).
- Model names are validated before becoming CLI arguments.

## Fetching

- Server-side fetches only go to public http(s) hosts. Loopback, private, link-local and .local addresses are blocked, and redirects are checked at every hop.
- Hostnames that resolve to private IPs are not checked; there is no DNS pinning. Same-site key pages are used, sitemaps are size-limited, and requests time out.

## Reporting a vulnerability

Please open a private security advisory on GitHub rather than a public issue.
