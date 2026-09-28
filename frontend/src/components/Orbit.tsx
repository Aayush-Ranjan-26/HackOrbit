'use client';
import Link from 'next/link';
import { useState, type CSSProperties } from 'react';
import { useHackathons } from '@/lib/hooks';
import { daysUntil, deadlineLabel, sourceColor, sourceLabel, stripHTML } from '@/lib/format';
import styles from './Orbit.module.css';

const DAY = 86_400_000;
const SOURCES = ['devpost', 'unstop', 'devfolio', 'mlh', 'hackerearth'];
// Start angles per ring, so the planets of neighbouring rings do not line up.
const OFFSET = [20, 75, 140];

/**
 * The landing hero: a solar system of real listings. The sun is now; the three
 * rings are deadline windows, so the closer a planet orbits, the sooner it closes.
 * Each ring is a list of links, which is also its text alternative.
 */
export default function Orbit() {
  // Fixed at mount: useHackathons keys on the filters, so a fresh Date each
  // render would refetch forever.
  const [at] = useState(() => {
    const now = Date.now();
    return { week: new Date(now + 7 * DAY).toISOString(), month: new Date(now + 30 * DAY).toISOString() };
  });

  const week = useHackathons({ sort: 'deadline_asc', limit: 3, deadline_to: at.week });
  const month = useHackathons({ sort: 'deadline_asc', limit: 4, deadline_from: at.week, deadline_to: at.month });
  const later = useHackathons({ sort: 'deadline_asc', limit: 5, deadline_from: at.month });

  const rings = [
    { label: 'This week', ...week },
    { label: 'This month', ...month },
    { label: 'Later', ...later },
  ];
  const ready = rings.every((r) => !r.loading && !r.error);
  const failed = rings.some((r) => r.error);

  return (
    <figure className={styles.figure}>
      <div className={styles.scene}>
        <div className={styles.plane}>
          <span className={styles.sun} aria-hidden="true" />
          {rings.map((r, ri) => (
            <ol key={r.label} className={`${styles.ring} ${styles[`ring${ri}`]}`} aria-label={`Closing ${r.label.toLowerCase()}`}>
              {r.data.map((h, i) => {
                const title = stripHTML(h.title);
                const when = deadlineLabel(h.days_until_deadline ?? daysUntil(h.registration_deadline));
                const vars = {
                  '--a': `${OFFSET[ri] + (i * 360) / r.data.length}deg`,
                  '--c': sourceColor(h.source),
                } as CSSProperties;
                return (
                  <li key={h.id} className={styles.slot} style={vars}>
                    <span className={styles.counter}>
                      <Link
                        href={`/hackathon/${h.id}`}
                        className={styles.planet}
                        aria-label={`${title}, ${sourceLabel(h.source)}, ${when}`}
                      >
                        <span className={styles.label} aria-hidden="true">
                          <span className={styles.labelTitle}>{title}</span>
                          <span className={styles.labelMeta}>{when}</span>
                        </span>
                      </Link>
                    </span>
                  </li>
                );
              })}
            </ol>
          ))}
        </div>
      </div>

      <figcaption className={styles.caption}>
        <p>
          Each planet is an open hackathon. Inner orbit closes this week, the middle one this month,
          the outer one later.
        </p>
        {ready && (
          <p className={styles.counts}>
            {week.total + month.total + later.total} open now: {week.total} this week,{' '}
            {month.total} this month, {later.total} later.
          </p>
        )}
        {failed && <p className={styles.counts}>Live listings could not be loaded right now.</p>}
        <ul className={styles.sources} aria-label="Planet colour by source">
          {SOURCES.map((s) => (
            <li key={s} style={{ '--c': sourceColor(s) } as CSSProperties}>{sourceLabel(s)}</li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
