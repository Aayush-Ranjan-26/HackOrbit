import { supabaseAdmin } from '../lib/supabase.js';

/**
 * Reads `Authorization: Bearer <jwt>` and resolves it to a Supabase user.
 * Returns null for a missing or invalid token — callers decide what that means.
 */
async function resolveUser(req) {
  const header = req.headers.authorization || '';
  // The scheme is case-insensitive per RFC 7235; `bearer <jwt>` was a 401.
  const token = /^bearer /i.test(header) ? header.slice(7).trim() : null;
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;

  req.token = token;
  return data.user;
}

/** 401s anonymous callers. Use on anything that reads or writes user-owned rows. */
export async function requireAuth(req, res, next) {
  try {
    const user = await resolveUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Sign in to continue', code: 'UNAUTHENTICATED' });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

