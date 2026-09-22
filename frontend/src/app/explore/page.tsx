'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useHackathons, useLibrary, useUser, useDebounced } from '@/lib/hooks';
import { fetchDomains, isAuthError, type Hackathon } from '@/lib/api';
import { sourceColor, sourceLabel } from '@/lib/format';
import HackathonCard from '@/components/HackathonCard';
import { useToast } from '@/components/Toast';
import styles from './explore.module.css';

const TYPES = ['All', 'online', 'offline', 'hybrid'] as const;
const SOURCES = ['All', 'unstop', 'devfolio', 'devpost', 'hackerearth', 'mlh'];
const SORTS = [
  { value: 'deadline_asc', label: 'Deadline soonest' },
  { value: 'prize_desc', label: 'Biggest prize' },
  { value: 'newest', label: 'Recently added' },
] as const;

const PER_PAGE = 18;

function ExploreInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useUser();
  const { savedIds, calendarIds, save, addEvent } = useLibrary();
  const { showToast, toastElement } = useToast();

  // URL is the source of truth, so filters survive refresh, back, and sharing.
  const search = params.get('q') ?? '';
  const type = params.get('type') ?? 'All';
  const domain = params.get('domain') ?? '';
  const source = params.get('source') ?? 'All';
  const sort = params.get('sort') ?? 'deadline_asc';
  const page = Math.max(1, parseInt(params.get('page') || '1'));

  // Typing updates the box immediately but the URL only after a pause.
  const [searchInput, setSearchInput] = useState(search);
  const [domains, setDomains] = useState<{ name: string; count: number }[]>([]);
  const debouncedSearch = useDebounced(searchInput);
  const [busyId, setBusyId] = useState<string | null>(null);

  const setParams = useCallback(
    (patch: Record<string, string | number | null>, keepPage = false) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '' || v === 'All') next.delete(k);
        else next.set(k, String(v));
      }
      if (!keepPage) next.delete('page');
      router.replace(next.toString() ? `/explore?${next}` : '/explore', { scroll: false });
    },
    [params, router]
  );

  useEffect(() => {
    if (debouncedSearch !== search) setParams({ q: debouncedSearch });
    // setParams changes with every URL edit; reacting to the debounced value alone
    // is what keeps this from looping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  // Populated from the data so the dropdown only offers domains that match something.
  useEffect(() => {
    let cancelled = false;
    fetchDomains()
      .then((res) => !cancelled && setDomains(res.domains))
      // Non-fatal: the rest of the page works, the dropdown just stays at
      // "All domains". Logged so it is not indistinguishable from "no data".
      .catch((err) => console.error('Could not load domain filter:', err));
    return () => { cancelled = true; };
  }, []);

  const { data: hackathons, total, loading, error } = useHackathons({
    search: search || undefined,
    domain: domain || undefined,
    hackathon_type: type !== 'All' ? (type as 'online' | 'offline' | 'hybrid') : undefined,
    source: source !== 'All' ? source : undefined,
    sort: sort as 'deadline_asc' | 'prize_desc' | 'newest',
    page,
    limit: PER_PAGE,
  });

  const guard = async (h: Hackathon, fn: () => Promise<void>, ok: string) => {
    if (!user) return showToast('Sign in to keep track of hackathons', 'info');
    setBusyId(h.id);
    try {
      await fn();
      showToast(ok);
    } catch (err) {
      // Previously every failure claimed "login required", including outages.
      showToast(isAuthError(err) ? 'Your session expired — sign in again' : 'That did not work. Try again.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const filtered = search || domain || type !== 'All' || source !== 'All';

  return (
    <div className="page">
      <div className="container">
        <h1 className="pageTitle">Explore hackathons</h1>
        <p className="pageSub">
          {loading
            ? 'Loading live listings…'
            : error
              ? 'Listings unavailable'
              : `${total} open hackathon${total === 1 ? '' : 's'} from Unstop, Devfolio, Devpost, HackerEarth and MLH`}
        </p>

        {/* Sources */}
        <div className={styles.sources} role="group" aria-label="Filter by source">
          {SOURCES.map((s) => {
            const active = source === s;
            const colour = s === 'All' ? 'var(--primary)' : sourceColor(s);
            return (
              <button
                key={s}
                onClick={() => setParams({ source: s })}
                aria-pressed={active}
                className={styles.sourcePill}
                style={active ? { color: colour, borderColor: colour, background: `${colour}22` } : undefined}
              >
                {s === 'All' ? 'All sources' : sourceLabel(s)}
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <div className={styles.filters}>
          <div className={styles.searchWrap}>
            <label htmlFor="search" className="srOnly">Search hackathons</label>
            <input
              id="search"
              className="input"
              type="search"
              placeholder="Search hackathons…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="type" className="srOnly">Format</label>
            <select id="type" className="select" value={type} onChange={(e) => setParams({ type: e.target.value })}>
              {TYPES.map((t) => (
                <option key={t} value={t}>{t === 'All' ? 'All formats' : t[0].toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="domain" className="srOnly">Domain</label>
            <select id="domain" className="select" value={domain} onChange={(e) => setParams({ domain: e.target.value })}>
              <option value="">All domains</option>
              {domains.map((d) => (
                <option key={d.name} value={d.name}>{d.name} ({d.count})</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="sort" className="srOnly">Sort by</label>
            <select id="sort" className="select" value={sort} onChange={(e) => setParams({ sort: e.target.value })}>
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          {filtered && (
            <button className={`btn ${styles.clear}`} onClick={() => router.replace('/explore')}>
              Clear filters
            </button>
          )}
        </div>

        {/* Backend down is a different problem from "no matches" and now says so. */}
        {error && !loading && (
          <div className="emptyState">
            <div className="emptyIcon" aria-hidden="true">📡</div>
            <p>{error}</p>
            <button className="btn btnPrimary" onClick={() => router.refresh()}>Retry</button>
          </div>
        )}

        {loading && (
          <div className={styles.grid} aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" style={{ height: 210 }} />)}
          </div>
        )}

        {!loading && !error && hackathons.length > 0 && (
          <div className={styles.grid}>
            {hackathons.map((h) => (
              <HackathonCard
                key={h.id}
                hackathon={h}
                saved={savedIds.has(h.id)}
                inCalendar={calendarIds.has(h.id)}
                busy={busyId === h.id}
                onSave={() => guard(h, () => save(h.id), `Saved “${h.title}”`)}
                onCalendar={() => guard(h, () => addEvent(h.id), `“${h.title}” added to your calendar`)}
              />
            ))}
          </div>
        )}

        {!loading && !error && hackathons.length === 0 && (
          <div className="emptyState">
            <div className="emptyIcon" aria-hidden="true">🛸</div>
            <p>No hackathons match these filters.</p>
            {filtered && (
              <button className="btn btnGhost" onClick={() => router.replace('/explore')}>Clear filters</button>
            )}
          </div>
        )}

        {!loading && !error && totalPages > 1 && (
          <nav className={styles.pagination} aria-label="Pagination">
            <button
              className="btn"
              onClick={() => setParams({ page: page - 1 }, true)}
              disabled={page <= 1}
            >
              ← Previous
            </button>
            <span className={styles.pageInfo} aria-live="polite">Page {page} of {totalPages}</span>
            <button
              className="btn"
              onClick={() => setParams({ page: page + 1 }, true)}
              disabled={page >= totalPages}
            >
              Next →
            </button>
          </nav>
        )}
      </div>
      {toastElement}
    </div>
  );
}

export default function ExplorePage() {
  // useSearchParams needs a Suspense boundary to avoid opting the whole route
  // into client-side rendering at build time.
  return (
    <Suspense fallback={<div className="page"><div className="container">Loading…</div></div>}>
      <ExploreInner />
    </Suspense>
  );
}
