import { supabaseAdmin } from './supabase.js';
import { AppError } from '../middleware/errorHandler.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rejects a malformed id before Postgres turns it into a 500-shaped 22P02. */
export function assertHackathonId(id) {
  if (!UUID_RE.test(id)) throw new AppError('Invalid hackathon id', 400, 'BAD_REQUEST');
  return id;
}

/**
 * postgrest-js escapes values for .in() but NOT for .overlaps(), so a brace or
 * quote reaching a text[] filter breaks the array literal and Postgres returns
 * its own error. These characters never appear in a real domain name.
 */
export function sanitizeDomains(values) {
  return values
    .map((v) => String(v).replace(/[{}",\\]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 20);
}

/** Active hackathons whose registration window is still open — the base set everywhere. */
export function openHackathons(columns = '*', options = {}) {
  return supabaseAdmin
    .from('hackathons')
    .select(columns, options)
    .eq('is_active', true)
    .gt('registration_deadline', new Date().toISOString());
}

/** Adds the countdown the UI renders, so the client never computes it from a stale clock. */
export function withDaysUntilDeadline(hackathons) {
  const now = Date.now();
  return hackathons.map((h) => ({
    ...h,
    days_until_deadline: h.registration_deadline
      ? Math.ceil((new Date(h.registration_deadline).getTime() - now) / 86400000)
      : null,
  }));
}
