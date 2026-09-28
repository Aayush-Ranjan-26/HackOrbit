# HackOrbit — Implementation Checklist

`[x]` done · `[-]` deliberately not done (reason given)

## Phase 0 — Review
- [x] Full read of both apps, end to end
- [x] 5 parallel reviewers: security, backend correctness, frontend/UX, scraper/data, deletion
- [x] Findings folded into the phases below

## Phase 1 — Security & auth
- [x] Real Supabase JWT verification (`requireAuth` + `optionalAuth`)
- [x] Deleted `supabaseUser()` — claimed RLS it did not enforce
- [x] Killed the PostgREST `.or()` filter injection
- [x] Admin fails closed: env-only key, no default, header-only, constant-time compare
- [x] Admin secret moved server-side behind `/api/admin`; verified absent from the client bundle
- [x] Chat-session IDOR: persist scoped by `user_id`, not session id alone
- [x] Prompt injection: client-supplied message roles clamped to `user`
- [x] Rate limiting — 120/min global, IPv6-safe key
- [x] CORS rejects cleanly; security headers; 100kb body limit
- [x] Error handler stops echoing Postgres internals; 404 no longer reflects the URL

## Phase 2 — Backend correctness
- [x] Swallowed upsert/insert errors surfaced or logged
- [x] `.single()` → `.maybeSingle()` where zero rows is normal
- [x] `getProfile()` creates the row lazily if the signup trigger missed it
- [x] Null-safe joins; malformed UUIDs → 400; profile input validated and capped
- [x] Deleted the `notifications` table + 3 routes — no writer existed
- [x] Cron opt-in via `ENABLE_CRON`

## Phase 3 — Scraper / data quality
- [x] All 5 endpoints re-probed live; adapters rewritten against current responses
- [x] HackerEarth: both paths were dead → rewritten against their JSON feed
- [x] MLH: dynamic seasons + the Sep–Dec year-offset bug
- [x] Devfolio + Unstop: registration deadline, not event end
- [x] Unstop prizes summed from `prizes[].cash`
- [x] Devpost: HTML prize strings, year-borrowing start dates, real venue signal
- [x] No fabricated deadlines; stable `source_url`; in-batch dedupe
- [x] Expiry sweep runs unconditionally
- [x] `parsePrizeAmount` handles K / Lakh / Cr / million

## Phase 4 — Frontend foundation
- [x] `lib/format.ts` — one `stripHTML`, one source map, one date/prize formatter
- [x] One `<Nav>` with auth state and sign-out (was inline in 5 pages)
- [x] Shared `<Toast>` with `aria-live`; shared `<HackathonCard>`
- [x] Supabase client no longer throws at module load
- [x] One shared store for saved + calendar (3 requests on `/explore` → 1)
- [x] Loading derived, not set in effects (React 19 cascading-render rule)
- [x] SSE reader buffers across chunk boundaries

## Phase 5 — The missing half
- [x] `/onboarding` — profile capture
- [x] `/for-you` — matched hackathons with reasons
- [x] `saved → applied → submitted` usable from the UI
- [x] `/login` reachable; signed-in state visible everywhere

## Phase 6 — UX & a11y
- [x] Debounced search; filters/sort/page in the URL
- [x] Distinct empty / error / offline states
- [x] Calendar days are real buttons; labels, `aria-live`, global `:focus-visible`
- [x] Muted text raised to WCAG AA; landing-page claims made truthful
- [x] Responsive to phone width; `prefers-reduced-motion` respected

## Phase 7 — Remove the DAA layer
- [x] Deleted `backend/src/utils/daa/` — 7 modules, ~1,500 lines
- [x] Deleted the 8 routes that existed only to demonstrate it
- [x] Calendar ordering → `Array.prototype.sort` (stable since ES2019)
- [x] KNN/LCS recommenders → SQL profile match, now `GET /user/recommendations`,
      which falls back to soonest-closing hackathons when nothing matches the profile
