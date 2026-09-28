'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@/lib/hooks';
import { ApiError, deleteAccount } from '@/lib/api';
import { REAUTH_WINDOW_SECONDS, secondsSinceSignIn, supabase } from '@/lib/supabase';
import { useToast } from '@/components/Toast';
import styles from './account.module.css';

export default function AccountPage() {
  const router = useRouter();
  const { user, loading: authLoading, signOut } = useUser();
  const { showToast, toastElement } = useToast();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState<'password' | 'signout' | 'delete' | null>(null);
  const [confirmEmail, setConfirmEmail] = useState('');

  /*
   * Changing the password and deleting the account both need a sign-in from
   * the last ten minutes. Without it, anyone holding a session — a shared
   * computer, a stolen token — could set a new password, which Supabase
   * answers by signing the owner out everywhere, or delete the account with
   * one click. The API enforces this for deletion; for the password it is
   * enforced here, and server-side only by Supabase's "Secure password
   * change" setting, since that request never touches our API.
   */
  const [recentSignIn, setRecentSignIn] = useState<boolean | null>(null);
  useEffect(() => {
    if (!user) return;
    secondsSinceSignIn().then((age) => setRecentSignIn(age <= REAUTH_WINDOW_SECONDS));
  }, [user]);

  // Sign out here only, then come back: a fresh sign-in resets the clock.
  const reauthenticate = async () => {
    await signOut();
    router.replace('/login?next=/account');
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    // Re-check at submit: the page may have sat open past the window.
    if ((await secondsSinceSignIn()) > REAUTH_WINDOW_SECONDS) {
      setRecentSignIn(false);
      return showToast('Sign in again to change your password.', 'error');
    }
    if (password !== confirm) return showToast('Those two passwords do not match.', 'error');
    if (password.length < 8) return showToast('Use at least 8 characters.', 'error');

    setBusy('password');
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword('');
      setConfirm('');
      showToast('Password updated. Other devices have been signed out.');
      // Anyone who had a session from the old password loses it.
      await supabase.auth.signOut({ scope: 'others' });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update your password.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const signOutEverywhere = async () => {
    if (!supabase) return;
    setBusy('signout');
    await supabase.auth.signOut({ scope: 'global' });
    router.replace('/login');
  };

  const removeAccount = async () => {
    setBusy('delete');
    try {
      await deleteAccount();
      await signOut();
      router.replace('/login?deleted=1');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REAUTH_REQUIRED') {
        setRecentSignIn(false);
        showToast('Sign in again to delete your account.', 'error');
      } else {
        showToast('Could not delete the account. Try again.', 'error');
      }
      setBusy(null);
    }
  };

  if (authLoading) {
    return (
      <div className="page">
        <div className="container-narrow"><div className="skeleton" style={{ height: 320 }} /></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page">
        <div className="container-narrow emptyState">
          <h1 className="pageTitle">Your account</h1>
          <p>Sign in to manage your account.</p>
          <Link href="/login?next=/account" className="btn btnPrimary">Sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container-narrow">
        <h1 className="pageTitle">Your account</h1>
        <p className="pageSub">{user.email}</p>

        {recentSignIn === false && (
          <section className={`card ${styles.section}`} role="status">
            <h2>Confirm it&apos;s you</h2>
            <p>
              Changing your password or deleting your account needs a sign-in from the
              last ten minutes.
            </p>
            <button className="btn btnPrimary" onClick={reauthenticate}>
              Sign in again
            </button>
          </section>
        )}

        <section className={`card ${styles.section}`}>
          <h2>Change password</h2>
          <form onSubmit={changePassword} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="new-password">New password</label>
              <input
                id="new-password"
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
                autoComplete="new-password"
                placeholder="At least 8 characters"
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="confirm-password">Confirm new password</label>
              <input
                id="confirm-password"
                className="input"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={8}
                required
                autoComplete="new-password"
              />
            </div>
            <button type="submit" className="btn btnPrimary" disabled={busy === 'password' || !recentSignIn}>
              {busy === 'password' ? 'Saving…' : 'Update password'}
            </button>
          </form>
        </section>

        <section className={`card ${styles.section}`}>
          <h2>Sessions</h2>
          <p>Signs you out on every device, including this one.</p>
          <button className="btn" onClick={signOutEverywhere} disabled={busy === 'signout'}>
            {busy === 'signout' ? 'Signing out…' : 'Sign out everywhere'}
          </button>
        </section>

        <section className={`card ${styles.section} ${styles.danger}`}>
          <h2>Delete account</h2>
          <p>
            Permanently removes your profile, saved hackathons and calendar. This cannot
            be undone. Type <strong>{user.email}</strong> to confirm.
          </p>
          <div className={styles.field}>
            <label htmlFor="confirm-email" className="srOnly">Type your email to confirm</label>
            <input
              id="confirm-email"
              className="input"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              placeholder={user.email}
              autoComplete="off"
            />
          </div>
          <button
            className={`btn ${styles.deleteBtn}`}
            onClick={removeAccount}
            // Case-insensitive: Supabase does not lowercase stored emails, and autofill
            // or a phone keyboard will happily capitalise. A mismatch can only block
            // the delete, never permit one — the server scopes it to the caller's token.
            disabled={
              busy === 'delete' ||
              !recentSignIn ||
              confirmEmail.trim().toLowerCase() !== (user.email ?? '').toLowerCase()
            }
          >
            {busy === 'delete' ? 'Deleting…' : 'Delete my account'}
          </button>
        </section>
      </div>
      {toastElement}
    </div>
  );
}
