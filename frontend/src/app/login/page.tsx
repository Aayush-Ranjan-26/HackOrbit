'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { sameSitePath } from '@/lib/url';
import styles from './login.module.css';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<'login' | 'signup'>(params.get('tab') === 'signup' ? 'signup' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  // Sign-in failed because the address was never confirmed. The resend button
  // on /account is unreachable for these users: confirmation is required to
  // sign in, so they can never get there.
  const [unconfirmed, setUnconfirmed] = useState(false);

  // /auth/callback redirects here with ?error= when a link is expired or reused.
  const callbackError = params.get('error');
  const justReset = params.get('reset') === '1';
  const justDeleted = params.get('deleted') === '1';

  // New accounts land on onboarding; returning ones go where they were headed.
  // Only same-site absolute paths. A bare value would let ?next=https://evil/
  // (or the protocol-relative //evil) hard-navigate off-site straight after a
  // real sign-in — a phishing launchpad on a trusted origin.
  // router.replace() hard-navigates to a foreign origin, so this is resolved
  // against our own origin rather than pattern-matched — a prefix test is
  // defeated by `/\evil.example` and by tab/newline, which the URL parser
  // normalises into a protocol-relative URL.
  const requested = params.get('next');
  const next =
    (typeof window === 'undefined' ? null : sameSitePath(requested, window.location.origin)) ??
    '/explore';

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace(next);
    });
  }, [router, next]);

  // The button appears only once Google is actually configured in Supabase.
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;

    let cancelled = false;
    fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
      .then((r) => r.json())
      .then((s) => !cancelled && setGoogleEnabled(Boolean(s?.external?.google)))
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setError(null);
    setMessage(null);
    setUnconfirmed(false);
    setLoading(true);

    try {
      if (tab === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next);
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;
        // With email confirmation off, Supabase returns a session immediately.
        if (data.session) router.replace('/onboarding');
        else {
          setMessage('Check your email to confirm your account, then sign in.');
          setTab('login');
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      setError(message);
      setUnconfirmed(/not confirmed/i.test(message));
    } finally {
      setLoading(false);
    }
  };

  const resendConfirmation = async () => {
    if (!supabase) return;
    setError(null);
    setUnconfirmed(false);
    setLoading(true);
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setLoading(false);
    // Same single message either way: the address is already known to exist
    // here (sign-in told us so), but the send quota must not become a signal.
    if (error) console.error('Resend confirmation failed:', error.message);
    setMessage('If that address still needs confirming, a new link is on its way.');
  };

  const forgotPassword = async () => {
    if (!supabase) return;
    setError(null);
    setMessage(null);

    if (!email.trim()) return setError('Enter your email address first, then choose Forgot password.');

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
    });
    setLoading(false);

    /*
     * One message, always — including on rate-limit errors. Supabase only
     * attempts a send for addresses that exist, so it returns success for an
     * unknown address while a real one can hit the quota. Reporting that
     * difference turned this form into the exact enumeration oracle it was
     * written to avoid.
     */
    if (error) console.error('Password reset request failed:', error.message);
    setMessage('If that address has an account, a reset link is on its way.');
  };

  const google = async () => {
    if (!supabase) return;
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) setError(error.message);
  };

  if (!isSupabaseConfigured) {
    return (
      <div className={styles.wrap}>
        <div className={`card ${styles.card}`}>
          <h1 className={styles.title}>Sign-in is not configured</h1>
          <p className={styles.sub}>
            Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to
            <code> frontend/.env.local</code>, then restart the dev server. Browsing works without them.
          </p>
          <Link href="/explore" className="btn btnGhost">Browse hackathons</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={`card ${styles.card}`}>
        <h1 className={styles.title}>
          {tab === 'login' ? 'Welcome back' : 'Create your account'}
        </h1>
        <p className={styles.sub}>
          {tab === 'login'
            ? 'Pick up your saved hackathons and deadlines.'
            : 'Save hackathons, track deadlines, get matched picks.'}
        </p>

        <div className={styles.tabs} role="group" aria-label="Sign in or sign up">
          {(['login', 'signup'] as const).map((t) => (
            <button
              key={t}
              aria-pressed={tab === t}
              className={tab === t ? styles.tabActive : styles.tab}
              onClick={() => { setTab(t); setError(null); setMessage(null); }}
            >
              {t === 'login' ? 'Sign in' : 'Sign up'}
            </button>
          ))}
        </div>

        {googleEnabled && (
        <button className={styles.oauth} onClick={google} type="button">
          <svg height="18" width="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
          Continue with Google
        </button>
        )}

        {googleEnabled && <div className={styles.divider}><span>or</span></div>}

        {callbackError && !error && (
          <div className="errorBox" role="alert">{callbackError}</div>
        )}
        {justReset && !message && (
          <div className={styles.notice} role="status">
            Password updated. Sign in with your new one.
          </div>
        )}
        {justDeleted && !message && (
          <div className={styles.notice} role="status">
            Your account and everything in it has been deleted.
          </div>
        )}
        {error && <div className="errorBox" role="alert">{error}</div>}
        {unconfirmed && (
          <button type="button" className={styles.forgot} onClick={resendConfirmation} disabled={loading}>
            Resend the confirmation email
          </button>
        )}
        {message && <div className={styles.notice} role="status">{message}</div>}

        <form onSubmit={submit} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
            />
          </div>

          <div className={styles.field}>
            <div className={styles.labelRow}>
              <label htmlFor="password">Password</label>
              {tab === 'login' && (
                <button type="button" className={styles.forgot} onClick={forgotPassword}>
                  Forgot password?
                </button>
              )}
            </div>
            <div className={styles.passwordWrap}>
              <input
                id="password"
                className="input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={tab === 'signup' ? 8 : 6}
                autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                placeholder={tab === 'signup' ? 'At least 8 characters' : 'Your password'}
              />
              <button
                type="button"
                className={styles.reveal}
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <button type="submit" className="btn btnPrimary" disabled={loading}>
            {loading ? 'Please wait…' : tab === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <Link href="/" className={styles.back}>← Back to home</Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className={styles.wrap}>Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
