import axios from 'axios';
import * as cheerio from 'cheerio';
import { supabaseAdmin } from '../lib/supabase.js';

// FX drifts. Override without a code change when the rate moves enough to matter.
// ponytail: single static rate; swap for a daily FX fetch if prize ranking across
// currencies ever becomes a headline feature.
const INR_PER_USD = Number(process.env.INR_PER_USD) || 88;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ─── Shared helpers ──────────────────────────────────────────────────────────

async function fetchWithRetry(url, options = {}, retries = 3, baseDelay = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios({
        url,
        method: options.method || 'GET',
        data: options.data,
        timeout: 20000,
        headers: { 'User-Agent': UA, ...options.headers },
      });
      return response.data;
    } catch (err) {
      // 4xx means the page is wrong, not busy — retrying just wastes time.
      // 429 is the exception: it is explicitly asking us to wait.
      const status = err.response?.status;
      if (status && status >= 400 && status < 500 && status !== 429) throw err;
      if (attempt === retries) throw err;
      const delay = baseDelay * 2 ** (attempt - 1);
      console.log(`[scraper] retry ${attempt}/${retries} for ${url} in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

export function stripHTML(str) {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses prize text into a plain number, honouring the shorthand these sites use.
 * "10K" and "₹1.5 Lakh" are 10,000 and 150,000 — stripping non-digits would read
 * them as 10 and 1.5, which silently wrecks prize ranking.
 */
export function parsePrizeAmount(raw) {
  if (raw == null) return 0;
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.floor(raw) : 0;

  const text = stripHTML(String(raw)).toLowerCase().replace(/,/g, '');
  const MULTIPLIERS = [
    // The plural matters: "10 Lakhs" without the `s?` fell through to the digit
    // strip and read as 10 — the exact 100,000x undercount this function exists
    // to prevent.
    [/([\d.]+)\s*(?:crores?|crs?)\b/, 1e7],
    [/([\d.]+)\s*(?:lakhs?|lacs?|l)\b/, 1e5],
    [/([\d.]+)\s*(?:k)\b/, 1e3],
    [/([\d.]+)\s*(?:millions?|mil|mn|m)\b/, 1e6],
  ];

  /*
   * Take the largest figure, not the first in list order: returning on first
   * match read "$1M + 100K in prizes" as 100,000, because `k` sat ahead of `m`.
   */
  let best = 0;
  for (const [re, factor] of MULTIPLIERS) {
    const m = text.match(re);
    if (!m) continue;
    const n = parseFloat(m[1]);
    if (!isNaN(n)) best = Math.max(best, Math.floor(n * factor));
  }
  if (best > 0) return best;

  const digits = text.replace(/[^0-9.]/g, '');
  const num = parseFloat(digits);
  return isNaN(num) ? 0 : Math.floor(num);
}

/**
 * MLH season N spans the academic year ending in N, so its Sep–Dec events fall in
 * calendar year N-1. Using the season as the year dates every autumn event a year late.
 */
export function mlhEventYear(monthAbbr, season) {
  // July too: season 2027's earliest event is 2026-07-11, and no season page
  // carries a July event belonging to the season's own year.
  const autumn = ['jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  return autumn.includes(String(monthAbbr).slice(0, 3).toLowerCase())
    ? String(Number(season) - 1)
    : String(season);
}

/** The two MLH seasons that can hold upcoming events, derived from today. */
export function mlhSeasons(now = new Date()) {
  const y = now.getFullYear();
  // Seasons are named for the year they end in, so from August we are already
  // inside the season named for next year.
  return now.getMonth() >= 7 ? [String(y + 1), String(y + 2)] : [String(y), String(y + 1)];
}

const MONTHS = 'JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC';

export function toISO(value) {
  if (!value) return null;
  const raw = String(value).trim();

  /*
   * A bare date like "SEP 7, 2025" (MLH, Devpost) is parsed in the *server's*
   * timezone, so the same page stored 2025-09-06T18:30Z on an IST host and a
   * different instant on a US one — shifting days_until_deadline by a day and
   * moving when the expiry sweep drops the row. Pin those to UTC. Strings that
   * already carry a zone or a time (every ISO timestamp from Unstop, Devfolio
   * and HackerEarth) pass through untouched.
   */
  // Testing for a literal 'T' to spot an ISO string does not work: "OCT 31,
  // 2026" contains one. Match the ISO shape itself.
  const hasZone = /(?:z|utc|gmt|[+-]\d{2}:?\d{2})$/i.test(raw);
  const isoShaped = /^\d{4}-\d{2}-\d{2}T/.test(raw);
  const d = new Date(hasZone ? raw : isoShaped ? `${raw}Z` : `${raw} UTC`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function isFuture(iso) {
  return Boolean(iso) && new Date(iso).getTime() > Date.now();
}

/**
 * Devpost and HackerEarth hand us their `url` field verbatim, and it ends up in
 * an <a href>. A javascript: URI there would execute in our origin on click,
 * so anything that is not http(s) is dropped rather than stored.
 */
function isSafeUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(String(value)).protocol);
  } catch {
    return false;
  }
}

async function upsertHackathons(records) {
  if (!records.length) return 0;
  // Last write wins within a batch — Postgres rejects an upsert that touches the
  // same conflict key twice in one statement.
  const safe = records.filter((r) => {
    if (isSafeUrl(r.source_url)) return true;
    console.warn(`[scraper] dropped ${r.source} record with unsafe source_url`);
    return false;
  });
  const deduped = [...new Map(safe.map((r) => [`${r.source}|${r.source_url}`, r])).values()];

  const { data, error } = await supabaseAdmin
    .from('hackathons')
    .upsert(deduped, { onConflict: 'source,source_url', ignoreDuplicates: false })
    .select('id');

  if (error) throw new Error(`DB upsert error: ${error.message}`);
  return data?.length || 0;
}

// ─── Devpost ─────────────────────────────────────────────────────────────────
async function scrapeDevpost() {
  const records = [];

  for (let page = 1; page <= 20; page++) {
    let data;
    try {
      // `open` means *submissions* are open. `upcoming` is a much larger set
      // whose REGISTRATION is already live with a real future deadline — which
      // is what this app tracks — so it belongs in the feed. per_page is
      // clamped to 40 server-side; asking for more just returns 40.
      data = await fetchWithRetry(
        `https://devpost.com/api/hackathons?page=${page}&per_page=40&status[]=open&status[]=upcoming`
      );
    } catch (err) {
      // Keep what earlier pages produced instead of failing the whole source,
      // the way the MLH adapter already isolates a single season.
      console.warn(`[scraper:devpost] page ${page} failed (${err.message}) — keeping ${records.length} so far`);
      break;
    }
    const hackathons = data?.hackathons || [];
    if (!hackathons.length) break;

    for (const h of hackathons) {
      // Without this the extra `upcoming` records are fetched and immediately
      // thrown away. `ended` still never gets through.
      if (h.open_state && !['open', 'upcoming'].includes(h.open_state)) continue;

      // "Jul 31 - Oct 01, 2026" — only the second half carries the year, so the
      // start must borrow it rather than defaulting to the current year.
      let start_date = null;
      let deadline = null;
      const span = h.submission_period_dates;
      if (typeof span === 'string') {
        const [rawStart, spanEnd] = span.includes(' - ') ? span.split(' - ') : [null, span];
        let rawEnd = spanEnd;
        // Inside one month Devpost drops the month from the end: "Sep 11 - 27,
        // 2026". `toISO("27, 2026")` is null, so isFuture() rejected it and a
        // live hackathon vanished with no log line. Borrow the month from the
        // start of the same string — nothing is invented.
        const startMonth = rawStart?.trim().match(/^[A-Za-z]{3,}/)?.[0];
        if (startMonth && !/[A-Za-z]/.test(rawEnd)) rawEnd = `${startMonth} ${rawEnd.trim()}`;
        deadline = toISO(rawEnd);
        if (rawStart && deadline) {
          const year = new Date(deadline).getUTCFullYear();
          start_date = toISO(`${rawStart.trim()}, ${year}`);
          // A start after the end means the span crossed New Year.
          if (start_date && start_date > deadline) {
            start_date = toISO(`${rawStart.trim()}, ${year - 1}`);
          }
        }
      }
      if (!isFuture(deadline)) continue;

      // prize_amount arrives as HTML like `$<span ...>740,000</span>`.
      const prizeUsd = parsePrizeAmount(h.prize_amount);
      const location = stripHTML(h.displayed_location?.location || '');
      const online = /online|worldwide|anywhere|virtual/i.test(location);

      records.push({
        title: stripHTML(h.title) || 'Untitled',
        source: 'devpost',
        source_url: h.url || `https://devpost.com/hackathons/${h.id}`,
        banner_url: h.thumbnail_url || null,
        description: location || null,
        hackathon_type: online ? 'online' : 'offline',
        prize_pool: prizeUsd > 0 ? `$${prizeUsd.toLocaleString('en-US')}` : null,
        prize_value_inr: prizeUsd > 0 ? Math.floor(prizeUsd * INR_PER_USD) : 0,
        registration_deadline: deadline,
        start_date,
        // Devpost's submission window closes when the hackathon does.
        submission_deadline: deadline,
        domains: (h.themes || []).map((t) => t.name).filter(Boolean),
        is_active: true,
        updated_at: new Date().toISOString(),
      });
    }
  }
  return records;
}

