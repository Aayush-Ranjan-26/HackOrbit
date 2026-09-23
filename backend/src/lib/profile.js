import { supabaseAdmin } from './supabase.js';
import { AppError, dbError } from '../middleware/errorHandler.js';

const YEARS = ['1st', '2nd', '3rd', '4th', '5th', 'Working Professional'];
const EXPERIENCE = ['beginner', 'intermediate', 'advanced'];
const FORMATS = ['online', 'offline', 'both'];
const TEAMS = ['solo', 'team', 'either'];

/**
 * Validates a PUT /user/profile body into the columns to write. Throws a 400
 * AppError on bad input. Lives here rather than inside the route so it can be
 * tested directly — the route's own test harness has no valid token, so a
 * request-level test can only ever reach requireAuth.
 *
 * Absent keys are left alone (not nulled); null or '' clears a column.
 */
export function buildProfileUpdate(body) {
  const b = body || {};
  const set = {};

  const str = (key, max = 120) => {
    if (b[key] === undefined) return;
    if (b[key] === null || b[key] === '') return void (set[key] = null);
    if (typeof b[key] !== 'string') throw new AppError(`${key} must be a string`, 400, 'BAD_REQUEST');
    set[key] = b[key].trim().slice(0, max);
  };

  const oneOf = (key, allowed) => {
    if (b[key] === undefined) return;
    // null / '' means "not answered", and every one of these columns is
    // nullable. The onboarding form sends null for each question the user
    // skipped ("Prefer not to say" on year of study, no experience picked), so
    // rejecting null 400'd the entire save — including the interests alongside
    // it, which left the recommender with nothing to match on. `str` already
    // cleared on null; this did not, and onboarding never once succeeded.
    if (b[key] === null || b[key] === '') return void (set[key] = null);
    if (!allowed.includes(b[key])) {
      throw new AppError(`${key} must be one of: ${allowed.join(', ')}`, 400, 'BAD_REQUEST');
    }
    set[key] = b[key];
  };

  str('display_name');
  str('college');
  str('avatar_url', 500);
  oneOf('year_of_study', YEARS);
  oneOf('experience', EXPERIENCE);
  oneOf('format_pref', FORMATS);
  oneOf('team_pref', TEAMS);

  if (b.interests !== undefined) {
    if (!Array.isArray(b.interests) || b.interests.some((i) => typeof i !== 'string')) {
      throw new AppError('interests must be an array of strings', 400, 'BAD_REQUEST');
    }
    // Cap the list AND each entry: capping only the length let a client store
    // 20 x 5,000 characters, which then built an ~80 KB `domains=ov.{…}` query
    // string and 500'd that user's own /user/recommendations on every call.
    set.interests = [
      ...new Set(b.interests.map((i) => i.trim().slice(0, 60)).filter(Boolean)),
    ].slice(0, 20);
  }

  if (b.onboarding_complete !== undefined) {
    set.onboarding_complete = Boolean(b.onboarding_complete);
  }

  return set;
}

/** PostgREST reports "no rows" from .single() as PGRST116; anything else is a real failure. */
export function isNoRows(error) {
  return error?.code === 'PGRST116';
}

/**
 * Returns the caller's profile, creating an empty row if the signup trigger
 * never ran (users created before the trigger, or via the admin API).
 * Every personalised route depends on this row existing.
 */
export async function getProfile(userId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw dbError(error);
  if (data) return data;

  const { data: created, error: createError } = await supabaseAdmin
    .from('profiles')
    .upsert({ id: userId }, { onConflict: 'id' })
    .select()
    .single();

  if (createError) throw dbError(createError);
  return created;
}
