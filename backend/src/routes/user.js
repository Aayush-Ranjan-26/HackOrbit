import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { getProfile } from '../lib/profile.js';
import { assertHackathonId, openHackathons, sanitizeDomains } from '../lib/hackathons.js';
import { AppError, dbError } from '../middleware/errorHandler.js';

/** Postgres foreign-key violation: the hackathon id is well formed but gone. */
const isMissingHackathon = (error) => error?.code === '23503';

const router = Router();

// Every route below is user-owned data.
router.use(requireAuth);

/** Every :hackathon_id route validates before touching the database. */
function hackathonId(req) {
  return assertHackathonId(req.params.hackathon_id);
}

// ─── PROFILE ─────────────────────────────────────────────────────────────────

router.get('/profile', async (req, res, next) => {
  try {
    res.json(await getProfile(req.user.id));
  } catch (err) {
    next(err);
  }
});

const YEARS = ['1st', '2nd', '3rd', '4th', '5th', 'Working Professional'];
const EXPERIENCE = ['beginner', 'intermediate', 'advanced'];
const FORMATS = ['online', 'offline', 'both'];
const TEAMS = ['solo', 'team', 'either'];

router.put('/profile', async (req, res, next) => {
  try {
    const b = req.body || {};
    const set = {};

    const str = (key, max = 120) => {
      if (b[key] === undefined) return;
      if (b[key] === null || b[key] === '') return void (set[key] = null);
      if (typeof b[key] !== 'string') throw new AppError(`${key} must be a string`, 400, 'BAD_REQUEST');
      set[key] = b[key].trim().slice(0, max);
    };
    const oneOf = (key, allowed) => {
      if (b[key] === undefined) return;
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
      // Cap the list so a client cannot store unbounded text on the profile.
      set.interests = [...new Set(b.interests.map((i) => i.trim()).filter(Boolean))].slice(0, 20);
    }
    if (b.onboarding_complete !== undefined) {
      set.onboarding_complete = Boolean(b.onboarding_complete);
    }

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .upsert({ id: req.user.id, ...set, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      .select()
      .single();

    if (error) throw dbError(error);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ─── SAVED HACKATHONS ────────────────────────────────────────────────────────

/** Flattens the join and drops rows whose hackathon was deleted underneath us. */
function flattenSaved(rows) {
  return (rows || [])
    .filter((r) => r.hackathons)
    .map(({ hackathons, status, saved_at }) => ({ ...hackathons, status, saved_at }));
}

router.get('/saved', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('saved_hackathons')
      .select('status, saved_at, hackathons(*)')
      .eq('user_id', req.user.id)
      .order('saved_at', { ascending: false });

    if (error) throw dbError(error);
    res.json(flattenSaved(data));
  } catch (err) {
    next(err);
  }
});

router.post('/saved/:hackathon_id', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('saved_hackathons')
      .upsert(
        { user_id: req.user.id, hackathon_id: hackathonId(req), status: 'saved' },
        { onConflict: 'user_id,hackathon_id' }
      )
      .select()
      .single();

    if (isMissingHackathon(error)) throw new AppError('Hackathon not found', 404, 'NOT_FOUND');
    if (error) throw dbError(error);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.delete('/saved/:hackathon_id', async (req, res, next) => {
  try {
    const id = hackathonId(req);

    // Calendar entries hang off the saved row conceptually; remove both.
    const { error: calError } = await supabaseAdmin
      .from('calendar_events')
      .delete()
      .eq('user_id', req.user.id)
      .eq('hackathon_id', id);
    if (calError) throw dbError(calError);

    const { data, error } = await supabaseAdmin
      .from('saved_hackathons')
      .delete()
      .eq('user_id', req.user.id)
      .eq('hackathon_id', id)
      .select('id');

    if (error) throw dbError(error);
    // Same 404 whether the row never existed or belongs to someone else, so
    // this cannot be used to probe for other users' rows.
    if (!data?.length) throw new AppError('Not in your saved list', 404, 'NOT_FOUND');
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

const STATUSES = ['saved', 'applied', 'submitted'];

router.patch('/saved/:hackathon_id/status', async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!STATUSES.includes(status)) {
      throw new AppError(`status must be one of: ${STATUSES.join(', ')}`, 400, 'BAD_REQUEST');
    }

    const { data, error } = await supabaseAdmin
      .from('saved_hackathons')
      .update({ status })
      .eq('user_id', req.user.id)
      .eq('hackathon_id', hackathonId(req))
      .select()
      .maybeSingle();

    if (error) throw dbError(error);
    if (!data) throw new AppError('Not in your saved list', 404, 'NOT_FOUND');
    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * Deletes the caller's own account. Only ever the caller's: the id comes from
 * the verified token, never from the request. profiles, saved_hackathons and
 * calendar_events all cascade from auth.users, so this is the whole cleanup.
 */
router.delete('/account', async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(req.user.id);
    if (error) throw new AppError('Could not delete the account', 500, 'DELETE_FAILED');
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

// ─── RECOMMENDATIONS ─────────────────────────────────────────────────────────

const daysUntil = (date) =>
  date ? Math.ceil((new Date(date).getTime() - Date.now()) / 86400000) : null;

/**
 * Hackathons whose domains overlap the user's interests, soonest deadline
 * first, honouring their format preference. Runs entirely in Postgres against
 * the GIN index on `domains`.
 */
router.get('/recommendations', async (req, res, next) => {
  try {
    const profile = await getProfile(req.user.id);
    const interests = profile.interests || [];
    const format = profile.format_pref;
    const limit = Math.min(parseInt(req.query.limit) || 5, 20);

    const build = (withInterests) => {
      let q = openHackathons();
      const wanted = sanitizeDomains(interests);
      if (withInterests && wanted.length) q = q.overlaps('domains', wanted);
      // Hybrid runs online too, so it belongs in both preferences.
      if (format === 'online') q = q.in('hackathon_type', ['online', 'hybrid']);
      else if (format === 'offline') q = q.in('hackathon_type', ['offline', 'hybrid']);
      return q.order('registration_deadline', { ascending: true }).limit(limit);
    };

    let { data, error } = await build(true);
    if (error) throw dbError(error);
    // Nothing matched their domains — show what closes soonest rather than nothing.
    if (!data?.length) ({ data, error } = await build(false));
    if (error) throw dbError(error);

    const recommendations = (data || []).map((h, i) => {
      const shared = (h.domains || []).filter((d) =>
        interests.some((x) => x.toLowerCase() === String(d).toLowerCase())
      );
      const days = daysUntil(h.registration_deadline);
      const reason = shared.length
        ? `Matches your interest in ${shared.slice(0, 2).join(' and ')}${days !== null ? `, closing in ${days} day${days === 1 ? '' : 's'}` : ''}.`
        : 'Closing soonest in your preferred format.';
      return { rank: i + 1, hackathon: h, reason };
    });

    res.json({ recommendations, matched_on_interests: interests.length > 0 });
  } catch (err) {
    next(err);
  }
});

// ─── CALENDAR ────────────────────────────────────────────────────────────────

const EVENT_COLORS = {
  registration_deadline: 'amber',
  submission_deadline: 'danger',
  start: 'success',
  end: 'muted',
};

router.get('/calendar', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('calendar_events')
      .select('added_at, hackathons(*)')
      .eq('user_id', req.user.id)
      .order('added_at', { ascending: false });

    if (error) throw dbError(error);

    const hackathons = (data || []).map((r) => r.hackathons).filter(Boolean);
    const events = [];

    for (const h of hackathons) {
      const base = { hackathon_id: h.id, hackathon_title: h.title, banner_url: h.banner_url };
      const add = (type, date) =>
        date && events.push({ type, date, ...base, color: EVENT_COLORS[type] });

      add('registration_deadline', h.registration_deadline);
      add('start', h.start_date);
      add('submission_deadline', h.submission_deadline);
      add('end', h.end_date);
    }

    // Stable sort (guaranteed since ES2019): events sharing a timestamp keep
    // their push order. Within one hackathon that is registration → start →
    // submission → end; across hackathons it is calendar-insert order.
    events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    res.json({ events, hackathons });
  } catch (err) {
    next(err);
  }
});

router.post('/calendar/:hackathon_id', async (req, res, next) => {
  try {
    const id = hackathonId(req);

    // Tracking a deadline implies saving it.
    const { error: saveError } = await supabaseAdmin
      .from('saved_hackathons')
      .upsert(
        { user_id: req.user.id, hackathon_id: id, status: 'saved' },
        { onConflict: 'user_id,hackathon_id', ignoreDuplicates: true }
      );
    if (isMissingHackathon(saveError)) throw new AppError('Hackathon not found', 404, 'NOT_FOUND');
    if (saveError) throw dbError(saveError);

    const { data, error } = await supabaseAdmin
      .from('calendar_events')
      .upsert({ user_id: req.user.id, hackathon_id: id }, { onConflict: 'user_id,hackathon_id' })
      .select()
      .single();

    if (error) throw dbError(error);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.delete('/calendar/:hackathon_id', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('calendar_events')
      .delete()
      .eq('user_id', req.user.id)
      .eq('hackathon_id', hackathonId(req))
      .select('id');

    if (error) throw dbError(error);
    if (!data?.length) throw new AppError('Not in your calendar', 404, 'NOT_FOUND');
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

export default router;