/**
 * Reads the date out of an MLH event link's text.
 *
 * Three shapes appear: "SEP 13 - 14", "OCT 31 - NOV 02" and a single-day
 * "JAN 24". Only the first was matched, so every cross-month and single-day
 * event was dropped — Halloween and New Year weekends never reached the DB, and
 * nothing logged the skip, so scrape_logs showed a healthy run with a quietly
 * lower count.
 *
 * Returns null when there is no date to read.
 */
export function mlhEventDates(linkText, season) {
  const match = String(linkText).match(
    new RegExp(`(${MONTHS})\\s+(\\d{1,2})(?:\\s*[-\u2013]\\s*(?:(${MONTHS})\\s+)?(\\d{1,2}))?`, 'i')
  );
  if (!match) return null;

  const [matched, month, startDay, endMonthRaw, endDayRaw] = match;
  const endMonth = endMonthRaw || month;
  const endDay = endDayRaw || startDay;

  // DEC 30 - JAN 01 crosses the new year, and mlhEventYear already knows that
  // January belongs to the season's own year while December does not.
  return {
    matched,
    startISO: toISO(`${month} ${startDay}, ${mlhEventYear(month, season)}`),
    endISO: toISO(`${endMonth} ${endDay}, ${mlhEventYear(endMonth, season)}`),
  };
}

