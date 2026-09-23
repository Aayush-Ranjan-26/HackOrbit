'use client';
import { useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useLibrary, useUser } from '@/lib/hooks';
import type { CalendarEvent } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useToast } from '@/components/Toast';
import styles from './calendar.module.css';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const EVENT_META: Record<CalendarEvent['type'], { color: string; label: string }> = {
  registration_deadline: { color: '#fcd34d', label: 'Registration closes' },
  submission_deadline: { color: '#fca5a5', label: 'Submission due' },
  start: { color: '#86efac', label: 'Starts' },
  end: { color: '#9ca3af', label: 'Ends' },
};

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Never re-subscribes; `mounted` flips once, at hydration. */
const noopSubscribe = () => () => {};

export default function CalendarPage() {
  /**
   * "Now" is read only after hydration, never during the server render. This
   * route is statically prerendered, so calling `new Date()` in the render
   * body baked the build-time month into calendar.html and served it to every
   * visitor — a stale grid plus a hydration mismatch on every load. Forcing
   * the route dynamic would not have fixed it either, since the server's
   * timezone is not the browser's.
   */
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
  const today = useMemo(() => (mounted ? new Date() : null), [mounted]);

  // Null until the user navigates; the visible month defaults to today's.
  const [viewOverride, setViewOverride] = useState<{ year: number; month: number } | null>(null);
  const view =
    viewOverride ?? (today ? { year: today.getFullYear(), month: today.getMonth() } : null);

  const { user, loading: authLoading } = useUser();
  const { events, calendarHackathons, loading, error, removeEvent } = useLibrary();
  const { showToast, toastElement } = useToast();

  const [selected, setSelected] = useState<number | null>(null);

  // One pass over the events instead of a filter per day cell.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const d = new Date(ev.date);
      if (isNaN(d.getTime())) continue;
      const key = dayKey(d);
      const list = map.get(key);
      if (list) list.push(ev);
      else map.set(key, [ev]);
    }
    return map;
  }, [events]);

  const hackathonById = useMemo(
    () => new Map(calendarHackathons.map((h) => [h.id, h])),
    [calendarHackathons]
  );

  const upcoming = useMemo(() => {
    if (!today) return [];
    const startOfToday = new Date(today.toDateString()).getTime();
    return events
      .filter((e) => new Date(e.date).getTime() >= startOfToday)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [events, today]);

  // Server render and first client render both land here, so they match.
  // authLoading joins the same gate: checking it only further down flashed the
  // month grid at signed-out visitors for one tick, unlike every other
  // protected page.
  if (!today || !view || authLoading) {
    return (
      <div className="page">
        <div className="container">
          <div className="skeleton" style={{ height: 420 }} />
        </div>
      </div>
    );
  }

  const { year: viewYear, month: viewMonth } = view;
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const eventsOn = (day: number) => eventsByDay.get(dayKey(new Date(viewYear, viewMonth, day))) ?? [];

  const shiftMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewOverride({ year: d.getFullYear(), month: d.getMonth() });
    setSelected(null);
  };

  const remove = async (id: string, title: string) => {
    try {
      await removeEvent(id);
      showToast(`Removed “${title}”`);
    } catch {
      showToast('Could not remove that. Try again.', 'error');
    }
  };

  if (!user) {
    return (
      <div className="page">
        <div className="container-narrow emptyState">
          <div className="emptyIcon" aria-hidden="true">📅</div>
          <h1 className="pageTitle">Your deadline calendar</h1>
          <p>Sign in to track registration and submission deadlines in one place.</p>
          <Link href="/login?next=/calendar" className="btn btnPrimary">Sign in</Link>
        </div>
      </div>
    );
  }

  const selectedEvents = selected ? eventsOn(selected) : [];

  return (
    <div className="page">
      <div className="container">
        <h1 className="pageTitle">My calendar</h1>
        <p className="pageSub">
          {loading && !events.length
            ? 'Loading your deadlines…'
            : `${calendarHackathons.length} hackathon${calendarHackathons.length === 1 ? '' : 's'} tracked`}
        </p>

        {error && <div className="errorBox" style={{ marginBottom: '1.5rem' }}>{error}</div>}

        {!loading && !error && calendarHackathons.length === 0 && (
          <div className="emptyState">
            <div className="emptyIcon" aria-hidden="true">📅</div>
            <p>Your calendar is empty. Add a hackathon from Explore to track its deadlines here.</p>
            <Link href="/explore" className="btn btnPrimary">Explore hackathons</Link>
          </div>
        )}

        <div className={styles.layout}>
          <section aria-label="Month view">
            <div className={styles.monthBar}>
              <button className="btn" onClick={() => shiftMonth(-1)} aria-label="Previous month">←</button>
              <div className={styles.monthLabel}>
                <h2 aria-live="polite">{MONTHS[viewMonth]} {viewYear}</h2>
                <button
                  className="btn btnGhost"
                  onClick={() => {
                    setViewOverride({ year: today.getFullYear(), month: today.getMonth() });
                    setSelected(today.getDate());
                  }}
                >
                  Today
                </button>
              </div>
              <button className="btn" onClick={() => shiftMonth(1)} aria-label="Next month">→</button>
            </div>

            <div className={styles.weekdays} aria-hidden="true">
              {DAYS_SHORT.map((d) => <div key={d}>{d}</div>)}
            </div>

            <div className={styles.grid}>
              {cells.map((day, i) => {
                if (day === null) return <div key={`pad-${i}`} className={styles.pad} />;

                const dayEvents = eventsOn(day);
                const isToday =
                  day === today.getDate() &&
                  viewMonth === today.getMonth() &&
                  viewYear === today.getFullYear();
                const isPast = new Date(viewYear, viewMonth, day) < new Date(today.toDateString());

                // A real button, so the grid is reachable and operable by keyboard —
                // it used to be a div with an onClick and no tabindex.
                return (
                  <button
                    key={day}
                    type="button"
                    className={`${styles.day} ${selected === day ? styles.daySelected : ''} ${isToday ? styles.dayToday : ''} ${isPast ? styles.dayPast : ''}`}
                    aria-pressed={selected === day}
                    aria-label={`${MONTHS[viewMonth]} ${day}, ${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}`}
                    onClick={() => setSelected(selected === day ? null : day)}
                  >
                    <span className={styles.dayNum}>{day}</span>
                    {dayEvents.length > 0 && (
                      <>
                        <span className={styles.dots}>
                          {dayEvents.slice(0, 4).map((ev, n) => (
                            <span
                              key={n}
                              className={styles.dot}
                              style={{ background: EVENT_META[ev.type].color }}
                            />
                          ))}
                        </span>
                        <span className={styles.dayTitle}>{dayEvents[0].hackathon_title}</span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>

            {selected && selectedEvents.length > 0 && (
              <div className={`card ${styles.dayPanel}`}>
                <h3>{MONTHS[viewMonth]} {selected}</h3>
                <ul className={styles.dayPanelList}>
                  {selectedEvents.map((ev, i) => (
                    <li key={`${ev.hackathon_id}-${ev.type}-${i}`}>
                      <span className={styles.dot} style={{ background: EVENT_META[ev.type].color }} />
                      <span className={styles.dayPanelTitle}>{ev.hackathon_title}</span>
                      <span className={styles.dayPanelMeta}>{EVENT_META[ev.type].label}</span>
                      <Link href={`/hackathon/${ev.hackathon_id}`} className="btn">Details</Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <ul className={styles.legend}>
              {Object.entries(EVENT_META).map(([type, meta]) => (
                <li key={type}>
                  <span className={styles.dot} style={{ background: meta.color }} />
                  {meta.label}
                </li>
              ))}
            </ul>
          </section>

          <aside className={styles.sidebar} aria-label="Upcoming deadlines">
            <div className={`card ${styles.sidebarCard}`}>
              <h3 className={styles.sidebarTitle}>
                Upcoming <span className={styles.count}>{upcoming.length}</span>
              </h3>

              {!loading && upcoming.length === 0 && (
                <p className={styles.sidebarEmpty}>Nothing coming up.</p>
              )}

              <ul className={styles.upcoming}>
                {upcoming.slice(0, 20).map((ev, i) => {
                  const meta = EVENT_META[ev.type];
                  const hackathon = hackathonById.get(ev.hackathon_id);
                  return (
                    <li
                      key={`${ev.hackathon_id}-${ev.type}-${i}`}
                      className={styles.upcomingItem}
                      style={{ borderLeftColor: meta.color }}
                    >
                      <p className={styles.upcomingName}>{ev.hackathon_title}</p>
                      <p className={styles.upcomingMeta} style={{ color: meta.color }}>{meta.label}</p>
                      <p className={styles.upcomingDate}>{formatDate(ev.date)}</p>
                      <div className={styles.upcomingActions}>
                        {hackathon?.source_url && (
                          <a href={hackathon.source_url} target="_blank" rel="noreferrer noopener" className="btn">
                            Open ↗
                          </a>
                        )}
                        <button className="btn" onClick={() => remove(ev.hackathon_id, ev.hackathon_title)}>
                          Remove
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </aside>
        </div>
      </div>
      {toastElement}
    </div>
  );
}
