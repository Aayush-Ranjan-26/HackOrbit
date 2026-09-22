# HackOrbit — architecture and decisions

Written for whoever touches this next. [`README.md`](README.md) covers setup;
this covers *why*.

---

## 1. The shape

```
Devpost ─┐
Unstop  ─┤
Devfolio┤── scraper (node-cron / admin trigger) ──▶ Supabase Postgres
MLH     ─┤                                              │
HackEarth┘                                              │
                                                        ▼
                       Next.js 16 frontend ◀──── Express 5 API
                       (React 19, App Router)    (service-role key)
```

Two independent apps. The frontend never talks to Postgres directly — it holds
only the Supabase **anon** key, for auth. All data goes through the API, which
holds the **service-role** key.

### Request path

1. Browser signs in with Supabase → gets a JWT.
2. Frontend sends `Authorization: Bearer <jwt>` to the Express API.
3. `requireAuth` verifies it with `supabaseAdmin.auth.getUser(token)` and sets
   `req.user`.
4. Routes query Postgres with the service-role client, always filtering on
   `req.user.id`.

**The critical consequence:** the service-role key bypasses RLS. The policies in
`schema.sql` are a second line of defence, *not* the enforcement path. Every
user-scoped query must carry `.eq('user_id', req.user.id)` — on **writes** as
well as reads. Miss it once and you have a cross-tenant hole. This is the single
most important rule in the codebase.

---

## 2. Layout

```
backend/
  src/
    index.js            app wiring, CORS, rate limits, security headers, cron
    lib/
      supabase.js       service-role client
      hackathons.js     openHackathons() + withDaysUntilDeadline()
      profile.js        getProfile() — creates the row if the trigger missed it
    middleware/
      auth.js           requireAuth
      errorHandler.js   AppError + central handler
    routes/
      hackathons.js     public browsing: list + detail
      user.js           profile, saved, calendar, recommendations
      admin.js          scrape trigger, logs, stats
    jobs/scraper.js     the five source adapters
  test/                 node:test suites — npm test
  eslint.config.mjs

frontend/src/
  app/                  routes; each page owns a .module.css
    api/admin/[...path] server-side admin proxy
  components/           Nav, Toast, HackathonCard, Providers
  lib/
    api.ts              typed client, ApiError
    hooks.ts            session, lists, the shared library store
    format.ts           stripHTML, source colours, date/prize formatting
    supabase.ts         browser client (null when unconfigured)
```

---

## 3. Data model

`hackathons` is the only shared table; everything else hangs off `auth.users`.

- **`hackathons`** — `UNIQUE (source, source_url)` is the scraper's conflict key,
  so a re-scrape updates rather than duplicates. `is_active` is the soft-delete
  used for expired listings.
- **`profiles`** — 1:1 with `auth.users`, created by the `on_auth_user_created`
  trigger. `getProfile()` also creates it lazily, because users made before the
  trigger existed (or via the admin API) otherwise hit a permanent 404.
- **`saved_hackathons`** — carries the `saved → applied → submitted` status.
- **`calendar_events`** — which hackathons you track. Deadlines are *derived* at
  read time from the hackathon row, not copied, so a changed deadline is
  reflected everywhere at once.
- **`scrape_logs`** — one row per scraper run, per source (§5).

Indexes worth knowing: GIN on `domains` for overlap filtering, and **trigram**
indexes on `title`/`description`. The search filter is a double-sided
`ILIKE '%term%'`, which a btree index cannot serve — the `pg_trgm` extension was
already enabled but unused, so those indexes are what make search scale.

**`GET /hackathons/domains`** exists because the Explore page's domain dropdown
used to be a hardcoded list of categories that barely intersected what the
scrapers actually produce — picking almost any option returned zero results.
The route counts `domains` across open hackathons in Node, drops anything that
occurs only once (one-offs just make the dropdown unusable), and returns the
top 40 by frequency. Cached in-process for 10 minutes since it is a full-table
scan; not worth a materialised view at the current row count.

---

## 4. Authentication and login

### The shape

```
  Browser                     Supabase Auth              Express API            Postgres
     │                              │                         │                     │
     │ 1. email + password ────────▶│                         │                     │
     │◀─── 2. JWT (ES256) + refresh │                         │                     │
     │                              │                         │                     │
     │ 3. Authorization: Bearer <jwt> ──────────────────────▶ │                     │
     │                              │◀─ 4. getUser(token) ────│                     │
     │                              │── 5. user or error ────▶│                     │
     │                              │                         │ 6. query filtered   │
     │                              │                         │    by req.user.id ─▶│
     │◀──────────────────── 7. only that user's rows ─────────│                     │
```

Supabase is the identity provider. It owns `auth.users`, password hashing,
email confirmation and token issuance — none of that is reimplemented here.
The API never sees a password.