- [x] Extracted `openHackathons` / `withDaysUntilDeadline` into `src/lib/hackathons.js`
      so routes no longer import from other routes
- [x] Frontend references to the removed endpoints deleted
- [x] Dropped the unused `registration_opens` column
- [x] `pg_trgm` finally used — trigram indexes back the ILIKE search

## Phase 8 — Professional engineering
- [x] Git repository initialised, with a restore point before the deletion
- [x] Backend ESLint; both apps lint clean
- [x] Backend test suite on the built-in `node:test` runner, no new dependencies
- [x] GitHub Actions CI — lint + test (backend), lint + build (frontend)
- [x] Multi-stage Dockerfiles, non-root, healthcheck; `docker-compose.yml`
- [x] `output: 'standalone'` for a slim frontend image — verified serving locally
- [x] `LICENSE` (MIT), `CONTRIBUTING.md`, `.editorconfig`, `.gitattributes`
- [x] `README.md` rewritten to match the code

## Phase 9 — Verification
- [x] `npm test` green; `npm run lint` clean both apps; `npm run build` clean
- [x] Backend boots; auth / admin / validation paths verified by request
- [x] All 9 frontend routes return 200; standalone server verified serving CSS
- [x] No temporary files or background processes left behind

## Phase 10 — Real data
- [x] Ran against a real Supabase project, not a local stub — schema applied,
      `on_auth_user_created` trigger fired for real signups
- [x] Full scrape run against all 5 live sources: 325 active hackathons loaded
      (Unstop 186, MLH 79, Devpost 34, Devfolio 20, HackerEarth 6)
- [x] Authenticated flow exercised end-to-end with real accounts: sign-up,
      profile, save/unsave, status changes, calendar
- [x] Explore's domain filter checked against real scraped `domains` values,
      not just against the hardcoded list it used to ship with

## Phase 11 — Remove the chat-based recommender
- [x] Deleted `backend/src/routes/ai.js` and `backend/src/lib/ai.js` —
      `/ai/chat` and `/ai/recommend` are gone (404)
- [x] Removed `@anthropic-ai/sdk` from `backend/package.json`
- [x] Removed `ANTHROPIC_API_KEY` from `backend/.env.example` — nothing reads it
- [x] Dropped `ai_chat_sessions` and `ai_recommendations_cache`, and their RLS
      policies, from `schema.sql`
- [x] Removed the `/ai`-specific rate limiter; only the global 120/min limit remains
- [x] `/assistant` renamed to `/for-you`; chat UI deleted — the page now shows
      only the matched hackathons
- [x] Why: the chat had no access to the `hackathons` table, so it could only
      ever recommend from what it already knew, and the recommendations it did
      surface were already coming from the SQL profile match it fell back to.
      The model wasn't adding anything the query wasn't already doing

## Phase 12 — Security audit (three parallel agents)
- [x] `next` 16.2.3 → 16.3.5 — GHSA-p293-qw3h-jr36, unauthenticated RCE on
      Windows hosts, and this project develops on Windows
- [x] `axios` → 1.20.0 (the scraper parses untrusted upstream JSON with it);
      `node-cron` → 4. Both apps now report 0 advisories
- [x] `/api/admin` required no credentials at all — it held the secret but never
      checked the caller, so a plain curl returned the scrape logs and could
      trigger a five-site scrape. Now gated on `ADMIN_USER_IDS`, answers 404
- [x] Open redirect: `?next=` accepted any URL and Next hard-navigates to a
      foreign origin — a phishing launchpad on a trusted domain
