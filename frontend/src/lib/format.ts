/** Presentation helpers shared by every page. Previously copy-pasted 3-4 times each. */

/** Scraped copy can still carry markup; this is the last line of defence before render. */
export function stripHTML(str?: string | null): string {
  if (!str) return '';
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SOURCE_COLORS: Record<string, string> = {
  devpost: '#60a5fa',
  mlh: '#f87171',
  hackerearth: '#c084fc',
  devfolio: '#22d3ee',
  unstop: '#fbbf24',
};

const SOURCE_LABELS: Record<string, string> = {
  devpost: 'Devpost',
  mlh: 'MLH',
  hackerearth: 'HackerEarth',
  devfolio: 'Devfolio',
  unstop: 'Unstop',
};

/** Displayed the same way everywhere — the detail page showed both "online" and "Online". */
export const formatType = (t?: string | null) =>
  t ? t[0].toUpperCase() + t.slice(1) : '—';

export const sourceColor = (s: string) => SOURCE_COLORS[s] || '#a78bfa';
export const sourceLabel = (s: string) => SOURCE_LABELS[s] || s;

/** Red inside 3 days, amber inside a week, green beyond. */
export function deadlineColor(days: number | null): string {
  if (days === null) return 'var(--text-muted)';
  if (days <= 3) return '#fca5a5';
  if (days <= 7) return '#fcd34d';
  return '#86efac';
}

export function deadlineLabel(days: number | null): string {
  if (days === null) return 'No deadline';
  if (days < 0) return 'Closed';
  if (days === 0) return 'Closes today';
  if (days === 1) return '1 day left';
  return `${days} days left`;
}

export function daysUntil(date?: string | null): number | null {
  if (!date) return null;
  const t = new Date(date).getTime();
  return isNaN(t) ? null : Math.ceil((t - Date.now()) / 86400000);
}

export function formatDate(date?: string | null): string {
  if (!date) return '—';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Prizes are stored normalised to INR so sources can be ranked against each
 * other; the original string is shown when we have it.
 */
export function formatPrize(prizePool?: string | null, inr?: number | null): string | null {
  const clean = stripHTML(prizePool);
  if (clean) return clean;
  if (inr && inr > 0) return `₹${inr.toLocaleString('en-IN')}`;
  return null;
}
