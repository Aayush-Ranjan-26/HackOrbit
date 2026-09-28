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

/** How recent a sign-in the irreversible actions demand. */
export const REAUTH_WINDOW_SECONDS = 10 * 60;

/**
 * Seconds since the caller actually signed in — typed a password, completed
 * OAuth, followed a recovery link.
 *
 * Read from the token's `amr` claim, NOT `iat`: a refresh mints a new token with
 * a fresh `iat` every hour, so a stolen session that keeps refreshing always
 * looks recent. `amr` records the sign-in itself and survives refreshes.
 *
 * Only call this on a token that requireAuth has already verified with
 * getUser() — it decodes the claims, it does not check the signature. A token
 * with no usable `amr` counts as infinitely old, so the check fails closed.
 */
export function secondsSinceSignIn(token, nowSeconds = Math.floor(Date.now() / 1000)) {
  try {
    const claims = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString());
    const signedInAt = Math.max(0, ...(claims.amr || []).map((a) => Number(a?.timestamp) || 0));
    return signedInAt > 0 ? nowSeconds - signedInAt : Infinity;
  } catch {
    return Infinity;
  }
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