// ─── MLH ─────────────────────────────────────────────────────────────────────
async function scrapeMLH() {
  const records = [];
  const seen = new Set();

  for (const season of mlhSeasons()) {
    // The next season's page does not exist until MLH publishes it, and a 404
    // on one season must not take the whole source down.
    let html;
    try {
      html = await fetchWithRetry(`https://mlh.io/seasons/${season}/events`);
    } catch (err) {
      console.warn(`[scraper:mlh] season ${season} unavailable (${err.message}) — skipping`);
      continue;
    }
    const $ = cheerio.load(html);

    $('h4').each((_, el) => {
      const title = $(el).text().trim();
      if (!title || title.length < 3 || seen.has(title)) return;

      const linkEl = $(el).closest('a').length ? $(el).closest('a') : $(el).parent().find('a').first();
      const href = linkEl.attr('href') || '';
      const linkText = linkEl.text().trim();
      if (!href || !linkText || href.includes('mlh.io/seasons')) return;

      /*
       * Every card is now a schema.org/Event carrying exact ISO dates and an
       * attendance mode. Prefer those over the "SEP 25 - 27" link text, whose
       * year has to be inferred from the season — and that inference is a year
       * LATE for every July event, because season 2027 opens in July 2026. Six
       * finished hackathons were sitting in the feed with a 2027 deadline, which
       * the expiry sweep would not have touched for ten months.
       */
      const meta = (prop) => linkEl.find(`meta[itemprop="${prop}"]`).attr('content') || '';
      const dates =
        meta('startDate') && meta('endDate')
          ? { startISO: toISO(meta('startDate')), endISO: toISO(meta('endDate')), matched: '' }
          : mlhEventDates(linkText, season);

      if (!dates) {
        console.warn(`[scraper:mlh] no date in "${linkText.slice(0, 80)}" — skipping "${title}"`);
        return;
      }
      const { startISO, endISO, matched } = dates;
      if (!isFuture(endISO)) return;

      seen.add(title);
      const mode = meta('eventAttendanceMode');
      // "DigitalOcean" in a title matched /digital/ and flipped an in-person
      // event online, so the declared mode wins wherever it exists.
      const isDigital = mode ? /Online/.test(mode) : /digital|everywhere/i.test(linkText);
      const hackathon_type = /Mixed/.test(mode) ? 'hybrid' : isDigital ? 'online' : 'offline';

      // matched is '' on the microdata path, so guard before slicing by it.
      const afterDate = matched ? linkText.slice(linkText.indexOf(matched) + matched.length) : '';
      const locationMatch = afterDate.match(/([A-Z][a-z]+[^,]*,\s*[^,]+)/);
      const location =
        linkEl.find('[itemprop="location"] [itemprop="name"]').first().text().trim() ||
        (locationMatch
          ? locationMatch[1].replace(/(In-Person|Digital|DIVERSITY|HIGH SCHOOL)/gi, '').trim()
          : null) ||
        null;

      records.push({
        title,
        source: 'mlh',
        // Strip MLH's UTM params so the conflict key stays stable across runs.
        source_url: (href.startsWith('http') ? href : `https://mlh.io${href}`).split('?')[0],
        banner_url: linkEl.find('img').attr('src') || null,
        hackathon_type,
        description: location || (isDigital ? 'Online / Worldwide' : null),
        registration_deadline: endISO,
        start_date: startISO,
        end_date: endISO,
        domains: ['General', 'Software Development'],
        is_active: true,
        prize_pool: null,
        prize_value_inr: 0,
        updated_at: new Date().toISOString(),
      });
    });
  }
  return records;
}

