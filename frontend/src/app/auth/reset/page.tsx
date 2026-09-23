'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import styles from '../../login/login.module.css';

/**
 * Reached only via a recovery link, which /auth/callback has already exchanged
 * for a session. Without that session there is nothing to update, so the page
 * says so rather than showing a form that cannot work.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState<'checking' | 'ok' | 'no-session'>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return setReady('no-session');
    supabase.auth.getSession().then(({ data }) => setReady(data.session ? 'ok' : 'no-session'));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setError(null);

    if (password !== confirm) return setError('Those two passwords do not match.');
    if (password.length < 8) return setError('Use at least 8 characters.');

    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      // Anyone holding an old session — including whoever forced the reset —
      // is signed out. The user re-authenticates with the new password.
      await supabase.auth.signOut({ scope: 'global' });
      router.replace('/login?reset=1');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update your password.');
      setSaving(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={`card ${styles.card}`}>
        <h1 className={styles.title}>Choose a new password</h1>

        {ready === 'checking' && <div className="skeleton" style={{ height: 140 }} />}

        {ready === 'no-session' && (
          <>
            <p className={styles.sub}>
              This page only works from a password reset link, and that link has
              expired or was already used.
            </p>
            <Link href="/login" className="btn btnPrimary">Request a new link</Link>
          </>
        )}

        {ready === 'ok' && (
          <>
            <p className={styles.sub}>
              Pick something you do not use elsewhere. You will be signed out everywhere
              once it is saved.
            </p>

            {error && <div className="errorBox" role="alert">{error}</div>}

            <form onSubmit={submit} className={styles.form}>
              <div className={styles.field}>
                <label htmlFor="password">New password</label>
                <div className={styles.passwordWrap}>
                  <input
                    id="password"
                    className="input"
                    type={show ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                  />
                  <button
                    type="button"
                    className={styles.reveal}
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? 'Hide password' : 'Show password'}
                  >
                    {show ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <div className={styles.field}>
                <label htmlFor="confirm">Confirm new password</label>
                <input
                  id="confirm"
                  className="input"
                  type={show ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>

              <button type="submit" className="btn btnPrimary" disabled={saving}>
                {saving ? 'Saving…' : 'Save new password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
