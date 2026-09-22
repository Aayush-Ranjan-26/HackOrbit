'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { useHackathon, useLibrary, useUser } from '@/lib/hooks';
import { isAuthError } from '@/lib/api';
import {
  daysUntil, deadlineColor, deadlineLabel, formatDate, formatPrize, formatType,
  sourceColor, sourceLabel, stripHTML,
} from '@/lib/format';
import { useToast } from '@/components/Toast';
import styles from './hackathon.module.css';

function Fact({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd style={accent ? { color: accent } : undefined}>{value}</dd>
    </div>
  );
}

export default function HackathonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // params is a promise in Next 16; use() unwraps it in a client component.
  const { id } = use(params);
  const { data: h, loading, error } = useHackathon(id);
  const { user } = useUser();
  const { savedIds, calendarIds, save, addEvent } = useLibrary();
  const { showToast, toastElement } = useToast();
  const [busy, setBusy] = useState(false);

  const isSaved = savedIds.has(id);
  const inCalendar = calendarIds.has(id);

  const act = async (fn: () => Promise<void>, ok: string) => {
    if (!user) return showToast('Sign in to track hackathons', 'info');
    setBusy(true);
    try {
      await fn();
      showToast(ok);
    } catch (err) {
      showToast(isAuthError(err) ? 'Your session expired — sign in again' : 'That did not work.', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="container-narrow">
          <div className="skeleton" style={{ height: 280 }} />
        </div>
      </div>
    );
  }

  if (error || !h) {
    return (
      <div className="page">
        <div className="container-narrow emptyState">
          <div className="emptyIcon" aria-hidden="true">🛸</div>
          <p>{error || 'That hackathon is no longer listed.'}</p>
          <Link href="/explore" className="btn btnGhost">Back to explore</Link>
        </div>
      </div>
    );
  }

  const colour = sourceColor(h.source);
  const days = h.days_until_deadline ?? daysUntil(h.registration_deadline);
  const prize = formatPrize(h.prize_pool, h.prize_value_inr);

  return (
    <div className="page">
      <div className="container-narrow">
        <Link href="/explore" className={styles.back}>← Back to explore</Link>

        <div className={styles.badges}>
          <span className={styles.source} style={{ color: colour, borderColor: `${colour}66`, background: `${colour}1f` }}>
            {sourceLabel(h.source)}
          </span>
          <span className="chip">{formatType(h.hackathon_type)}</span>
          <span className={styles.deadline} style={{ color: deadlineColor(days) }}>
            {deadlineLabel(days)}
          </span>
        </div>

        <h1 className={styles.title}>{stripHTML(h.title)}</h1>

        {h.description && <p className={styles.description}>{stripHTML(h.description)}</p>}

        {h.domains && h.domains.length > 0 && (
          <ul className={styles.domains}>
            {h.domains.map((d) => <li key={d}>{d}</li>)}
          </ul>
        )}

        <div className={styles.actions}>
          <a
            href={h.source_url}
            target="_blank"
            rel="noreferrer noopener"
            className="btn btnPrimary"
            // Source brand colours are light; white text on them measured
            // 1.67:1 (Unstop) to 2.77:1 (MLH). Dark text clears 6.9:1 on all five.
            style={{ background: colour, borderColor: colour, color: 'var(--bg)' }}
          >
            Register on {sourceLabel(h.source)} ↗
          </a>
          <button
            className="btn btnGhost"
            onClick={() => act(() => addEvent(id), 'Added to your calendar')}
            disabled={busy || inCalendar}
          >
            {inCalendar ? '✓ In calendar' : 'Add to calendar'}
          </button>
          <button
            className="btn"
            onClick={() => act(() => save(id), 'Saved')}
            disabled={busy || isSaved}
          >
            {isSaved ? '★ Saved' : '☆ Save'}
          </button>
        </div>

        <dl className={styles.facts}>
          <Fact label="Format" value={formatType(h.hackathon_type)} />
          <Fact label="Prize pool" value={prize || '—'} accent={prize ? 'var(--warning)' : undefined} />
          <Fact label="Team size" value={h.team_size_label || '—'} />
          <Fact
            label="Registration closes"
            value={formatDate(h.registration_deadline)}
            accent={deadlineColor(days)}
          />
          {h.start_date && <Fact label="Starts" value={formatDate(h.start_date)} />}
          {h.end_date && <Fact label="Ends" value={formatDate(h.end_date)} />}
          {h.submission_deadline && (
            <Fact label="Submission due" value={formatDate(h.submission_deadline)} accent="var(--danger)" />
          )}
        </dl>

        <p className={styles.footnote}>
          Listed on <span style={{ color: colour }}>{sourceLabel(h.source)}</span> · synced automatically
        </p>
      </div>
      {toastElement}
    </div>
  );
}