- [x] Raw PostgREST text reached clients (`?domain=a"` → "malformed array
      literal"); `dbError()` logs it instead. `.overlaps()` values sanitised,
      since postgrest-js escapes `.in()` but not `.overlaps()`
- [x] `trust proxy` made opt-in via `TRUST_PROXY` — forging `X-Forwarded-For`
      minted a fresh rate-limit bucket
- [x] Session cookie `Secure` in production; it carries a 400-day refresh token
- [x] CSP, `nosniff`, `X-Frame-Options`, `Referrer-Policy`, HSTS on the
      frontend, which previously sent no security headers at all
- [x] Scraped `source_url` must be `http(s)` — a `javascript:` URI would have
      executed in our origin from the Register link
- [x] Verified clean: cross-tenant isolation on all 12 user-scoped queries, RLS
      empirically (anon and two real users), all 10 DB constraints, cascade
      deletes, no secret in git history or the browser bundle, no XSS sink

## Phase 13 — Test, fix, debug pass (three parallel auditors + live API tests)

Static audit of the backend, static audit of the frontend auth surface, and a
black-box test of the running API with two real accounts. Tenant isolation was
attacked from a second account on all 12 user-scoped queries (id in the body, in
a query param, in a header, in a forged JWT `sub`) and **held on every path**;
no error leakage, secret exposure or rate-limit bypass was found.

Build blocker:
- [x] `/onboarding` called `useSearchParams()` with no Suspense boundary, so
      `npm run build` **failed outright**. `/explore` and `/login` already had
      the wrapper

Authentication:
- [x] The implicit-flow fragment forward was dead code — `@supabase/ssr`
      hardcodes `flowType: 'pkce'` after spreading options, so auth-js throws on
      an implicit callback. Those users were silently signed out with no message.
      Branch deleted, replaced with a real error
- [x] `/auth/callback` ignored `?error=` / `?error_description=` entirely, so an
      expired or reused link showed "Sign in first" and discarded the reason
- [x] `next` was honoured even with no `code`, and it short-circuited the
      new-user check — so a first-time Google user landed on `/explore` with an
      empty profile and was never sent to onboarding. Order reversed
- [x] `/auth/reset` gated on *any* session, so a signed-in user could deep-link
      to it and change the password with no re-auth. ~~Now gated on a marker
      cookie~~ — **superseded in Phase 14:** the cookie was settable from the
      console and protected nothing; replaced by a recent-sign-in check.
      **Known ceiling:** the code exchange still mints a real session — the
      recovery token *is* the session — so the email holder can reach the app
      without resetting. Closing that needs a server-side reset endpoint
- [x] Confirmation email could not be resent by the only people who need it: the
      button lived on `/account`, which an unconfirmed user cannot reach. Added
      to `/login`, shown when sign-in fails as unconfirmed
- [x] `/calendar` flashed the month grid at signed-out visitors — it checked
      `authLoading` after its mount gate, unlike the other four protected pages
- [x] Deleting an account redirected to `/?deleted=1`, which the landing page
      never read. Points at `/login?deleted=1`, which renders it
- [x] Sign-in CTAs on the five protected pages carry `?next=`, so signing in
      returns you where you were instead of dumping you on `/explore`
- [x] Password minimum was 6 at sign-up but 8 on reset and change. 8 for any new
      password; sign-in still accepts an existing 6-character one
- [x] `setState` in an effect body on `/auth/reset` (the React 19 rule the rest
      of the codebase documents avoiding) — derived instead

Admin:
- [x] `/api/admin` returned 503 "Admin is not configured" *before* checking the
      caller, announcing the admin surface to an unauthenticated curl. Identity
      check moved first; verified by request that it now 404s
- [x] The proxy's `setAll` was a no-op, so a server-side token refresh rotated
      the refresh token and threw the new one away — signing the admin out at
      random. Cookies are written back

Backend correctness (each verified live, before and after):
- [x] `?page=99999` → **500**. PostgREST answers 416 past the end of the result
      set; an empty page is the honest answer
- [x] `?source=a"b` → **500**. postgrest-js quotes `(` and `)` inside `in.()`
      but passes a bare `"` through — the one interpolated filter value with no
      sanitisation
- [x] `?limit=-5` on `/user/recommendations` → **500**: clamped at the top only
- [x] `interests` capped the array length but not each string, so 20 x 5,000
      characters persisted and then permanently 500'd that user's own
      `/user/recommendations` with an ~80 KB query string
- [x] `DELETE /user/saved/:id` deleted the calendar row *before* authorising,
      returning 404 after a mutation had already happened
- [x] A malformed body echoed express.json()'s own message under
      `INTERNAL_ERROR`; 429 was `text/plain`, not the API's JSON error shape
- [x] `Authorization: bearer` (lowercase) was a 401 — RFC 7235 makes the scheme
      case-insensitive
- [x] `X-Powered-By: Express` disabled

Scraper data loss:
- [x] MLH matched only `MON dd - dd`, silently dropping **every cross-month and
      single-day event** (Halloween and New Year weekends) with nothing logged.
      Extracted as `mlhEventDates()` and tested against all four shapes
- [x] Bare date strings were parsed in the *server's* timezone, so the same page
      stored a different instant on an IST host than a US one. Pinned to UTC —
      note the first attempt used `includes('T')` to detect ISO, which "OCT 31,
      2026" satisfies; the test caught it
- [x] `parsePrizeAmount` missed plural "Lakhs"/"lacs" — the exact 100,000x
      undercount it exists to prevent — and returned the first shorthand in list
      order rather than the largest, reading "$1M + 100K" as 100,000
- [x] The `scrape_logs` insert error was swallowed, so a failed insert left both
      updates filtering on `id=eq.undefined` — a run with no log row and no
      trace, while `scrape_logs` is the documented drift signal
- [x] One bad page discarded every page already collected for Devpost and Unstop

Deployment:
- [x] CSP pinned `connect-src` to `http://localhost:8080`, so any deployed
      `NEXT_PUBLIC_API_BASE` was blocked and surfaced as "Cannot reach the
      server". Derived from the env var now

- [x] Test suite 26 → 42; both apps lint clean, frontend builds, API verified by
      request end to end. Cascade delete re-verified: removing the test users
      left 0 rows across `profiles`, `saved_hackathons`, `calendar_events`

### Reported and deliberately not changed
- [-] Unknown filter *values* (`?sort=nonsense`, `?hackathon_type=zzz`) are
      dropped rather than rejected, so they return everything while
      `?source=zzz` returns 0. Inconsistent, but rejecting them is a breaking
      API change for no user-visible gain
- [-] Email change is still absent. It needs a confirmation round-trip, and the
      built-in mailer is already over quota
- [-] `/hackathon/[id]` serves the generic site title rather than per-hackathon
      metadata. Real SEO gap for a discovery product, but nothing is broken

## Phase 14 — Security review (three parallel agents)

Auth flows, live access-control testing with two accounts, and a code-level
logic review. **Tenant isolation held on every path — through the API and
directly against Supabase with the public anon key.** No cross-tenant read,
write or delete; forged, `alg:none`, expired, anon-key and service-key tokens
all 401; 30–50-request races left no duplicates; admin gates held against every
path and method trick. What was found, and fixed:

Stolen-session takeover:
- [x] **Deleting the account took one bearer request.** The typed-email check was
      browser-only. Now needs a sign-in within 10 minutes, enforced in the API
      from the token's `amr` claim — verified live that a session whose sign-in
      is 11 minutes old is refused even immediately after a token refresh, which
      is exactly what a stolen, kept-alive session looks like
- [x] **Changing the password needed no current password and no re-auth.**
      Supabase then signs every other session out, so a stolen session locked the
      owner out. Now gated on the same recent sign-in in the UI. **Server-side
      this is only closable in the dashboard** — see Needs you
- [x] The Phase 13 recovery marker cookie was settable from the console and
      protected nothing. Removed; `/auth/reset` uses the recent-sign-in check

Data integrity:
- [x] **Clicking Save again reset "applied"/"submitted" back to "saved."** The
      upsert is a merge on conflict and sent `status: 'saved'`. Reachable from a
      second tab or before the library loaded
- [x] One out-of-range, fractional or `Infinity` prize failed that source's
      whole upsert — every hour, for as long as the listing existed. Prize text
      with several numbers was concatenated into 150,000,230,000. Values are now
      clamped where every source routes through, and the largest number is taken
      (not the first — that reads the `1` out of `1st`, which the tests caught)
- [x] `Infinity` serialises to JSON `null`, which Postgres sorts FIRST on
      "biggest prize" — a hostile listing would have topped it as "₹∞"

Denial of service:
- [x] `stripHTML` and the prize regexes were quadratic. 400 KB of `<` took 46 s
      and 400 K digits 55 s — and scrapes run inside the API process, so that
      froze every request. Now under a millisecond; tests pin it
- [x] Upstream response bodies are capped at 10 MB

Smaller:
- [x] Scraped links are tied to their source's domain (MLH excepted — it links
      to ~80 organiser sites) and may not embed credentials
      (`https://devpost.com@evil.example`). Devfolio slugs must be a plain DNS
      label, since they are interpolated into a hostname
