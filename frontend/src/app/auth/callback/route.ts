import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

/**
 * Every link Supabase emails — confirm signup, password recovery — and every
 * OAuth return lands here carrying a one-time `?code=`. Exchanging it for a
 * session is what actually signs the user in.
 *
 * The browser client would eventually pick the code up via detectSessionInUrl,
 * but only on whatever page it happened to land on, with the code sitting in
 * the address bar and no chance to route a brand new user to onboarding.
 * Doing it here is explicit and leaves a clean URL.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const type = url.searchParams.get('type');

  // Only same-site paths: this value ends up in a redirect.
  const requested = url.searchParams.get('next');
  const next = requested && /^\/(?!\/)/.test(requested) ? requested : null;

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(reason)}`, url.origin));

  if (!code) return fail('That link is missing its code. Request a new one.');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return fail('Sign-in is not configured on this server.');

  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
    },
  });

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // Expired, already used, or opened in a different browser than it started in.
    return fail('That link has expired or was already used. Request a new one.');
  }

  // A recovery link must land on the page that sets a new password, never on
  // the app — otherwise the user is silently signed in and never changes it.
  if (type === 'recovery') {
    return NextResponse.redirect(new URL('/auth/reset', url.origin));
  }

  if (next) return NextResponse.redirect(new URL(next, url.origin));

  // A profile with no interests has not been through onboarding yet.
  const userId = data.user?.id;
  if (userId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('interests')
      .eq('id', userId)
      .maybeSingle();

    if (!profile?.interests?.length) {
      return NextResponse.redirect(new URL('/onboarding', url.origin));
    }
  }

  return NextResponse.redirect(new URL('/explore', url.origin));
}
