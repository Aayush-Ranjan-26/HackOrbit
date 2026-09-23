# HackOrbit — Handoff

Everything a new owner needs: what the project is, how it is built, what was
done to it, what broke along the way, and what is still on you.

Companion docs: [`README.md`](README.md) (how to run it),
[`context.md`](context.md) (design decisions per file),
[`CHECKLIST.md`](CHECKLIST.md) (the task-by-task record).

---

## 1. Summary

HackOrbit is a hackathon discovery platform. A scheduled scraper pulls live
events from five sources — **Unstop, MLH, Devpost, Devfolio, HackerEarth** —
normalises them into one Postgres table, and a Next.js app lets a user browse,
filter, save, track and calendar them against their own profile.

The original pitch included an AI recommender. **It was removed deliberately**
(section 5.9). Matching is now a SQL query against the user's stated interests,
skills and experience level, which is what the AI path was falling back to
anyway.

**Status: complete and running.** 17 commits on
`https://github.com/Aayush-Ranjan-26/HackOrbit` (`master`), CI green, 328 live
hackathons in the database, 0 dependency advisories, 26/26 backend tests
passing, both apps lint and build clean.

---

## 2. Final output

| | |
|---|---|
| Repository | `Aayush-Ranjan-26/HackOrbit`, branch `master`, HEAD `13667b0` |
| Tracked files | 78 |
| Backend | 1,306 lines of source, 226 of tests (Express 5, ESM, Node 20+) |
| Frontend | 4,407 lines (Next.js 16.3.5, React 19, TypeScript, CSS Modules) |
| Database | Supabase Postgres — 5 tables, RLS on all of them |
| Live data | **328 open hackathons** (Unstop 186, MLH 79, Devpost 34, Devfolio 20, HackerEarth 6) |
| API | 17 routes across 3 routers |
| Tests | 26, on the built-in `node:test` runner — no test framework dependency |
| CI | GitHub Actions: backend lint + test, frontend lint + build |
| Containers | Multi-stage Dockerfiles (non-root, healthcheck) + `docker-compose.yml` — **written, never built** (section 6) |
| Local | `http://localhost:3000` (frontend), `http://localhost:8080` (API) |

### Pages

`/` landing · `/explore` search + filters · `/hackathon/[id]` detail ·
`/for-you` profile-matched picks · `/saved` with `saved → applied → submitted`
status · `/calendar` deadline month view · `/onboarding` profile capture ·
`/login` sign in / sign up · `/auth/callback` · `/auth/reset` · `/account` ·
`/admin` (gated).

---

## 3. Architecture

```
  Unstop   MLH   Devpost   Devfolio   HackerEarth        (5 public JSON/HTML sources)
     └───────┴───────┴────────┴───────────┘
                     │  axios + cheerio, one adapter each
            backend/src/jobs/scraper.js          ← node-cron, opt-in via ENABLE_CRON
                     │  normalise → dedupe → upsert on (source, source_url)
                     ▼
            ┌──────────────────────┐
            │  Supabase Postgres   │  hackathons · profiles · saved_hackathons
            │  RLS on every table  │  calendar_events · scrape_logs
            └──────────────────────┘
                 ▲            ▲
   service-role  │            │  anon key + user JWT (RLS enforced)
                 │            │
     Express 5 API           Next.js browser client
   (localhost:8080)          (Supabase Auth: session, OAuth, recovery)
                 ▲
                 │  Authorization: Bearer <access_token>
            Next.js App Router (localhost:3000)
```

### The one invariant that matters

**The API holds the Supabase service-role key, which bypasses RLS completely.**
Row-level security protects the browser client; it does **not** protect the API.
Tenant isolation inside the API therefore rests entirely on a hand-written
`.eq('user_id', req.user.id)` on **every** query — reads, writes *and* deletes.

Miss one filter and users read or overwrite each other's rows with no database
safety net. All 12 user-scoped queries were verified empirically with two real
accounts. Any new user-scoped query must carry that filter and be tested the
same way.

### Auth flow

1. `@supabase/supabase-js` in the browser owns the session (email + password,
   Google OAuth when enabled, password recovery).
2. Emailed and OAuth links land on **`/auth/callback`**, which exchanges the
   one-time `?code=` for a session (PKCE). Links that carry tokens in the URL
   *fragment* (implicit flow) can't be read server-side, so the route forwards
   them and the browser client picks them up — the fragment survives the
   redirect.
3. Recovery links are routed to `/auth/reset`, never into the app, so the user
   can't be silently signed in without changing the password.