- [x] `/auth/callback` forwarded `?error_description=` verbatim — attacker text
      on the trusted login page. Mapped to fixed messages
- [x] A null in `interests`, writable directly via PostgREST, 500'd
      recommendations
- [x] `page`, `prize_min` past the int/bigint range were 500s; five-digit years
      never expired; `INR_PER_USD` was unvalidated; a malformed upstream element
      threw away the whole source
- [x] A write racing account deletion was a 500; now 401
- [x] The nav's Sign out signed you out of **every device** (supabase-js
      defaults to `scope: 'global'`). Now this device only
- [x] A placeholder domain anyone could register was in the CORS allowlist

Database (in `schema.sql`, re-runnable — **needs running**, see Needs you):
- [x] Profile length caps as a CHECK — direct PostgREST writes stored a
      100,000-character name and 2,000 interests
- [x] Profile `id`/`created_at` no longer user-updatable. A column-level
      `REVOKE` would have been a no-op under Supabase's table-level grant, so the
      grant is replaced by a column list
- [x] `status` NOT NULL; a calendar entry now requires a saved row (FK)

Checked and fine as designed:
- [-] Status moving backwards or skipping steps — it is a personal tracker and
      nothing depends on the order
- [-] Login response timing distinguishes registered addresses (259 ms vs
      195 ms). This is GoTrue's behaviour; no app code can change it. CAPTCHA
      makes probing expensive — see Needs you