### Who holds which key

| Key | Lives in | Can do |
|---|---|---|
| **anon** | the browser (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) | Sign in/up, and read whatever RLS permits. Public by design — it ships in the JS bundle |
| **service role** | the API only (`SUPABASE_SERVICE_ROLE_KEY`) | Everything, **bypassing RLS**. Never sent to a browser |
| **user JWT** | the browser, per session | Identifies one user to the API |

### The consequence that matters

Because the API uses the service-role key, **RLS is not the enforcement path
for anything the API does**. The policies in `schema.sql` only protect the case
where a browser talks to Supabase directly. Every user-scoped query in
`routes/user.js` must therefore carry `.eq('user_id', req.user.id)` — on
**writes and deletes as well as reads**. One omission is a full cross-tenant
breach with no second line of defence. This is the single most important
invariant in the codebase; an end-to-end test exercised it with two real
accounts and found it held on every path.

### Request path in code

1. `frontend/src/lib/supabase.ts` — `createBrowserClient` from `@supabase/ssr`
   holds the session and refreshes it.
2. `frontend/src/lib/api.ts` — `apiFetch` calls `getAccessToken()` and attaches
   `Authorization: Bearer <jwt>` to every API call.
3. `backend/src/middleware/auth.js` — `requireAuth` extracts the bearer token
   and resolves it with `supabaseAdmin.auth.getUser(token)`. That call verifies
   the signature against the project's keys server-side rather than trusting a
   local decode. No user ⇒ `401 UNAUTHENTICATED`.
4. Routes read `req.user.id` and never trust a user id from the request body.

`router.use(requireAuth)` is applied once at the top of `routes/user.js`, so a
new route is protected by default rather than by remembering to guard it.

### Login surface

`/login` handles sign-in and sign-up against Supabase directly — the API is not
involved. On sign-up with email confirmation enabled, Supabase returns no
session until the user clicks the emailed link; the page says so instead of
appearing to hang. A new account lands on `/onboarding`, a returning one on
`?next=` or `/explore`.

OAuth providers are rendered only when the project actually has them enabled:
the page reads `GET /auth/v1/settings` and shows the Google button only if
`external.google` is true. Offering a provider that is switched off produced a
button whose only outcome was "Unsupported provider".

### Profile creation

`handle_new_user()` (a `SECURITY DEFINER` trigger on `auth.users`) inserts a
`profiles` row on signup. `getProfile()` in `backend/src/lib/profile.js` also
creates one lazily, because accounts made before the trigger existed — or
through the admin API — would otherwise 404 forever on every personalised route.

### Deliberately not built

No password reset flow, no email change, no MFA, no roles beyond
"authenticated" and the separate admin shared-secret. Supabase supports all of
these; none is wired up. Admin is guarded by `ADMIN_SECRET_KEY`, compared in
constant time and never exposed to the browser — the frontend reaches it only
through the server-side `/api/admin` proxy.

---

## 5. The scraper

Five adapters, run concurrently under `Promise.allSettled` so one failure cannot
take the others down. Each writes a `scrape_logs` row.

Every adapter was re-verified against live responses; several had drifted:

| Source | How | Notes |
|---|---|---|
| Devpost | public JSON API | `prize_amount` is an **HTML string**, not a number. `submission_period_dates` carries the year only on the end date, so the start borrows it (and steps back a year if that would put the start after the end) |
| Unstop | public JSON API | `prizes_amount` no longer exists — cash lives in `prizes[].cash` and must be summed. Uses `regnRequirements.end_regn_dt`, not `end_date`: the latter is when the *event* ends, and using it overstated time-to-register by days or weeks. `categories`/`skills` are also gone; the only domain signal left is `required_skills[].skill_name`, capped at 8 |
| Devfolio | `__NEXT_DATA__` | Same trap: the deadline is `settings.reg_ends_at`, not `ends_at` |
| MLH | Cheerio over the season pages | Season *N* is the academic year **ending** in N, so its Sep–Dec events fall in calendar year N−1. Seasons are derived from today, not hardcoded — the scraper looks at the current season plus one ahead. That next season's page **404s until MLH publishes it**, months in advance; the per-season fetch is wrapped so that failure is skipped rather than failing the whole source. UTM params are stripped so the conflict key is stable |
| HackerEarth | `chrome-extension/events` JSON | The challenges page is now client-rendered with no `__NEXT_DATA__`, so HTML scraping returned nothing. This feed is what their browser extension uses |

Rules the adapters follow:

- **Never invent a date.** A record whose deadline cannot be parsed is skipped.
  The old code fabricated `now + 30 days`, which showed long-closed hackathons
  as open.
- **Normalise prizes to INR** so sources rank against each other. `INR_PER_USD`
  is env-tunable because FX drifts.
