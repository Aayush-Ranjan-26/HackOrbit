'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLibrary, useUser } from '@/lib/hooks';
import { fetchProfile, fetchRecommendations, isAuthError, type Hackathon } from '@/lib/api';
import HackathonCard from '@/components/HackathonCard';
import { useToast } from '@/components/Toast';
import styles from './for-you.module.css';

type Pick = { hackathon: Hackathon; reason: string };

export default function ForYouPage() {
  const { user, loading: authLoading } = useUser();
  const { savedIds, calendarIds, save, addEvent } = useLibrary();
  const { showToast, toastElement } = useToast();

  const [picks, setPicks] = useState<Pick[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'no-profile' | 'error'>('loading');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      try {
        const profile = await fetchProfile();
        if (cancelled) return;
        if (!profile.interests?.length) return setState('no-profile');

        const res = await fetchRecommendations();
        if (cancelled) return;
        setPicks(res.recommendations);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();

    return () => { cancelled = true; };
  }, [user]);

  const act = async (h: Hackathon, fn: () => Promise<void>, ok: string) => {
    setBusyId(h.id);
    try {
      await fn();
      showToast(ok);
    } catch (err) {
      showToast(isAuthError(err) ? 'Your session expired — sign in again' : 'That did not work.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  // Auth resolves after hydration; showing the page first would flash the
  // wrong content at signed-out visitors on these prerendered routes.
  if (authLoading) {
    return (
      <div className="page">
        <div className="container-narrow">
          <div className="skeleton" style={{ height: 320 }} />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page">
        <div className="container-narrow emptyState">
          <div className="emptyIcon" aria-hidden="true">◎</div>
          <h1 className="pageTitle">Matched to you</h1>
          <p>Sign in and tell us what you build to get hackathons matched to your interests.</p>
          <Link href="/login?next=/for-you" className="btn btnPrimary">Sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container-narrow">
        <h1 className="pageTitle">Matched to you</h1>
        <p className="pageSub">
          Open hackathons whose domains overlap your interests, soonest deadline first.
        </p>

        {state === 'no-profile' && (
          <div className={`card ${styles.notice}`}>
            <p>Tell us which domains you build in and this fills up.</p>
            <Link href="/onboarding" className="btn btnPrimary">Set up your profile</Link>
          </div>
        )}

        {state === 'error' && (
          <div className="emptyState">
            <div className="emptyIcon" aria-hidden="true">📡</div>
            <p>Could not load your matches right now.</p>
          </div>
        )}

        {state === 'loading' && (
          <div className={styles.list} aria-hidden="true">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="skeleton" style={{ height: 190 }} />
            ))}
          </div>
        )}

        {state === 'ready' && picks.length === 0 && (
          <div className="emptyState">
            <div className="emptyIcon" aria-hidden="true">◎</div>
            <p>Nothing matches yet. Try widening your interests.</p>
            <Link href="/onboarding" className="btn btnGhost">Edit profile</Link>
          </div>
        )}

        {state === 'ready' && picks.length > 0 && (
          <div className={styles.list}>
            {picks.map(({ hackathon, reason }) => (
              <HackathonCard
                key={hackathon.id}
                hackathon={hackathon}
                note={reason}
                saved={savedIds.has(hackathon.id)}
                inCalendar={calendarIds.has(hackathon.id)}
                busy={busyId === hackathon.id}
                onSave={() => act(hackathon, () => save(hackathon.id), 'Saved')}
                onCalendar={() => act(hackathon, () => addEvent(hackathon.id), 'Added to your calendar')}
              />
            ))}
          </div>
        )}
      </div>
      {toastElement}
    </div>
  );
}