- [-] A cross-process scrape lease. Upserts are idempotent, so two concurrent
      runs cost load, not correctness; only matters with multiple replicas

- [x] 73 backend tests (was 54), 15 live checks against the running app, all
      passing. Every disposable account deleted; `hackathons` untouched

## Phase 15 — Cross-component review

A second pass aimed at what the Phase 14 agents did not cover: code added since,
and flaws that live between components rather than inside one.

- [x] **A taken-down listing came back within the hour — and never left users'
      calendars.** `is_active` was the only takedown lever, but every scraper run
      writes `is_active: true`, so a manual takedown reverted on the next hourly
      upsert. Saved and calendar joined `hackathons(*)` with no filter at all, and
      the calendar renders `source_url` as a live link. MLH links go to ~80
      organiser domains that cannot be allowlisted; a lapsed one re-registered by
      a phisher is the case this matters for. Now a human-owned `hidden` column
      the scraper never sends. **Verified live on a real listing:** hidden, it left
      the feed, detail page, Saved, calendar and direct anon reads; an upsert of
      the full row exactly as the scraper sends it returned 200 and left it
      hidden; restored with its data byte-identical
- [x] **"Resend confirmation" said an email was sent when none was.** The sign-in
      that revealed the button spent the CAPTCHA token, the button was not gated
      on a fresh one, Supabase rejected the send, and the single anti-enumeration
      message reported success anyway. Introduced by the Phase 14 CAPTCHA work
