# HackOrbit

[![CI](https://github.com/Aayush-Ranjan-26/HackOrbit/actions/workflows/ci.yml/badge.svg)](https://github.com/Aayush-Ranjan-26/HackOrbit/actions/workflows/ci.yml)

Hackathon discovery for students and developers. HackOrbit pulls open hackathons
from **Devpost, Unstop, Devfolio, MLH and HackerEarth** into one feed, tracks
every deadline on a personal calendar, and matches you to the ones that fit
your interests and format preference.


```
backend/    Express 5 API + Supabase + scheduled scraper
frontend/   Next.js 16 (App Router) + React 19
```

- Browsing needs no account.
- Saving, the calendar and your matched hackathons need a Supabase sign-in.

---

## Quick start

Prerequisites: Node 20+ and a free [Supabase](https://supabase.com) project.

### 1. Database

In the Supabase dashboard open **SQL Editor** and run
[`backend/supabase/schema.sql`](backend/supabase/schema.sql). It creates every
table, index, RLS policy and the trigger that makes a profile row on signup.

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env     # fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm run dev              # http://localhost:8080
```

### 3. Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local   # fill in the two NEXT_PUBLIC_SUPABASE_* values
npm run dev                        # http://localhost:3000
```

### 4. Load some hackathons

The database starts empty. Run the scraper once:

```bash
cd backend && npm run scrape
```

### Or with Docker

```bash
cp backend/.env.example backend/.env            # then fill both in
cp frontend/.env.local.example frontend/.env.local
docker compose up --build
```

Next inlines `NEXT_PUBLIC_*` at build time, so those values are passed as build
args in `docker-compose.yml` rather than at runtime.

---

## Environment

### `backend/.env`

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | yes | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-side key. Bypasses RLS — never expose it |
| `PORT` | no | Default `8080` |
| `ALLOWED_ORIGINS` | no | Comma-separated CORS allowlist |
| `ADMIN_SECRET_KEY` | no | Unset ⇒ `/admin/*` returns 503. No default by design |
| `TRUST_PROXY` | no | `true` only when a reverse proxy really is in front. Otherwise a caller can forge `X-Forwarded-For` to reset their own rate limit |
| `ENABLE_CRON` | no | `true` runs the 6-hourly scrape in this process |
| `INR_PER_USD` | no | FX used to normalise Devpost prizes (default 88) |

### `frontend/.env.local`

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | for auth | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | for auth | Public anon key |
| `NEXT_PUBLIC_API_BASE` | no | Backend URL, default `http://localhost:8080` |
| `ADMIN_SECRET_KEY` | no | Must match the backend. **Not** `NEXT_PUBLIC_` — read only by the server-side `/api/admin` proxy |
| `ADMIN_USER_IDS` | no | Comma-separated Supabase user ids allowed to reach `/admin`. Unset ⇒ admin is unreachable. Find yours under Authentication → Users |

---

## Commands

| Where | Command | Does |
|---|---|---|
| backend | `npm run dev` | API with reload |
| backend | `npm start` | API |
| backend | `npm run scrape` | One scrape of all five sources |
| backend | `npm test` | `node:test` suite |
| backend | `npm run lint` | ESLint |
| frontend | `npm run dev` | Dev server |
| frontend | `npm run build` | Production build (type-checks) |
| frontend | `npm run lint` | ESLint |

CI runs all four checks on every push and pull request
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

---

## Pages

| Route | What it is |
|---|---|
| `/` | Landing page |
| `/explore` | The feed: filter by source, format, domain; sort; paginate. Filters live in the URL, so a filtered view is shareable |
| `/hackathon/[id]` | Full detail, register link, save / calendar |
| `/calendar` | Month grid plus an upcoming list, built from your saved hackathons |
| `/saved` | Pipeline: saved → applied → submitted |
| `/for-you` | Hackathons matched to your interests, with a reason for each |
| `/onboarding` | Profile capture — what the recommendations run on |
| `/login` | Email/password and Google sign-in |
| `/admin` | Scraper runs and per-source counts (needs `ADMIN_SECRET_KEY`) |

---

## API

Public:

```
GET  /health
GET  /hackathons        search, domain, hackathon_type, prize_min, source,
                        deadline_from, deadline_to, sort, page, limit
GET  /hackathons/domains  top 40 domains present in open hackathons, with
                        counts, most common first — cached in-process 10 min
GET  /hackathons/:id
```

Authenticated — `Authorization: Bearer <supabase jwt>`:

```
GET  PUT    /user/profile
GET         /user/saved
POST DELETE /user/saved/:id
PATCH       /user/saved/:id/status     saved | applied | submitted
GET         /user/calendar
POST DELETE /user/calendar/:id
GET         /user/recommendations      domains overlapping your interests, soonest
                                        deadline first, honouring format_pref
```

Admin — `x-admin-key`:

```
POST /admin/scrape
GET  /admin/scrape-status
GET  /admin/stats
```

---

## Deploying

- **Backend** — any Node host (Render, Railway, Fly). Set the env vars above.
  Enable `ENABLE_CRON=true` on **exactly one** instance, or leave it off and
  call `POST /admin/scrape` from an external scheduler.
- **Frontend** — Vercel, or the provided Dockerfile (`output: 'standalone'`).
  Set `NEXT_PUBLIC_API_BASE` to the deployed backend and add its origin to
  `ALLOWED_ORIGINS`.
- Add the production domain to Supabase **Auth → URL configuration**.

---

## Documentation

- [`context.md`](context.md) — architecture, data flow, the scraper's quirks,
  the security model, and the decisions worth knowing before changing anything.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to work on it.
- [`CHECKLIST.md`](CHECKLIST.md) — what has been done and what is left.

## License

[MIT](LICENSE)
