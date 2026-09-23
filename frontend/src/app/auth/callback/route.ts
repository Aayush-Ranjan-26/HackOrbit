import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { sameSitePath } from '@/lib/url';

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

  // This value ends up in a Location header, so it must be resolved, not matched.
  const next = sameSitePath(url.searchParams.get('next'), url.origin);

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(reason)}`, url.origin));

  /*
   * Supabase reports a dead link as ?error=access_denied&error_code=otp_expired
   * with no ?code= at all. Reading only `code` sent those users to /onboarding
   * with a bare "Sign in first" and threw the reason away.
   */
  const error = url.searchParams.get('error_description') || url.searchParams.get('error');
  if (error) return fail(error);

  /*
   * No code and no error means the tokens were in the URL *fragment* (an
   * implicit-flow link), and a fragment is never sent to the server. This used
   * to forward to the destination page so the browser client could pick them
   * up — but @supabase/ssr's createBrowserClient hardcodes `flowType: 'pkce'`
   * after spreading caller options, and auth-js throws "Not a valid PKCE flow
   * url." on an implicit callback, so nothing ever consumed them. The user
   * landed signed-out with no explanation. Say so instead.
   */
  if (!code) {
    return fail(
      'That sign-in link could not be read. Request a new one — links must be ' +
        'opened in the browser that asked for them.'
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return fail('Sign-in is not configured on this server.');

  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, anonKey, {
    // Matches the browser client. Without Secure, the ~400-day refresh token
    // travels over any plaintext request to the same host in production.
    cookieOptions: { secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
    },
  });

  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    // Also fires when the link is opened in a different browser from the one
    // that requested it: the PKCE verifier lives in that first browser's cookie.
    return fail(
      'That link did not work. It may have expired, been used already, or been ' +
        'opened in a different browser than the one you requested it from.'
    );
  }

  // A recovery link must land on the page that sets a new password, never on
  // the app. The marker is what /auth/reset gates on: a plain session is not
  // proof of recovery, since every signed-in user has one.
  //
  // ponytail: the exchange above unavoidably mints a real session — Supabase's
  // recovery token *is* the session, and updateUser() needs it — so whoever
  // holds the email can reach the app without changing the password. Closing
  // that needs a server-side reset endpoint using the service-role key.
  if (type === 'recovery') {
    const response = NextResponse.redirect(new URL('/auth/reset', url.origin));
    response.cookies.set('hackorbit-recovery', '1', {
      httpOnly: false, // the reset page is a client component and reads it
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 900,
    });
    return response;
  }

  /*
   * The brand-new-user check has to come before `next`, or it never runs: the
   * OAuth button always sets `next`, so a first-time Google user went straight
   * to /explore with an empty profile and nothing ever sent them to onboarding.
   */
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

  if (next) return NextResponse.redirect(new URL(next, url.origin));

  return NextResponse.redirect(new URL('/explore', url.origin));
}