4. The frontend attaches the access token as a bearer header on every API call.
5. `backend/src/middleware/auth.js` validates it with
   `supabaseAdmin.auth.getUser(token)` — a real server-side check, not a local
   JWT decode. `requireAuth` rejects; `optionalAuth` lets public routes
   personalise.

### Data model

| Table | Purpose |
|---|---|
| `hackathons` | Normalised events. GIN index on `domains`, pg_trgm trigram indexes backing the ILIKE search |
| `profiles` | One row per auth user, created by the `handle_new_user()` SECURITY DEFINER trigger; `getProfile()` creates it lazily if the trigger ever misses |
| `saved_hackathons` | Save + `saved / applied / submitted` status |
| `calendar_events` | Deadlines a user pinned |
| `scrape_logs` | Per-run counts and errors |

All user tables `ON DELETE CASCADE` from `auth.users`, so
`DELETE /user/account` genuinely removes everything.

### API surface

- **Public** — `GET /hackathons` (search, domain, mode, source, sort, paging),
  `GET /hackathons/domains`, `GET /hackathons/:id`, `GET /health`
- **Authenticated** (`requireAuth` on the whole router) — `GET/PUT
  /user/profile`, `GET /user/saved`, `POST|DELETE /user/saved/:id`, `PATCH
  /user/saved/:id/status`, `GET /user/recommendations`, `GET /user/calendar`,
  `POST|DELETE /user/calendar/:id`, `DELETE /user/account`
- **Admin** — `POST /admin/scrape`, `GET /admin/scrape-status`, `GET
  /admin/stats`, behind a constant-time secret compare; the browser reaches
  them only through `/api/admin/[...path]`, which keeps the secret server-side
  and checks the caller against `ADMIN_USER_IDS`

---

## 4. What was done

Twelve phases, recorded task-by-task in [`CHECKLIST.md`](CHECKLIST.md). In
order:

0. **Review** — full read of both apps, then five parallel reviewers (security,
   backend correctness, frontend/UX, scraper/data, deletion).
1. **Security & auth** — replaced an auth stub that hardcoded *one shared user
   id for everybody* with real JWT verification; killed a PostgREST `.or()`
   filter injection; admin fails closed; rate limiting; CORS; body limits;
   stopped the error handler echoing Postgres internals.
2. **Backend correctness** — surfaced swallowed insert/upsert errors,
   `.single()` → `.maybeSingle()` where zero rows is normal, UUID validation,
   profile input caps, deleted a `notifications` table nothing wrote to.
3. **Scraper** — every one of the five adapters re-probed live and rewritten
   (section 5.4).
4. **Frontend foundation** — one `format.ts`, one `<Nav>`, one `<Toast>`, one
   `<HackathonCard>`, one shared saved/calendar store (three requests on
   `/explore` became one).
5. **The missing half** — `/onboarding`, `/for-you`, the status lifecycle in
   the UI, a reachable `/login`.
6. **UX & a11y** — debounced search, filters in the URL, distinct
   empty/error/offline states, real `<button>` calendar days, `aria-live`,
   global `:focus-visible`, muted text raised to WCAG AA, `prefers-reduced-motion`.
7. **Removed the DAA layer** — deleted ~1,500 lines of hand-rolled algorithm
   modules and the 8 routes that existed only to demonstrate them; calendar
   ordering became `Array.prototype.sort`, the KNN/LCS recommenders became one
   SQL profile match.
8. **Professional engineering** — git history, ESLint both apps, `node:test`
   suite, GitHub Actions CI, Dockerfiles, MIT licence, `CONTRIBUTING.md`,
   README and `context.md` rewritten to match the code.
9. **Verification** — tests, lint, build, boot, all 9 routes 200, no residue.
10. **Real data** — schema applied to a real Supabase project, full five-source
    scrape, authenticated flows exercised with real accounts.
11. **Removed the AI recommender** (section 5.9).
12. **Security audit** — three parallel agents; findings in section 5.
13. **Authentication completed** — `/auth/callback`, `/auth/reset`, `/account`
    (change password, resend confirmation, sign out everywhere, delete
    account), then a four-agent end-to-end auth test campaign which found three
    more real bugs, all fixed (5.10–5.12).
14. **Published** — repository cleared and rebuilt as 17 reviewable commits.

Roughly 20 subagents ran across the project. Several found bugs in *my own
fixes*; every claim was re-verified independently before acting on it — one
agent report ("three dead tables still exist") turned out to be wrong, caused
by `head: true` swallowing the error.

---