- `parsePrizeAmount` understands `K` / `Lakh` / `Cr` / `million`. Stripping
  non-digits read "₹1.5 Lakh" as `1` and "10K" as `10`.
- **Stable `source_url`.** It is half the conflict key; an unstable one produces
  duplicate rows instead of updates.
- **`fetchWithRetry` does not retry 4xx**, except 429. A 404/403/etc. means the
  page is wrong, not busy — MLH's not-yet-published season page is exactly this
  case, and retrying it three times with backoff just delays the source giving
  up. 429 is the one 4xx that means "wait", so it still retries.
- The **expiry sweep runs unconditionally** at the end of the job. Expiry is a
  property of the deadline, not of whether a scrape succeeded — running it only
  on success left expired hackathons live after any DB hiccup.

The cron is **off by default** (`ENABLE_CRON`). It lived in the web process, so
every replica would have scraped in parallel.

---

## 6. What was removed, and what replaced it

The project used to carry ~1,500 lines of hand-written algorithms in
`backend/src/utils/daa/` — Trie, binary search, merge/quick sort, binary heap,
graph BFS/DFS, LCS dynamic programming, greedy activity selection, weighted KNN
— plus eight routes whose only purpose was to demonstrate them. None were called
by the UI, and each pulled the entire `hackathons` table into Node on every
request. They are gone.

| Removed | Replaced by |
|---|---|
| `mergeSort` for calendar ordering | `Array.prototype.sort` — stable since ES2019 / V8 7.0, which is the guarantee the merge sort existed to provide |
| `topN` heap → `/hackathons/top` | `ORDER BY … LIMIT n` in Postgres |
| `sortData` → `/hackathons/sorted` | `.order()` on the query |
| `Trie` → `/hackathons/search/prefix` | `ILIKE` against the trigram indexes (§3) |
| `knnRecommend` → `/hackathons/recommend/knn` | SQL profile match, now `GET /user/recommendations` (§7) |
| LCS → a planned match-score endpoint (never shipped) | Folded into the same `GET /user/recommendations` query |
| `activitySelection` → `/user/schedule/optimal` | Dropped — no UI ever used it |
| `sortData` → `/user/saved/ranked` | The client sorts its own list of a few dozen rows |

Net effect: the database does the work it is indexed for, unauthenticated
full-table scans are gone, and the API surface is only endpoints the product
actually uses.


## 7. Recommendations

`GET /user/recommendations` (`backend/src/routes/user.js`) is a single Postgres
query, no language model in the loop. There used to be a chat-based
recommender with its own route namespace; it is deleted — the chat had no
access to the `hackathons` table, so it could only recommend from what it
already knew, and the recommendations it did surface were already coming from
this same SQL match, run as its fallback. Deleting the chat left the working
half in place.

- Pulls the caller's `interests` and `format_pref` from their profile, then
  runs `openHackathons()` filtered with `.overlaps('domains', interests)` —
  the GIN index on `domains` (§3) is what makes this cheap.
- `format_pref: 'online'` also matches `hybrid` hackathons, and likewise
  `'offline'` matches `hybrid`, since a hybrid event satisfies both.
- Ordered by `registration_deadline` ascending — soonest deadline first.
- If nothing overlaps the user's interests, it re-runs the same query without
  the interest filter, so the response is never empty just because a profile's
  interests don't appear in this week's scraped domains.
- Each row gets a generated `reason` string, e.g. "Matches your interest in
  Python, closing in 1 day." — built from the matched domain(s) and
  `daysUntil(registration_deadline)`, not written by a model.
- Response shape: `{ recommendations: [{ rank, hackathon, reason }],
  matched_on_interests }`, where `matched_on_interests` just reflects whether
  the profile has any interests set — not whether the fallback query ran, so a
  `true` here can still pair with the fallback's generic reason if none of
  this week's scraped domains happen to overlap.

No separate rate limit applies — it runs under the same global 120 req/min
limit as everything else, since it costs nothing beyond an indexed query.

---

## 8. Frontend decisions

**One shared store.** `useLibraryState` in `hooks.ts` holds saved + calendar
once, in a provider mounted in the root layout. Previously each page called
`useSaved()`/`useCalendar()` independently, so `/explore` fired three requests on
mount and every navigation refetched the same rows.

**Loading is derived, never set in an effect.** Each fetch hook stores the *key*
of the data it holds and reports `loading = heldKey !== wantedKey`. React 19's
compiler-aware lint rejects synchronous `setState` in an effect body — it causes
cascading renders. Same trick hides another user's rows after sign-out without
clearing state from an effect.

**URL is the source of truth on `/explore`.** Filters, sort and page live in
query params, so refresh, back and link-sharing all work. Typing updates the
input immediately but the URL only after a 350 ms pause — it used to fire one
request per keystroke.

