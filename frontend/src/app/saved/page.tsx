'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useLibrary, useUser } from '@/lib/hooks';
import type { SavedStatus } from '@/lib/api';
import HackathonCard, { nextStatus } from '@/components/HackathonCard';
import { useToast } from '@/components/Toast';
import styles from './saved.module.css';

const TABS: ('all' | SavedStatus)[] = ['all', 'saved', 'applied', 'submitted'];
const TRACKER_TIPS = [
  { title: 'Save what matters', body: 'Keep promising hackathons in one focused list.', marker: '01' },
  { title: 'Track your progress', body: 'Move entries from saved to applied to submitted.', marker: '02' },
  { title: 'Never miss a deadline', body: 'Add a hackathon to your calendar for every key date.', marker: '03' },
];

export default function SavedPage() {
  const { user, loading: authLoading } = useUser();
  const { saved, calendarIds, loading, error, unsave, setStatus, addEvent } = useLibrary();
  const { showToast, toastElement } = useToast();
  const [tab, setTab] = useState<'all' | SavedStatus>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  const visible = tab === 'all' ? saved : saved.filter((h) => h.status === tab);
  const countFor = (t: 'all' | SavedStatus) =>
    t === 'all' ? saved.length : saved.filter((h) => h.status === t).length;

  const run = async (id: string, fn: () => Promise<void>, ok: string) => {
    setBusyId(id);
    try {
      await fn();
      showToast(ok);
    } catch {
      showToast('That did not work. Try again.', 'error');
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
          <h1 className="pageTitle">Your saved hackathons</h1>
          <p>Sign in to save hackathons and track them from applied to submitted.</p>
          <Link href="/login?next=/saved" className="btn btnPrimary">Sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`page ${styles.page}`}>
      <div className={`container-narrow ${styles.container}`}>
        <div className={styles.header}>
          <span className={styles.kicker}>ORBITAL TRACKER V2.4</span>
          <h1 className={`pageTitle ${styles.title}`}>Saved hackathons</h1>
          <p className={`pageSub ${styles.subtitle}`}>
          {saved.length} tracked · move each one along as you apply and submit
          </p>
        </div>

        {error && <div className="errorBox" style={{ marginBottom: '1.5rem' }}>{error}</div>}

        <div className={styles.tabs} role="group" aria-label="Filter by status">
          {TABS.map((t) => (
            <button
              key={t}
              aria-pressed={tab === t}
              className={tab === t ? styles.tabActive : styles.tab}
              onClick={() => setTab(t)}
            >
              {t === 'all' ? 'All' : t[0].toUpperCase() + t.slice(1)} ({countFor(t)})
            </button>
          ))}
        </div>

        {loading && saved.length === 0 && (
          <div className={styles.list} aria-hidden="true">
            {Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton" style={{ height: 170 }} />)}
          </div>
        )}

        {!loading && !error && visible.length === 0 && (
          <div className={`card ${styles.emptyCard}`}>
            <div className={styles.bookmarkMedallion} aria-hidden="true">
              <span className={styles.bookmarkIcon} />
            </div>
            <h2>{tab === 'all' ? 'Nothing saved yet.' : `Nothing marked ${tab} yet.`}</h2>
            <p>Start building your tracker with the hackathons you want to pursue.</p>
            <Link href="/explore" className="btn btnPrimary">Browse hackathons</Link>
            <div className={styles.tips} aria-label="Tracker tips">
              {TRACKER_TIPS.map((tip) => (
                <article key={tip.marker} className={styles.tip}>
                  <span className={styles.tipMarker} aria-hidden="true">{tip.marker}</span>
                  <h3>{tip.title}</h3>
                  <p>{tip.body}</p>
                </article>
              ))}
            </div>
          </div>
        )}

        {visible.length > 0 && (
          <div className={styles.list}>
            {visible.map((h) => {
              const advance = nextStatus(h.status);
              return (
                <HackathonCard
                  key={h.id}
                  hackathon={h}
                  status={h.status}
                  saved
                  inCalendar={calendarIds.has(h.id)}
                  busy={busyId === h.id}
                  onCalendar={() => run(h.id, () => addEvent(h.id), 'Added to your calendar')}
                  onAdvance={
                    advance ? () => run(h.id, () => setStatus(h.id, advance), `Marked ${advance}`) : undefined
                  }
                  onRemove={() => run(h.id, () => unsave(h.id), 'Removed')}
                />
              );
            })}
          </div>
        )}
      </div>
      {toastElement}
    </div>
  );
}
