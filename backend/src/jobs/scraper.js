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
    [/([\d.]+)\s*(?:cr|crore)s?\b/, 1e7],
    [/([\d.]+)\s*(?:lakh|lac|l)\b/, 1e5],
    [/([\d.]+)\s*(?:k)\b/, 1e3],
    [/([\d.]+)\s*(?:m|mn|million)\b/, 1e6],
  ];

  for (const [re, factor] of MULTIPLIERS) {
    const m = text.match(re);
    if (m) {
      const n = parseFloat(m[1]);
      if (!isNaN(n)) return Math.floor(n * factor);
    }
  }

  const digits = text.replace(/[^0-9.]/g, '');
  const num = parseFloat(digits);
  return isNaN(num) ? 0 : Math.floor(num);
}

/**
 * MLH season N spans the academic year ending in N, so its Sep–Dec events fall in
 * calendar year N-1. Using the season as the year dates every autumn event a year late.
 */
export function mlhEventYear(monthAbbr, season) {
  const autumn = ['aug', 'sep', 'oct', 'nov', 'dec'];
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

function toISO(value) {
  if (!value) return null;
  const d = new Date(value);
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
    const data = await fetchWithRetry(
      `https://devpost.com/api/hackathons?page=${page}&status[]=open`
    );
    const hackathons = data?.hackathons || [];
    if (!hackathons.length) break;

    for (const h of hackathons) {
      if (h.open_state && h.open_state !== 'open') continue;

      // "Jul 31 - Oct 01, 2026" — only the second half carries the year, so the
      // start must borrow it rather than defaulting to the current year.
      let start_date = null;
      let deadline = null;
      const span = h.submission_period_dates;
      if (typeof span === 'string') {
        const [rawStart, rawEnd] = span.includes(' - ') ? span.split(' - ') : [null, span];
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

      const dateMatch = linkText.match(
        /(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{1,2})\s*-\s*(\d{1,2})/i
      );
      if (!dateMatch) return;

      const [, month, startDay, endDay] = dateMatch;
      const year = mlhEventYear(month, season);
      const endISO = toISO(`${month} ${endDay}, ${year}`);
      if (!isFuture(endISO)) return;

      seen.add(title);
      const isDigital = /digital|everywhere/i.test(linkText);
      const afterDate = linkText.slice(linkText.indexOf(dateMatch[0]) + dateMatch[0].length);
      const locationMatch = afterDate.match(/([A-Z][a-z]+[^,]*,\s*[^,]+)/);
      const location = locationMatch
        ? locationMatch[1].replace(/(In-Person|Digital|DIVERSITY|HIGH SCHOOL)/gi, '').trim()
        : null;

      records.push({
        title,
        source: 'mlh',
        // Strip MLH's UTM params so the conflict key stays stable across runs.
        source_url: (href.startsWith('http') ? href : `https://mlh.io${href}`).split('?')[0],
        banner_url: linkEl.find('img').attr('src') || null,
        hackathon_type: isDigital ? 'online' : 'offline',
        description: location || (isDigital ? 'Online / Worldwide' : null),
        registration_deadline: endISO,
        start_date: toISO(`${month} ${startDay}, ${year}`),
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
  const html = await fetchWithRetry('https://devfolio.co/hackathons', {
    headers: { Accept: 'text/html,application/xhtml+xml' },
  });

  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (!match) {
    console.warn('[scraper:devfolio] __NEXT_DATA__ missing — page structure changed');
    return [];
  }

  const data = JSON.parse(match[1]);
  const open = data?.props?.pageProps?.dehydratedState?.queries?.[0]?.state?.data?.open_hackathons || [];
  const records = [];

  for (const h of open) {
    const slug = h.slug || h.uuid;
    if (!slug) continue;

    // ends_at is when the EVENT ends; registration closes earlier, at reg_ends_at.
    // Using ends_at overstates the time left to register by days or weeks.
    const deadline = toISO(h.settings?.reg_ends_at) || toISO(h.ends_at);
    if (!isFuture(deadline)) continue;

    records.push({
      title: stripHTML(h.name) || 'Untitled',
      source: 'devfolio',
      source_url: `https://${slug}.devfolio.co`,
      banner_url: h.cover_img || h.settings?.featured_cover_img || null,
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
async function scrapeUnstop() {
  const records = [];

  for (let page = 1; page <= 15; page++) {
    const data = await fetchWithRetry(
      `https://unstop.com/api/public/opportunity/search-new?opportunity=hackathons&per_page=50&page=${page}&oppstatus=open`
    );
    const opportunities = data?.data?.data || [];
    if (!opportunities.length) break;

    for (const h of opportunities) {
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
  return records;
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
      const { data: logRow } = await supabaseAdmin
        .from('scrape_logs')
        .insert({ source: name, status: 'running' })
        .select('id')
        .single();

      try {
        const records = await fn();
        const count = await upsertHackathons(records);

        await supabaseAdmin
          .from('scrape_logs')
          .update({
            status: 'success',
            finished_at: new Date().toISOString(),
            records_upserted: count,
          })
          .eq('id', logRow?.id);

        console.log(`[scraper:${name}] upserted ${count}`);
        return { name, count };
      } catch (err) {
        console.error(`[scraper:${name}] failed:`, err.message);
        await supabaseAdmin
          .from('scrape_logs')
          .update({
            status: 'error',
            finished_at: new Date().toISOString(),
            error_message: err.message.slice(0, 500),
          })
          .eq('id', logRow?.id);
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