// ─── HackerEarth ─────────────────────────────────────────────────────────────
// The challenges page is now client-rendered with no __NEXT_DATA__, so HTML
// scraping yields nothing. This JSON feed is what their browser extension uses.
async function scrapeHackerEarth() {
  const data = await fetchWithRetry('https://www.hackerearth.com/chrome-extension/events/');
  const events = data?.response || [];
  const records = [];

  for (const h of events) {
    if (!h.url || !h.title) continue;
    const deadline = toISO(h.end_utc_tz || h.end_timestamp);
    if (!isFuture(deadline)) continue; // no fabricated dates — skip instead

    records.push({
      title: stripHTML(h.title),
      source: 'hackerearth',
      source_url: h.url.split('?')[0],
      banner_url: h.thumbnail || null,
      description: stripHTML(h.description) || null,
      hackathon_type: 'online',
      prize_pool: null,
      prize_value_inr: 0,
      registration_deadline: deadline,
      start_date: toISO(h.start_utc_tz || h.start_timestamp),
      end_date: deadline,
      domains: [h.challenge_type || 'Competitive Programming'].filter(Boolean),
      is_active: true,
      updated_at: new Date().toISOString(),
    });
  }
  return records;
}

// ─── Devfolio ────────────────────────────────────────────────────────────────
async function scrapeDevfolio() {
  // The /hackathons page server-renders only 20 open hackathons — its own
  // GraphQL query carries `limit: 20`, and Devfolio's anonymous Hasura role
  // caps any page at 20 rows anyway, so __NEXT_DATA__ could never yield more.
  // This is the index their /hackathons/open page reads; it returns a total, so
  // the loop stops as soon as it has everything.
  const open = [];
  for (let from = 0; from < 500; from += 100) {
    const data = await fetchWithRetry('https://api.devfolio.co/api/search/hackathons', {
      method: 'POST',
      data: { type: 'application_open', from, size: 100 },
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    const hits = data?.hits?.hits || [];
    if (!hits.length) break;
    open.push(...hits.map((hit) => hit._source).filter(Boolean));
    if (open.length >= (data?.hits?.total?.value ?? 0)) break;
  }

  if (!open.length) console.warn('[scraper:devfolio] search index returned nothing — endpoint may have changed');
  const records = [];

  for (const h of open) {
    const slug = h.slug || h.uuid;
    if (!slug) continue;

    // ends_at is when the EVENT ends; registration closes earlier, at reg_ends_at.
    // Using ends_at overstates the time left to register by days or weeks.
    // The search index names the settings block `hackathon_setting`; the old
    // SSR payload called it `settings`. Both are read so either shape works.
    const settings = h.hackathon_setting || h.settings;
    const deadline = toISO(settings?.reg_ends_at) || toISO(h.ends_at);
    if (!isFuture(deadline)) continue;

    records.push({
      title: stripHTML(h.name) || 'Untitled',
      source: 'devfolio',
      source_url: `https://${slug}.devfolio.co`,
      banner_url: h.cover_img || settings?.logo || settings?.featured_cover_img || null,
      description: h.tagline ? stripHTML(h.tagline) : null,
      hackathon_type: h.is_online ? 'online' : 'offline',
      prize_pool: null,
      prize_value_inr: 0,
      registration_deadline: deadline,
      start_date: toISO(h.starts_at),
      end_date: toISO(h.ends_at),
      submission_deadline: toISO(h.ends_at),
      domains: ['General'],
      is_active: true,
      updated_at: new Date().toISOString(),
    });
  }
  return records;
}

// Unstop's required_skills are AI-generated and dominated by soft skills that
// apply to every hackathon ("Problem Solving" tagged 20/50 records). Stored as
// domains they outrank every real subject and make the filter useless.
const GENERIC_SKILL =
  /problem solving|teamwork|collaborat|public speaking|presentation|communicat|critical thinking|time management|leadership|adaptab|interpersonal|creativ|ideation|innovation management|technical skills|analytical thinking|attention to detail|soft skill/i;

/** True for skills that say nothing about a hackathon's subject matter. */
export function isGenericSkill(name) {
  return GENERIC_SKILL.test(String(name));
}

// ─── Unstop ──────────────────────────────────────────────────────────────────
/*
 * Unstop files some genuine hackathons under `opportunity=competitions`, mixed
 * in with ~350 B-plans, quizzes, case studies and Shark-Tank clones. `subtype`
 * does not separate them — `innovation_challenge` holds "Robo War" and
 * "Advertising Competition" next to real hackathons — so the title is the only
 * reliable signal.
 *
 * Deliberately not a bare `\w+athon`: that also matches Brandathon, CADathon,
 * Filmathon and Case-a-thon, none of which is a hackathon.
 *
 * ponytail: a title regex is a heuristic and will miss an oddly-named hackathon.
 * Worth replacing only if Unstop ever exposes a real type for these.
 */
const HACKATHON_TITLE = /\bhack(?:athon|s|[- ]?sphere)?\b|\bideathon\b|\bbuildathon\b|\bcodeathon\b|\bdatathon\b/i;

/** True for a competitions-feed title that names an actual hackathon. */
export function isHackathonTitle(title) {
  return HACKATHON_TITLE.test(String(title));
}

async function scrapeUnstop() {
  const records = [];
  // The hackathons feed reports last_page: 5, so the 15-page budget was never
  // the constraint. The competitions feed is where the extra records hide.
  for (const feed of ['hackathons', 'competitions']) await scrapeUnstopFeed(feed, records);
  return records;
}

async function scrapeUnstopFeed(feed, records) {
  for (let page = 1; page <= 15; page++) {
    let data;
    try {
      data = await fetchWithRetry(
        `https://unstop.com/api/public/opportunity/search-new?opportunity=${feed}&per_page=50&page=${page}&oppstatus=open`
      );
    } catch (err) {
      console.warn(`[scraper:unstop] ${feed} page ${page} failed (${err.message}) — keeping ${records.length} so far`);
      break;
    }
    const opportunities = data?.data?.data || [];
    if (!opportunities.length) break;

    for (const h of opportunities) {
      // The hackathons feed is already the right set; only the mixed
      // competitions feed needs its titles checked.
      if (feed === 'competitions' && !isHackathonTitle(h.title)) continue;
      if (['closed', 'completed'].includes(String(h.status).toLowerCase())) continue;

      // end_date is the EVENT end; end_regn_dt is when registration actually closes.
      const deadline = toISO(h.regnRequirements?.end_regn_dt) || toISO(h.end_date);
      if (!isFuture(deadline)) continue;

      // prizes_amount no longer exists — the payout lives in a prizes[] array.
      const prizes = Array.isArray(h.prizes) ? h.prizes : [];
      const cash = prizes.reduce((sum, p) => sum + (Number(p.cash) || 0), 0);
      const nonRupee = prizes.find((p) => p.currencyCode && p.currencyCode !== 'INR');
      const prizeInr = nonRupee ? Math.floor(cash * INR_PER_USD) : cash;

      const min_team = h.regnRequirements?.min_team_size || 1;
      const max_team = h.regnRequirements?.max_team_size || 4;

      // Unstop renamed these: `categories` and `skills` are gone. `filters` is
      // eligibility ("Undergraduate", "Engineering Students"), not subject
      // matter, so `required_skills` is the only real domain signal left.
      const skills = [
        ...new Set(
          (h.required_skills || [])
            .map((s) => s.skill_name || s.skill)
            .filter((name) => name && !isGenericSkill(name))
        ),
      ].slice(0, 8);
      // Everything was soft skills — better a usable bucket than an empty one.
      const domains = skills.length ? skills : ['General'];

      const region = String(h.region || '').toLowerCase();
      const type = ['online', 'offline', 'hybrid'].includes(region)
        ? region
        : h.is_online
          ? 'online'
          : 'offline';

      records.push({
        title: stripHTML(h.title),
        source: 'unstop',
        source_url: `https://unstop.com/${h.public_url || h.seo_url || h.id}`,
        banner_url: h.banner_mobile?.image_url || h.logoUrl2 || h.banner?.image_url || null,
        description: stripHTML(h.description?.slice(0, 500)) || null,
        hackathon_type: type,
        prize_pool: prizeInr > 0 ? `₹${prizeInr.toLocaleString('en-IN')}` : null,
        prize_value_inr: prizeInr,
        registration_deadline: deadline,
        start_date: toISO(h.start_date),
        end_date: toISO(h.end_date),
        submission_deadline: toISO(h.end_date),
        team_size_min: parseInt(min_team) || 1,
        team_size_max: parseInt(max_team) || 4,
        team_size_label: `${min_team}–${max_team} members`,
        domains: [...new Set(domains)],
        is_active: true,
        updated_at: new Date().toISOString(),
      });
    }
  }
}

// ─── Job runner ──────────────────────────────────────────────────────────────

const SOURCES = [
  { name: 'devpost', fn: scrapeDevpost },
  { name: 'mlh', fn: scrapeMLH },
  { name: 'hackerearth', fn: scrapeHackerEarth },
  { name: 'devfolio', fn: scrapeDevfolio },
  { name: 'unstop', fn: scrapeUnstop },
];

export async function runScrapeJob() {
  console.log('[scraper] starting');

  const results = await Promise.allSettled(
    SOURCES.map(async ({ name, fn }) => {
      const { data: logRow, error: logError } = await supabaseAdmin
        .from('scrape_logs')
        .insert({ source: name, status: 'running' })
        .select('id')
        .single();

      // Without this, a failed insert left logRow undefined and the updates
      // below filtered on `id=eq.undefined` — so the run left no log row and no
      // trace, and scrape_logs is where a drifted adapter shows up first.
      if (logError) console.error(`[scraper:${name}] could not open a scrape_logs row:`, logError.message);
      const logId = logRow?.id ?? null;

      const finish = async (fields) => {
        if (!logId) return;
        const { error } = await supabaseAdmin
          .from('scrape_logs')
          .update({ finished_at: new Date().toISOString(), ...fields })
          .eq('id', logId);
        if (error) console.error(`[scraper:${name}] could not close its scrape_logs row:`, error.message);
      };

      try {
        const records = await fn();
        const count = await upsertHackathons(records);

        await finish({ status: 'success', records_upserted: count });

        console.log(`[scraper:${name}] upserted ${count}`);
        return { name, count };
      } catch (err) {
        console.error(`[scraper:${name}] failed:`, err.message);
        await finish({ status: 'error', error_message: err.message.slice(0, 500) });
        throw err;
      }
    })
  );

  // Expiry is a property of the deadline, not of whether a scrape succeeded, so
  // this runs unconditionally — otherwise one DB hiccup leaves expired hackathons
  // showing as open until the next good run.
  const { error: sweepError } = await supabaseAdmin
    .from('hackathons')
    .update({ is_active: false })
    .eq('is_active', true)
    .lt('registration_deadline', new Date().toISOString());
  if (sweepError) console.error('[scraper] expiry sweep failed:', sweepError.message);

  const ok = results.filter((r) => r.status === 'fulfilled');
  const total = ok.reduce((sum, r) => sum + r.value.count, 0);
  console.log(`[scraper] done — ${total} records across ${ok.length}/${SOURCES.length} sources`);
  return { total, sources: ok.length };
}

// `npm run scrape`
if (process.argv[1] && process.argv[1].endsWith('scraper.js')) {
  runScrapeJob()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
