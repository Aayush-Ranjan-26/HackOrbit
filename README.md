# 🪐 HackOrbit ✨

> Aggregating 500+ live hackathons across the web into one unified, calendar-synced discovery engine! 🚀

HackOrbit pulls open hackathons across five major platforms — **Devpost, Unstop, Devfolio, MLH, and HackerEarth** — into a single high-speed feed, normalizes foreign prize pools and deadlines, tracks dates directly on your personal calendar, and matches opportunities to your exact tech stack.

Best of all? **Browsing requires zero sign-up.** Jump straight in to search and filter hundreds of competitions with shareable URLs. Authenticate securely only when you're ready to bookmark events, manage your application pipeline, or sync your calendar! 🛡️

[![Frontend](https://img.shields.io/badge/Frontend-Next.js%2016%20%7C%20React%2019-000000?style=flat&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![Backend](https://img.shields.io/badge/Backend-Express%205-000000?style=flat&logo=express&logoColor=white)](https://expressjs.com/)
[![Database](https://img.shields.io/badge/Database-Supabase%20Postgres%20%2B%20RLS-3ECF8E?style=flat&logo=supabase&logoColor=white)](https://supabase.com/)
[![Scraper](https://img.shields.io/badge/Scraper-5%20Live%20Sources-0284c7?style=flat&logo=target&logoColor=white)](backend/src/jobs/scraper.js)  
[![CI](https://img.shields.io/badge/CI-Passing-2ea44f?style=flat&logo=githubactions&logoColor=white)](https://github.com/Aayush-Ranjan-26/HackOrbit/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/Tests-73%2F73%20Passing-2ea44f?style=flat&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D20-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-f59e0b?style=flat)](LICENSE)

---

## 📋 Table of Contents

- 📌 [Features](#-features)
- 🧠 [How It Works](#-how-it-works)
- 🚀 [Getting Started](#-getting-started)
- 🎮 [Using HackOrbit](#-using-hackorbit)
- 📁 [Project Structure](#-project-structure)
- 🔌 [API Reference](#-api-reference)
- 🚢 [Deployment](#-deployment)
- ⚙️ [Configuration & Environment](#️-configuration--environment)
- 🛡️ [Security & Privacy](#️-security--privacy)
- 🔧 [Troubleshooting](#-troubleshooting)
- ⚠️ [Limitations & Gotchas](#️-limitations--gotchas)
- 🛠️ [Tech Stack](#️-tech-stack)

---

## ✨ Features

* 🌐 **5-in-1 Aggregation Engine** — Scrapes, sanitizes, and deduplicates open hackathons from Devpost, Unstop, Devfolio, Major League Hacking (MLH), and HackerEarth via an automated hourly cron or on-demand admin trigger.
* 💱 **Smart Prize & Date Normalization** — Converts multi-currency prize pools (USD, EUR) to normalized values (INR) with configurable FX rates and parses heterogeneous date formats into strict ISO deadlines.
* ⚡ **Trigram Search & Shareable Filters** — Sub-millisecond text search powered by PostgreSQL `pg_trgm` indexes with URL-synced filter states (`/explore?source=devpost&format=online`), making customized views shareable via link.
* 🎯 **Deterministic Skill Matching ("For You")** — High-precision recommendation engine using PostgreSQL GIN array intersections over your profile tags, giving clear justifications (*e.g., "Matches your interest in AI/ML, deadline in 3 days"*) without AI hallucinations.
* 📊 **Kanban Application Funnel** — Move opportunities across an active tracking pipeline: `Saved` ➔ `Applied` ➔ `Submitted`.
* 📅 **Interactive Deadline Calendar** — Synchronized monthly calendar and upcoming chronological stream generated directly from your saved events.
* 🔒 **Hardened Security & Isolation** — Supabase Auth (PKCE flow, Google OAuth), Cloudflare Turnstile bot protection, constant-time admin secrets, and strict tenant-isolated queries.

---

## 🧠 How It Works

Here is a quick bird's-eye view of how data and user interactions flow through HackOrbit:

```text
┌────────────────────────────────────────────────────────┐
│     5 Untrusted Upstream Hackathon Sources             │
│  [ Devpost · Unstop · Devfolio · MLH · HackerEarth ]   │
└──────────────────────────┬─────────────────────────────┘
                           │ axios + cheerio (one adapter each)
                           ▼
          ┌──────────────────────────────────┐
          │   backend/src/jobs/scraper.js    │ (Runs via node-cron or POST /admin/scrape)
          │  normalize · dedupe · sanitize   │
          └────────────────┬─────────────────┘
                           │ Upsert on (source, source_url)
                           ▼
               ┌────────────────────────┐
               │   Supabase Postgres    │ ◄─── auth.users (Cascading deletes)
               │   RLS on every table   │
               └───────────┬────────────┘
               ▲                        ▲
  service-role │ (Bypasses RLS;         │ anon key + user JWT (RLS enforced)
               │  user_id strictly      │
               │  scoped in JS)         │
               │                        │
     ┌─────────┴──────────┐   ┌─────────┴──────────┐
     │  Express 5 API     │   │  Next.js 16 Web    │
     │  (localhost:8080)  │   │  (localhost:3000)  │
     └─────────▲──────────┘   └─────────┬──────────┘
               │  Bearer <access_token> │
               └────────────────────────┘
```

1. **Ingest & Normalize:** The scraper polls all 5 platforms, parses HTML/JSON payloads, normalizes prize money to INR, and performs an idempotent upsert on `(source, source_url)`.
2. **Discover & Filter:** Public users query `/explore` without logging in. Queries hit the Express API, leveraging PostgreSQL trigram and GIN indexes for fast sub-millisecond filtering.
3. **Authenticate & Onboard:** Users sign in with Email or Google (PKCE flow). Supabase triggers create a linked row in `profiles`, where users declare skills, interests, and format preferences.
4. **Track & Pipeline:** Saving a hackathon creates a relational record in `saved_hackathons` and automatically maps the exact deadline into `calendar_events`.
5. **Match Opportunities:** The `/for-you` route queries Postgres for active hackathons overlapping the user's declared interest tags, ranked by nearest deadline.

> 🔒 **Privacy & Tenant Isolation Note:** The backend API operates using the Supabase `service-role` key (bypassing Postgres RLS). As a result, tenant isolation is strictly enforced at the application layer by mandating `.eq('user_id', req.user.id)` on every query — reads, writes, and deletes.

---

## 🚀 Getting Started

### Prerequisites

* **Node.js 20+** (ESM native support)
* A free **[Supabase](https://supabase.com)** project

---

### 1. Database Setup

In your Supabase dashboard, open the **SQL Editor** and run [`backend/supabase/schema.sql`](backend/supabase/schema.sql).

This provisions all 5 tables (`hackathons`, `profiles`, `saved_hackathons`, `calendar_events`, `scrape_logs`), sets up performance indexes (`GIN`, `pg_trgm`), enables RLS, and installs the `handle_new_user()` sign-up trigger.

---

### 2. Backend Setup

```bash
cd backend
npm install
cp .env.example .env     # fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
```

Configure `backend/.env` with your Supabase credentials:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
PORT=8080
ALLOWED_ORIGINS=http://localhost:3000
```

Start the API server:
```bash
npm run dev              # Starts Express on http://localhost:8080
```

---

### 3. Frontend Setup

```bash
cd ../frontend
npm install
cp .env.local.example .env.local   # fill in the NEXT_PUBLIC_SUPABASE_* keys
```

Configure `frontend/.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_API_BASE=http://localhost:8080
```

Start the Next.js development app:
```bash
npm run dev              # Starts Next.js on http://localhost:3000
```

---

### 4. Load Initial Hackathons

The database starts empty. Run the scraper once to populate live events:

```bash
cd ../backend
npm run scrape
```

> 💡 **Docker Compose Alternative:** You can run both services together using Docker:
> ```bash
> cp backend/.env.example backend/.env
> cp frontend/.env.local.example frontend/.env.local
> docker compose up --build
> ```

---

## 🎮 Using HackOrbit

1. 🔍 **Explore the Catalog:**
   * Head to `/explore` to browse through 500+ active competitions.
   * **Filter by Source** — select Devpost, Unstop, Devfolio, MLH, or HackerEarth.
   * **Filter by Format** — choose **Online**, **In-Person**, or **Hybrid**.
   * **Filter by Domain** — narrow down to *AI/ML, Web3, FinTech, Open Source*, and more.
2. 🎯 **Personalized "For You" Feed:**
   * Complete quick onboarding (`/onboarding`) to declare your primary tech stacks and interests.
   * Jump to `/for-you` to see a curated, prioritized list of events with explainable match reasons.
3. 📊 **Track in Your Application Pipeline:**
   * Save any event to your dashboard (`/saved`) and advance it through active stages:
     * 🟡 **Saved** — Bookmarked for team review.
     * 🔵 **Applied** — Registration and team RSVP submitted.
     * 🟢 **Submitted** — Final project and repo submitted to judges.
4. 📅 **Sync Your Deadline Calendar:**
   * Open `/calendar` to view a synchronized monthly grid and chronological stream of upcoming deadlines.

> 💡 **First-time tip:** Filters in `/explore` live directly in the URL (e.g. `/explore?source=devpost&format=online`). You can bookmark or share filtered queries directly with your hackathon team.  
> ⚠️ **Zero-Account Browsing:** Browsing the catalog and inspecting hackathons requires no account. Sign in only when you want to save events, track your pipeline, or sync deadlines to your calendar.

---

## 📁 Project Structure

```text
HackOrbit/
├── backend/                  ⚡ Express 5 API (Node 20+ ESM) + Supabase service-role client
│   ├── src/
│   │   ├── index.js          🔌 API bootstrap, CORS, rate limiting, security headers & hourly cron
│   │   ├── jobs/
│   │   │   └── scraper.js    🕷️ 5 scraper adapters (Devpost, MLH, Unstop, Devfolio, HackerEarth)
│   │   ├── lib/
│   │   │   ├── hackathons.js 🔍 Query builder, domain taxonomy sanitization & deadline helpers
│   │   │   ├── profile.js    👤 Profile lazy-creation & input schema validators
│   │   │   └── supabase.js   🗄️ Service-role Supabase admin client (bypasses RLS)
│   │   ├── middleware/
│   │   │   ├── auth.js       🛡️ Supabase JWT verification (requireAuth & optionalAuth)
│   │   │   └── errorHandler  🛑 Sanitized error handler masking internal Postgres errors
│   │   └── routes/
│   │       ├── admin.js      🔐 Protected on-demand scrape triggers & telemetry stats
│   │       ├── hackathons.js 🌐 Public catalog, domains count taxonomy & hackathon detail
│   │       └── user.js       📊 Pipeline status, calendar events, recommendations & account deletion
│   ├── supabase/schema.sql   📜 Idempotent DDL: 5 tables, RLS policies, GIN/trigram indexes & triggers
│   └── test/                 🧪 73 native node:test suites (zero external test runner dependencies)
│
├── frontend/                 ⚛️ Next.js 16 (App Router) + React 19 + TypeScript web app
│   ├── src/
│   │   ├── app/              📄 App Router routes with scoped CSS Modules
│   │   │   ├── (auth)/       🔑 Login, Google OAuth, password reset & PKCE callback
│   │   │   ├── explore/      🔍 Searchable, filterable catalog with URL state syncing
│   │   │   ├── calendar/     📅 Interactive monthly deadline grid & upcoming list
│   │   │   ├── saved/        📊 Kanban tracking pipeline (saved ➔ applied ➔ submitted)
│   │   │   ├── for-you/      🎯 Deterministic profile-matched recommendations
│   │   │   ├── onboarding/   🧩 User skill & domain interest questionnaire
│   │   │   └── api/admin/    🛡️ Server-side proxy protecting the admin secret key
│   │   ├── components/       🧩 Reusable UI: HackathonCard, Nav, Toast, Turnstile CAPTCHA
│   │   └── lib/              🛠️ Typed API client, session hooks & currency/date formatters
│
├── docker-compose.yml        🐳 Multi-container production orchestration with healthchecks
└── .github/workflows/ci.yml  🤖 GitHub Actions CI pipeline (lint, test, build verification)
```

---

## 🔌 API Reference

### Public Endpoints
| Method | Route | Description |
|---|---|---|
| `GET` | `/health` | Healthcheck and database connectivity status |
| `GET` | `/hackathons` | Paginated catalog with search, domain, format, prize, and date filtering |
| `GET` | `/hackathons/domains` | Top 40 domains with active count tally (cached 10 min) |
| `GET` | `/hackathons/:id` | Full hackathon details by ID |

### Authenticated Endpoints (`Authorization: Bearer <supabase_jwt>`)
| Method | Route | Description |
|---|---|---|
| `GET` / `PUT` | `/user/profile` | Fetch or update user skill profile and preferences |
| `GET` | `/user/saved` | Retrieve saved hackathons with active funnel status |
| `POST` / `DELETE`| `/user/saved/:id` | Bookmark or remove a saved hackathon |
| `PATCH` | `/user/saved/:id/status` | Update tracking stage (`saved` \| `applied` \| `submitted`) |
| `GET` | `/user/calendar` | Fetch deadlines tracked on the user calendar |
| `POST` / `DELETE`| `/user/calendar/:id` | Add or remove a deadline from the calendar |
| `GET` | `/user/recommendations` | Fetch interest-matched hackathons |
| `DELETE` | `/user/account` | Permanently purge user profile and all associated data |

### Admin Endpoints (`x-admin-key: <ADMIN_SECRET_KEY>`)
| Method | Route | Description |
|---|---|---|
| `POST` | `/admin/scrape` | Trigger an on-demand scraper run (includes lock guard) |
| `GET` | `/admin/scrape-status` | Real-time status and telemetry of scraper runs |
| `GET` | `/admin/stats` | Breakdown of live hackathons and scraper logs by source |

---

## 🚢 Deployment

### Backend (Render / Railway / Fly.io)
Deploy as a Node.js service:
* Set all environment variables defined in `backend/.env`.
* Set `ENABLE_CRON=true` on **exactly one** instance to avoid duplicate scraper executions.
* If deploying behind a reverse proxy (e.g. Render, Fly, Vercel), set `TRUST_PROXY=true`.

### Frontend (Vercel)
Deploy as a Next.js application:
* Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
* Set `NEXT_PUBLIC_API_BASE` pointing to your deployed backend URL.
* Add your deployed frontend domain to the backend's `ALLOWED_ORIGINS` CORS list and to Supabase **Auth ➔ URL Configuration**.

---

## ⚙️ Configuration & Environment

### `backend/.env`
| Variable | Required | Default | Description |
| :--- | :---: | :---: | :--- |
| `SUPABASE_URL` | **Yes** | — | Supabase project REST URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | — | Privileged service key bypassing RLS |
| `PORT` | No | `8080` | Express API listener port |
| `ALLOWED_ORIGINS` | No | `http://localhost:3000` | Comma-delimited CORS allowlist |
| `ADMIN_SECRET_KEY` | No | — | Secret token guarding `/admin/*`. If unset, admin returns 503 |
| `TRUST_PROXY` | No | `false` | Enable only behind reverse proxies to prevent rate-limit bypass |
| `ENABLE_CRON` | No | `false` | When `true`, schedules hourly scrapes inside the process |
| `INR_PER_USD` | No | `88` | Exchange rate used to normalize USD prize pools to INR |

### `frontend/.env.local`
| Variable | Required | Default | Description |
| :--- | :---: | :---: | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes** | — | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Yes** | — | Public Supabase anon key |
| `NEXT_PUBLIC_API_BASE` | No | `http://localhost:8080` | Base URL of the backend API |
| `ADMIN_SECRET_KEY` | No | — | Server-only secret for `/api/admin` proxy |
| `ADMIN_USER_IDS` | No | — | Comma-separated Supabase user IDs authorized for admin access |

---

## 🛡️ Security & Privacy

* **Strict Tenant Isolation:** Backend routes enforce `.eq('user_id', req.user.id)` across all user queries, preventing unauthorized cross-user data access despite service-role access.
* **Sensitive Operations Safeguard:** Critical actions (such as account deletion) require a re-authentication within the past 10 minutes, verified against the JWT's `amr` (Authentication Methods Reference) claim.
* **Constant-Time Secret Verification:** The admin API validates secret keys using `crypto.timingSafeEqual` to eliminate timing attack vectors.
* **Zero Leak Error Handling:** Express central error middleware intercepts and masks raw PostgreSQL or Supabase error messages, presenting clean, client-safe error payloads.

---

## 🔧 Troubleshooting

* **Empty Dashboard on Startup:** The database begins empty. Run `npm run scrape` in `backend/` to populate hackathons.
* **Admin Page Returns 503 / 404:** Ensure `ADMIN_SECRET_KEY` is set in both `backend/.env` and `frontend/.env.local`, and that your Supabase user ID is included in `ADMIN_USER_IDS`.
* **429 Rate Limit Errors in Production:** If running behind Render, Fly, or Vercel, ensure `TRUST_PROXY=true` in `backend/.env`. Otherwise, all users share a single IP rate-limit bucket.
* **Docker Client Build Arguments:** Next.js inlines `NEXT_PUBLIC_*` variables at compile time. When building Docker images, pass these variables as build arguments in `docker-compose.yml`.

---

## ⚠️ Limitations & Gotchas

* **Upstream HTML Layout Changes:** Third-party websites (especially HTML-scraped sources like MLH or Devpost) may change their markup. Check `/admin` or `scrape_logs` if source counts drop.
* **Single Cron Runner:** Never run `ENABLE_CRON=true` on multiple horizontal backend instances, or multiple scrapers will run concurrently.
* **Local In-Memory Scrape Lock:** The scraper utilizes an in-memory lock (`isScrapeRunning`) inside the backend process to prevent race conditions during manual triggers.

---

## 🛠️ Tech Stack

| Domain | Technologies |
|---|---|
| **Frontend** | [Next.js 16](https://nextjs.org/) (App Router), [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), CSS Modules |
| **Backend** | [Express 5](https://expressjs.com/), [Node.js 20+](https://nodejs.org/) (Native ESM), [Axios](https://axios-http.com/), [Cheerio](https://cheerio.js.org/), [node-cron](https://github.com/node-cron/node-cron) |
| **Database & Auth** | [Supabase](https://supabase.com/) (PostgreSQL 15+, Row-Level Security, GIN & `pg_trgm` indexes, PKCE Auth, Google OAuth) |
| **Testing & CI** | Built-in `node:test` (73 tests, 0 test dependencies), ESLint, GitHub Actions CI, Docker & Docker Compose |

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
