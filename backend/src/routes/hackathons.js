import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import {
  assertHackathonId, openHackathons, sanitizeDomains, withDaysUntilDeadline,
} from '../lib/hackathons.js';
import { AppError, dbError } from '../middleware/errorHandler.js';

const router = Router();


const SORTS = {
  deadline_asc: { column: 'registration_deadline', ascending: true },
  prize_desc: { column: 'prize_value_inr', ascending: false },
  newest: { column: 'created_at', ascending: false },
};

/**
 * PostgREST parses its own filter grammar, so an interpolated value can inject
 * extra predicates and, through parse errors, enumerate columns. These
 * characters carry no meaning in a hackathon title.
 */
function sanitizeSearch(raw) {
  return String(raw).replace(/[,()*\\".%]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(query.limit) || 20));
  const from = (page - 1) * limit;
  return { page, limit, from, to: from + limit - 1 };
}

// ─── GET /hackathons ─────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { page, limit, from, to } = parsePagination(req.query);
    const { search, domain, hackathon_type, prize_min, source, deadline_from, deadline_to, sort } =
      req.query;

    let query = openHackathons('*', { count: 'exact' });

    if (search) {
      const term = sanitizeSearch(search);
      // Backed by the trigram indexes in schema.sql — a leading wildcard cannot
      // use a btree index.
      if (term) query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
    }
    if (domain) {
      const wanted = sanitizeDomains(String(domain).split(','));
      if (wanted.length) query = query.overlaps('domains', wanted);
    }
    if (hackathon_type && ['online', 'offline', 'hybrid'].includes(hackathon_type)) {
      query = query.eq('hackathon_type', hackathon_type);
    }
    if (prize_min !== undefined) query = query.gte('prize_value_inr', parseInt(prize_min) || 0);
    if (source) query = query.in('source', String(source).split(',').map((s) => s.trim()));
    if (deadline_from && !isNaN(Date.parse(deadline_from))) {
      query = query.gte('registration_deadline', new Date(deadline_from).toISOString());
    }
    if (deadline_to && !isNaN(Date.parse(deadline_to))) {
      query = query.lte('registration_deadline', new Date(deadline_to).toISOString());
    }

    const order = SORTS[sort] || SORTS.deadline_asc;
    query = query.order(order.column, { ascending: order.ascending });

    const { data, error, count } = await query.range(from, to);
    if (error) throw dbError(error);

    res.json({ data: withDaysUntilDeadline(data || []), total: count || 0, page, limit });
  } catch (err) {
    next(err);
  }
});

// ─── GET /hackathons/domains ─────────────────────────────────────────────────
// The filter dropdown was a hardcoded list that barely intersected the scraped
// data, so picking a domain returned nothing. This serves the domains that
// actually exist, most common first.
// ponytail: counted in Node over open hackathons; move to a materialised view
// if the table ever outgrows a few thousand rows.
let domainCache = { at: 0, data: [] };
const DOMAIN_TTL = 10 * 60 * 1000;

router.get('/domains', async (_req, res, next) => {
  try {
    if (Date.now() - domainCache.at < DOMAIN_TTL) return res.json({ domains: domainCache.data });

    const { data, error } = await openHackathons('domains');
    if (error) throw dbError(error);

    const counts = new Map();
    for (const row of data || []) {
      for (const d of row.domains || []) {
        const name = String(d).trim();
        if (name) counts.set(name, (counts.get(name) || 0) + 1);
      }
    }

    const ranked = [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    );
    // One-offs make the dropdown unusable, but on a small or freshly seeded
    // dataset every domain may be a one-off — an empty dropdown is worse.
    const common = ranked.filter(([, n]) => n > 1);
    const domains = (common.length ? common : ranked)
      .slice(0, 40)
      .map(([name, count]) => ({ name, count }));

    domainCache = { at: Date.now(), data: domains };
    res.json({ domains });
  } catch (err) {
    next(err);
  }
});

// ─── GET /hackathons/:id ─────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    assertHackathonId(req.params.id);

    const { data, error } = await supabaseAdmin
      .from('hackathons')
      .select('*')
      .eq('id', req.params.id)
      .eq('is_active', true)
      .maybeSingle();

    if (error) throw dbError(error);
    if (!data) throw new AppError('Hackathon not found', 404, 'NOT_FOUND');

    res.json(withDaysUntilDeadline([data])[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
