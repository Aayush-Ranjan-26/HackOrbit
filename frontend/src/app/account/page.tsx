'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@/lib/hooks';
import { deleteAccount } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/Toast';
import styles from './account.module.css';

export default function AccountPage() {
  const router = useRouter();
  const { user, loading: authLoading, signOut } = useUser();
  const { showToast, toastElement } = useToast();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState<'password' | 'resend' | 'signout' | 'delete' | null>(null);
  const [confirmEmail, setConfirmEmail] = useState('');

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
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

  const resendConfirmation = async () => {
    if (!supabase || !user?.email) return;
    setBusy('resend');
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: user.email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(null);
    showToast(
      error ? 'Could not send it right now — try again in a minute.' : 'Confirmation email sent.',
      error ? 'error' : 'success'
    );
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
    } catch {
      showToast('Could not delete the account. Try again.', 'error');
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

  const unconfirmed = !user.email_confirmed_at;

  return (
    <div className="page">
      <div className="container-narrow">
        <h1 className="pageTitle">Your account</h1>
        <p className="pageSub">{user.email}</p>

        {unconfirmed && (
          <section className={`card ${styles.section}`}>
            <h2>Confirm your email</h2>
            <p>Your address is not confirmed yet. Some features stay locked until it is.</p>
            <button className="btn btnGhost" onClick={resendConfirmation} disabled={busy === 'resend'}>
              {busy === 'resend' ? 'Sending…' : 'Resend confirmation email'}
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
            <button type="submit" className="btn btnPrimary" disabled={busy === 'password'}>
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
