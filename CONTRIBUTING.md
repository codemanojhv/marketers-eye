# Contributing

Contributions are welcome, especially:

- New sources in src/sources/ that follow the evidence contract in AGENTS.md.
- New tracking signatures in src/sources/tracking.ts, with a test.
- Lessons and playbooks in harness/, backed by evaluation.
- Evaluation fixtures: run marketers-eye <url> --no-ai, then copy evidence.json to evals/fixtures/<domain>.evidence.json.

Run npm run typecheck, npm test and npm run eval before opening a PR.
