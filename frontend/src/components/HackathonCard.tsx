'use client';
import Link from 'next/link';
import type { Hackathon, SavedStatus } from '@/lib/api';
import {
  deadlineColor, deadlineLabel, formatPrize, formatType, sourceColor, sourceLabel, stripHTML, daysUntil,
} from '@/lib/format';
import styles from './HackathonCard.module.css';

const STATUS_LABEL: Record<SavedStatus, string> = {
  saved: 'Saved',
  applied: 'Applied',
  submitted: 'Submitted',
};

/** Next step in the saved → applied → submitted pipeline, or null at the end. */
export const nextStatus = (s: SavedStatus): SavedStatus | null =>
  s === 'saved' ? 'applied' : s === 'applied' ? 'submitted' : null;

type Props = {
  hackathon: Hackathon;
  saved?: boolean;
  inCalendar?: boolean;
  status?: SavedStatus;
  note?: string;
  busy?: boolean;
  onSave?: () => void;
  onCalendar?: () => void;
  onAdvance?: () => void;
  onRemove?: () => void;
};

export default function HackathonCard({
  hackathon: h, saved, inCalendar, status, note, busy,
  onSave, onCalendar, onAdvance, onRemove,
}: Props) {
  const colour = sourceColor(h.source);
  const days = h.days_until_deadline ?? daysUntil(h.registration_deadline);
  const prize = formatPrize(h.prize_pool, h.prize_value_inr);
  const advance = status ? nextStatus(status) : null;

  return (
    <article className={styles.card}>
      <div className={styles.band} style={{ background: colour }} />

      <div className={styles.body}>
        <div className={styles.meta}>
          <span className={styles.source} style={{ color: colour, borderColor: `${colour}66` }}>
            {sourceLabel(h.source)}
          </span>
          <span className="chip">{formatType(h.hackathon_type)}</span>
          {days !== null && (
            <span className={styles.deadline} style={{ color: deadlineColor(days) }}>
              {deadlineLabel(days)}
            </span>
          )}
          {status && <span className={styles.status}>{STATUS_LABEL[status]}</span>}
        </div>

        <h3 className={styles.title}>
          <Link href={`/hackathon/${h.id}`} className={styles.titleLink}>
            {stripHTML(h.title)}
          </Link>
        </h3>

        {note && <p className={styles.note}>{note}</p>}

        {h.domains && h.domains.length > 0 && (
          <ul className={styles.domains}>
            {h.domains.slice(0, 3).map((d) => (
              <li key={d} className={styles.domain}>{d}</li>
            ))}
            {h.domains.length > 3 && (
              <li className={styles.domainMore}>+{h.domains.length - 3}</li>
            )}
          </ul>
        )}

        <div className={styles.facts}>
          {prize && <span className={styles.prize}>🏆 {prize}</span>}
          {h.team_size_label && <span>👥 {h.team_size_label}</span>}
        </div>

        <div className={styles.actions}>
          {onCalendar && (
            <button
              className="btn btnGhost"
              onClick={onCalendar}
              disabled={busy || inCalendar}
              aria-label={inCalendar ? `${h.title} is in your calendar` : `Add ${h.title} to calendar`}
            >
              {inCalendar ? '✓ In calendar' : 'Add to calendar'}
            </button>
          )}
          {onSave && (
            <button
              className="btn"
              onClick={onSave}
              disabled={busy || saved}
              aria-label={saved ? `${h.title} is saved` : `Save ${h.title}`}
            >
              {saved ? '★ Saved' : '☆ Save'}
            </button>
          )}
          {onAdvance && advance && (
            <button className="btn" onClick={onAdvance} disabled={busy}>
              Mark {advance}
            </button>
          )}
          {onRemove && (
            <button
              className={`btn ${styles.remove}`}
              onClick={onRemove}
              disabled={busy}
              aria-label={`Remove ${h.title}`}
            >
              Remove
            </button>
          )}
          <Link href={`/hackathon/${h.id}`} className={`btn ${styles.details}`}>
            Details
          </Link>
        </div>
      </div>
    </article>
  );
}
