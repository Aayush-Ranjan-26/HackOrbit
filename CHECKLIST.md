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
- [x] `README.md` and `context.md` rewritten to match the code

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
- [ ] **Two Supabase dashboard settings.** Password minimum is 6 with no
      complexity rule and no leaked-password check (Auth → Passwords), and
      signups are open (Auth → Settings). Neither is reachable from code
- [ ] `docker build` has still never been executed — no Docker daemon on this
      machine. The Dockerfiles are written but unverified
- [ ] **Click through the app yourself.** Every check so far has been at the
      HTTP and data layer; no browser has driven it. Click handlers, hydration
      settling and CSS layout remain unverified