**Errors are distinguishable.** `ApiError` carries `status`; status `0` means the
network failed. "Backend down" and "no results" are different screens now.
Previously every failure — outage, 500, validation — said "Login required".

**Accessibility isn't optional here.** Calendar days are real `<button>`s (they
were click-handling `<div>`s, unreachable by keyboard); the toast is a
persistent `aria-live` region; every input has a label; muted text was lifted to
clear WCAG AA on this background; `:focus-visible` rings are global.

---

## 9. Security

Three parallel audits (auth/session, web layer, Supabase config) ran against
the live deployment. What they found, and what holds now:

| Concern | How it is handled |
|---|---|
| Auth | `getUser()` validates against Supabase rather than decoding locally, so a token from another project is rejected and sign-out takes effect immediately. Every user query filters on `req.user.id` — writes and deletes too |
| Admin access | Two gates. The Next proxy requires a session whose user id is in `ADMIN_USER_IDS` and answers **404**, so the surface does not announce itself; the backend separately requires `x-admin-key`. Holding the secret server-side was not enough on its own — without the identity check the proxy *was* the credential |
| Open redirect | `?next=` accepts same-site absolute paths only. Next hard-navigates to a foreign origin, so an unchecked value was a phishing launchpad on a trusted domain |
| Error leakage | `dbError()` logs the driver message and returns a fixed string. Wrapping raw PostgREST text in an `AppError` made every malformed filter a schema-enumeration oracle |
| Filter injection | `search` is stripped of PostgREST grammar metacharacters; `.overlaps()` values are sanitised separately because postgrest-js escapes `.in()` but not `.overlaps()` |
| Rate limiting | 120/min, keyed on the real IP. `trust proxy` is opt-in via `TRUST_PROXY` — trusting `X-Forwarded-For` unconditionally let a caller mint a fresh bucket per forged header |
| Session storage | A cookie, `Secure` in production. `httpOnly` is impossible (the browser client must read the token) and it holds a 400-day refresh token, so the CSP below is the real mitigation for XSS |
| Browser headers | CSP, `nosniff`, `X-Frame-Options`, `Referrer-Policy`, HSTS — set in `next.config.ts`. The frontend serves the HTML and previously sent none |
| Untrusted URLs | Scraped `source_url` must be `http(s)`. Devpost and HackerEarth pass their `url` through verbatim, and a `javascript:` URI would execute in our origin from the Register link |
| Dependencies | Both apps at 0 advisories. `next` was on a release with an unauthenticated RCE affecting Windows hosts |
| Scrape stampede | Single-flight guard; concurrent scrapes are a self-inflicted DoS and a fast route to an IP ban |
| Unbounded scans | `GET /hackathons`'s `limit` is clamped to 50 server-side |

**Not covered by code, and deliberately left to the operator:** password policy
(Supabase enforces 6 characters, no complexity or breach check) and open
signup. Both are dashboard settings.

---

## 10. Testing

`cd backend && npm test` — 26 tests across 6 suites, no framework: prize
shorthand parsing (K/Lakh/Cr/million/HTML span form), the MLH season/year
offset, `stripHTML`, and a handful of route-level checks (health, a 404 that
doesn't echo the request path, the auth gate on `/user/profile` and
`/user/recommendations`, a malformed hackathon id, the admin key
fail-closed/wrong/correct sequence, and the security headers). Each one
corresponds to a bug that was actually present.

`cd frontend && npm run build` type-checks; `npm run lint` must stay clean.

---

## 11. Known gaps

- **No automated frontend tests.** Type-check, lint and build are the gates;
  the backend has a `node:test` suite.
- **`submission_deadline` is not a real signal.** Devfolio and Unstop set it
  equal to the event end; Devpost sets it equal to its own registration
  deadline (both are read from the same field, so they can never diverge); MLH
  and HackerEarth don't set it at all, so it comes back `null`. No source
  exposes a submission deadline genuinely distinct from registration close or
  the event end.
- **Prize coverage is uneven.** MLH, Devfolio and HackerEarth never provide a
  prize figure — those rows sort as 0 under "biggest prize". Checked against a
  real load of 325 active hackathons: 135 (~41%) had `prize_value_inr > 0`,
  almost all of it from Unstop (117/186) and Devpost (18/34); the other three
  sources contributed zero.
- **Devfolio banners** are absent from their current payload — every active
  Devfolio row has a null `banner_url`, so those cards render without artwork.
  HackerEarth and MLH do carry banners.
- **HackerEarth and Devfolio are the fragile adapters** — both read undocumented
  endpoints that can change without notice. `scrape_logs` is where you will see
  it first; a source silently returning 0 records is the signal.
