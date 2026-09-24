import { Router } from 'express';
import { isScrapeRunning, runScrapeJob } from '../jobs/scraper.js';
import { supabaseAdmin } from '../lib/supabase.js';

const router = Router();

/**
 * Fails closed: with no ADMIN_SECRET_KEY configured, admin is unreachable rather
 * than guarded by a well-known default. Header only — a key in the query string
 * ends up in proxy logs, browser history and Referer headers.
 */
function requireAdminKey(req, res, next) {
  const expected = process.env.ADMIN_SECRET_KEY;
  if (!expected) {
    return res.status(503).json({ error: 'Admin is not configured', code: 'ADMIN_DISABLED' });
  }
  const provided = req.headers['x-admin-key'];
  if (typeof provided !== 'string' || provided.length !== expected.length) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }
  // Length-independent compare is unnecessary once lengths match; keep it constant-time-ish.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  next();
}

router.use(requireAdminKey);

// One scrape at a time. The guard itself lives in runScrapeJob, because the
// hourly cron is a second caller and a route-local flag never saw it.
router.post('/scrape', (req, res) => {
  if (isScrapeRunning()) {
    return res.status(409).json({ error: 'A scrape is already running', code: 'ALREADY_RUNNING' });
  }
  res.status(202).json({ message: 'Scrape started', started_at: new Date().toISOString() });

  runScrapeJob().catch((err) => console.error('[admin/scrape]', err.message));
});

router.get('/scrape-status', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('scrape_logs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(20);

  if (error) return res.status(500).json({ error: 'Could not read logs', code: 'DB_ERROR' });
  res.json({ logs: data || [], running: isScrapeRunning() });
});

router.get('/stats', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('hackathons')
    .select('source')
    .eq('is_active', true);

  if (error) return res.status(500).json({ error: 'Could not read stats', code: 'DB_ERROR' });

  const by_source = (data || []).reduce((acc, r) => {
    acc[r.source] = (acc[r.source] || 0) + 1;
    return acc;
  }, {});

  res.json({ total: data?.length || 0, by_source });
});

export default router;
