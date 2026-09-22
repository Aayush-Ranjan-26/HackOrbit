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

export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}