## 5. Problems that arose

### 5.1 `42P01: relation "public.saved_hackathons" does not exist`

Running `schema.sql` failed. My bug: `idx_saved_user` and `idx_calendar_user`
sat in the hackathons index block, *above* the tables they index. Moved them
below `calendar_events`. Also added `DROP POLICY IF EXISTS` before every
`CREATE POLICY` so a re-run doesn't fail with `42710`.

### 5.2 Credentials typed into the wrong file

Real keys were entered into `backend/.env.example` and
`frontend/.env.local.example` — both **git-tracked templates** — instead of
`.env` / `.env.local`. Happened twice. Verified no real credential ever reached
a commit, moved the values into the untracked files, restored the templates.

### 5.3 `SUPABASE_URL` was the dashboard URL

`https://supabase.com/dashboard/project/...` instead of the project API URL.
Recovered the correct host from the `ref` claim inside the service key itself.

### 5.4 Five scraper adapters had drifted

Every source had changed shape since the code was written:

- **HackerEarth** — both code paths were dead; rewritten against their
  `chrome-extension/events` JSON feed.
- **MLH** — season 2028 doesn't exist yet, and its 404 was killing the whole
  adapter (0 results). Made per-season failure non-fatal → 79 events recovered.
  Also fixed a year-offset bug: MLH "season N" covers the academic year *ending*
  in N, so Sep–Dec events belong to N−1.
- **Unstop** — `categories` and `skills` were gone, replaced by
  `required_skills[].skill_name`, so all 186 records had empty `domains`. After
  fixing that, domains filled with soft skills ("Problem Solving" on 20 of 50),
  so a `GENERIC_SKILL` filter was added. *Then* a careless `sed` corrupted that
  regex (`creativ|ideation` → `creativideation`) — fixed, with a test pinning it.
- **Devfolio** — was reading `ends_at` (event end) instead of
  `settings.reg_ends_at` (registration deadline).
- **Devpost** — HTML prize strings, start dates that borrow the year from a
  sibling field, and a real venue signal.

Plus: no fabricated deadlines, stable `source_url` for dedupe, and
`parsePrizeAmount` handling K / Lakh / Cr / million.

### 5.5 `/api/admin` required no credentials at all

My bug. I moved the admin secret server-side so it would leave the browser
bundle — and never checked the *caller*. A plain `curl` returned the scrape
logs and could trigger a five-site scrape. Now gated on `ADMIN_USER_IDS` and
answers **404** to everyone else.

### 5.6 Unauthenticated RCE in Next.js

`next` 16.2.3 carried **GHSA-p293-qw3h-jr36**, unauthenticated RCE on Windows
hosts — and this project develops on Windows. Upgraded to 16.3.5. `axios` →
1.20.0 (it parses untrusted upstream JSON) and `node-cron` → 4. Both apps now
report 0 advisories.

### 5.7 Open redirect — and my first fix made it worse

`?next=` was honoured without validation, and Next *hard-navigates*, so
`?next=https://evil.example` turned a trusted origin into a phishing launchpad.