- [x] **Behind a hosting proxy, every user would share one rate limit.** With
      `TRUST_PROXY` off, `req.ip` is the proxy for everyone, so the whole site
      shares 120/min. The README warned only about the opposite mistake. Now the
      API warns at boot in production — verified it fires only then

Checked, not vulnerable: no `dangerouslySetInnerHTML`; `banner_url` is never
rendered; `source_url` reaches an `href` only through the scraper, the sole
writer of `hackathons`. GET-based CSRF on the admin proxy lands on a POST-only
route. Google users can re-authenticate silently, but only someone already
controlling that browser can use it, and a stolen refresh token still cannot
mint a fresh sign-in.

## Needs you

- [x] Supabase project created and `schema.sql` run — confirmed against real
      data (Phase 10)
- [x] `ADMIN_SECRET_KEY` generated and set in both env files
- [ ] **Your Supabase user id in `ADMIN_USER_IDS`** (`frontend/.env.local`).
      Until then `/admin` answers 404 to everyone, including you. Sign up
      first, then copy the id from Authentication → Users
- [ ] **Google OAuth credentials** if you want that button back. The provider
      is disabled in the Supabase project, which is why Google sign-in failed —
      the code was never the problem. The button reappears on its own once the
      provider is enabled
- [x] GitHub reconciled — the remote's 80 commits of unrelated history (which
      still carried the AI feature *and* the Next release with the
      unauthenticated RCE) were replaced with this history, as 17 commits
- [x] README CI badge points at `Aayush-Ranjan-26/HackOrbit`
- [ ] **Supabase → Authentication → URL Configuration.** Site URL
      `http://localhost:3000`, redirect URL `http://localhost:3000/auth/callback`.
      Without it, confirmation and password-reset emails do not return to the app
- [ ] **Custom SMTP.** The built-in mailer caps at ~2 emails/hour and was
      exhausted during testing
- [x] **Password minimum raised to 8** (verified: 7 characters → `weak_password`).
      Leaked-password checking is paid-plan only, see above
- [-] **Signups are open** (Auth → Settings). Deliberate for a public discovery
      site; CAPTCHA now makes bulk signup expensive
- [ ] `docker build` has still never been executed — no Docker daemon on this
      machine. The Dockerfiles are written but unverified
- [x] **Run the Phase 14 hardening in `backend/supabase/schema.sql`** (the
      block at the end) in the Supabase SQL editor. It cannot be applied from
      code — PostgREST has no DDL endpoint. Your current data violates none of it
- [x] **Supabase → Auth → Providers → Email → Secure password change.** The
      only server-side fix for a stolen session changing the password. Needs
      custom SMTP first: the re-auth code goes out by email
- [x] **Verified 2026-09-28**, from outside, after the owner applied the above:
      sign-in without a CAPTCHA token → `400 captcha_failed`; a 7-character
      password → `422 weak_password` (minimum now 8); every schema.sql rule
      rejects its violation directly through PostgREST, while the allowed profile
      columns and every API path still work. Secure password change is not
      exposed by the API, so it is set but not independently confirmed
- [-] **Leaked-password protection** is a paid-plan feature. The 8-character
      minimum and CAPTCHA cover much of the same risk
- [x] **Enable CAPTCHA** (Auth → Attack Protection → Turnstile, paste the SECRET
      key). The site key is already wired into /login. There is no per-account
      lockout otherwise; 15 wrong passwords in a row were all accepted as attempts
- [ ] **Click through the app yourself.** Every check so far has been at the
      HTTP and data layer; no browser has driven it. Click handlers, hydration
      settling and CSS layout remain unverified
