import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { rateLimit } from 'express-rate-limit';

import hackathonsRouter from './routes/hackathons.js';
import userRouter from './routes/user.js';
import adminRouter from './routes/admin.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { runScrapeJob } from './jobs/scraper.js';

const app = express();
const PORT = process.env.PORT || 8080;

// Only trust X-Forwarded-For when a proxy really is in front. Trusting it
// unconditionally lets any caller rotate the header to reset their own rate limit.
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);

// ─── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // No Origin header = curl / server-to-server. CORS cannot police those anyway;
      // authentication does. Browsers always send one.
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(null, false); // reject cleanly — throwing here surfaces as a 500
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-key'],
  })
);

app.use(express.json({ limit: '100kb' }));

// Nothing here is meant to be embedded or sniffed.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// ─── Rate limits ─────────────────────────────────────────────────────────────
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));


app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.use('/hackathons', hackathonsRouter);
app.use('/user', userRouter);
app.use('/admin', adminRouter);

app.use(notFound);
app.use(errorHandler);

// Exported so tests can close the listener instead of killing the process.
export const server = app.listen(PORT, () => {
  console.log(`\nHackOrbit API on http://localhost:${PORT}  (env: ${process.env.NODE_ENV || 'development'})`);
});

// ─── Scheduled scrape ────────────────────────────────────────────────────────
// Off by default: with more than one instance every replica would scrape in parallel.
// Set ENABLE_CRON=true on exactly one instance, or drive /admin/scrape from an
// external scheduler (GitHub Actions, cron-job.org, Render cron).
if (process.env.ENABLE_CRON === 'true') {
  cron.schedule('0 */6 * * *', () => {
    console.log('[cron] scheduled scrape starting');
    runScrapeJob().catch((err) => console.error('[cron] scrape failed:', err.message));
  });
  console.log('[cron] enabled — scraping every 6 hours');
}

export default app;