The pattern-matching fix `/^\/(?!\/)/` looked right and fell to three payloads:
`/\evil.example` (WHATWG treats `\` as `/` in http URLs), and `/<TAB>//evil` and
`/<LF>//evil` (the parser strips those bytes). Worse, an intermediate fix of
mine *widened* it by honouring `next` even with no `code` present.

Resolved by not pattern-matching at all — `frontend/src/lib/url.ts`
`sameSitePath()` resolves the value with the same URL parser the redirect will
use and compares origins. Verified:

```
/\evil.example        BLOCKED      //evil.example        BLOCKED
/<TAB>//evil.example  BLOCKED      /\/evil.example       BLOCKED
/<LF>//evil.example   BLOCKED      https://evil.example  BLOCKED
/explore              → localhost:3000/explore
```

### 5.8 Account enumeration oracles

Password reset reported rate-limit errors distinctly — and since Supabase only
*attempts* a send for addresses that exist, only real addresses could hit the
quota. My own rate-limit branch defeated my own anti-enumeration comment sitting
directly above it. Collapsed to a single message; the real reason is logged
server-side.

### 5.9 The AI recommender wasn't doing anything

Removed `/ai/chat`, `/ai/recommend`, `@anthropic-ai/sdk`, `ANTHROPIC_API_KEY`
and two database tables. **Why:** the chat had no access to the `hackathons`
table, so it could only recommend events it already knew about from training —
not the 328 live ones. The recommendations users actually saw were coming from
the SQL profile match it fell back to. The model was adding nothing the query
wasn't already doing.

(A related bug found on the way out: a placeholder `sk-ant-api...` key passed a
truthiness check, so every AI call 500'd and the fallback was unreachable.)

### 5.10 `/calendar` shipped a frozen date

The page called `new Date()` during a statically prerendered render, so the
built `calendar.html` hard-coded "September 2026" with day 22 marked as today —
visible in the build output. Fixed with `useSyncExternalStore` so the date is
computed only after mount. React 19's `react-hooks/set-state-in-effect` rule
rejected two earlier attempts at this; loading state is now *derived*, never set
inside an effect.

### 5.11 Session cookie missing `Secure`

The callback route set the session cookie without it. That cookie carries a
~400-day refresh token, which would then travel over any plaintext request to
the same host in production. Added `cookieOptions`.

### 5.12 Raw Postgres errors reaching clients

`?domain=a"` returned `malformed array literal` verbatim. Added `dbError()`,
which logs the real code server-side and returns a generic message. Also
sanitised `.overlaps()` values — postgrest-js escapes `.in()` but *not*
`.overlaps()`.

### 5.13 `trust proxy` was a rate-limit bypass

Enabled unconditionally, so forging `X-Forwarded-For` minted a fresh rate-limit
bucket per request. Now opt-in via `TRUST_PROXY`.

### 5.14 Google sign-in "not working"

The provider was simply disabled in the Supabase project — the code was never
the problem. The button now only appears once `/auth/v1/settings` reports Google
as enabled, so it can't be clicked into a dead end.

### 5.15 Publishing to GitHub

The remote held 80 commits of unrelated history (a file-by-file upload) that
still contained the AI feature *and* the vulnerable Next release. Cleared and
replaced with this history. A near-miss on the way: a sync tool had moved HEAD
to a side branch, leaving `master` stale — pushing it would have published the
vulnerable version. Branches were reunified before the push.

---

## 6. What still needs doing

Ordered by what unblocks the most.

### Needs you (nothing in code can do these)

1. **Supabase → Authentication → URL Configuration.** Set Site URL to
   `http://localhost:3000` and add `http://localhost:3000/auth/callback` as a
   redirect URL. Without it, emailed confirmation and password-reset links do
   not come back to the app.
2. **`ADMIN_USER_IDS` in `frontend/.env.local`.** Sign up, copy your user id
   from Authentication → Users, paste it in. Until then `/admin` answers 404 to
   everyone, including you.
3. **Google OAuth** — create a client, redirect URI
   `https://qrxpdaufwqgoemqfgynh.supabase.co/auth/v1/callback`, enable the
   provider in Supabase. The button reappears on its own.
4. **Password policy** (Auth → Passwords): minimum is 6 with no complexity rule
   and no leaked-password check. Open signups are on (Auth → Settings). Neither
   is reachable from code.
5. **Custom SMTP.** Supabase's built-in mailer caps at roughly 2 emails/hour and
   was exhausted during testing. Any real use needs your own SMTP.

### Verification gaps

6. **Click through the app in a browser.** Every check so far was at the HTTP
   and data layer — no browser has driven this app. Click handlers, hydration
   settling and CSS layout are unverified by eye.
7. **`docker build` has never run** (no Docker daemon on this machine). The
   Dockerfiles and compose file are written but unproven.

### Deployment

8. **Deploy** — frontend to Vercel, backend to Render (or equivalent). Set
   `ENABLE_CRON=true` on the backend, or the data goes stale; it is off by
   default so local runs don't scrape five sites on a timer. Remember to add the
   production URLs to the Supabase redirect allow-list too.

### Known ceilings (deliberate, not bugs)

- Recommendations are a SQL profile match, not learned ranking. Good enough at
  328 rows; revisit if the catalogue or the signal grows.
- The scraper is five hand-written adapters against undocumented endpoints.
  **They will drift again** — that is the single most likely future failure, and
  `scrape_logs` is where it will show up first.
- No email notifications for approaching deadlines; the calendar is pull-only.

---

## 7. Running it

```bash
# backend — needs backend/.env (SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_SECRET_KEY)
cd backend && npm install && npm run dev        # :8080

# frontend — needs frontend/.env.local (NEXT_PUBLIC_SUPABASE_URL, ..._ANON_KEY)
cd frontend && npm install && npm run dev       # :3000

# checks
cd backend && npm test && npm run lint
cd frontend && npm run lint && npm run build
```

First-time database setup and a manual scrape trigger are in
[`README.md`](README.md).
