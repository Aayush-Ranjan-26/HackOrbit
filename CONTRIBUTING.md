# Contributing

## Prerequisites

Node 20+, a Supabase project, and the local setup in [README.md](README.md#quick-start)
(env files, database schema, running both apps).

## Project layout

```
backend/    Express 5 API + Supabase + scheduled scraper
frontend/   Next.js 16 (App Router) + React 19
```

Each app has its own `package.json`, lints and tests independently.

## Tests and lint

```bash
cd backend && npm run lint && npm test
cd frontend && npm run lint && npm run build
```

The frontend has no separate test script; `npm run build` type-checks it.

## Commits and PRs

Open a PR against `master`. CI (`.github/workflows/ci.yml`) runs both jobs
above on every push and PR — it must be green before merge. Keep commits
focused and describe the *why*, not just the *what*.
