import { createBrowserClient } from '@supabase/ssr';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** False when env vars are missing — the app still renders, auth just stays off. */
export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured && typeof window !== 'undefined') {
  console.warn(
    'Supabase env vars missing. Copy frontend/.env.local.example to .env.local — ' +
      'browsing works without them, sign-in does not.'
  );
}

// Throwing at module load took the whole app down, including the public pages
// that never touch auth. A null client fails only where it is actually used.
export const supabase = isSupabaseConfigured
  ? createBrowserClient(url!, anonKey!, {
      // The session cookie holds a long-lived refresh token. httpOnly is not
      // possible (the browser client must read it), but Secure is.
      cookieOptions: { secure: process.env.NODE_ENV === 'production' },
    })
  : null;

/** How recent a sign-in changing a password or deleting the account needs. */
export const REAUTH_WINDOW_SECONDS = 10 * 60;

/**
 * Seconds since this session's user actually signed in — typed a password,
 * finished OAuth, or followed a recovery link. Infinity with no session.
 *
 * Read from the token's `amr` claim, not `iat`: a refresh issues a new token
 * with a fresh `iat` every hour, so a stolen session that keeps refreshing
 * would always look recent. `amr` records the sign-in and survives refreshes.
 *
 * This gates the UI only. The API enforces the same rule for account deletion;
 * password changes go straight to Supabase, where only the dashboard's "Secure
 * password change" setting can enforce it server-side.
 */
export async function secondsSinceSignIn(): Promise<number> {
  const token = await getAccessToken();
  if (!token) return Infinity;
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(b64));
    const at = Math.max(0, ...(claims.amr ?? []).map((a: { timestamp?: number }) => Number(a?.timestamp) || 0));
    return at > 0 ? Math.floor(Date.now() / 1000) - at : Infinity;
  } catch {
    return Infinity;
  }
}

export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}
