/**
 * Client for the HackOrbit Express API.
 * Base URL from NEXT_PUBLIC_API_BASE; admin calls go through this app's own
 * /api/admin proxy so the admin secret never reaches the browser.
 */
import { getAccessToken } from './supabase';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8080';

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const isAuthError = (err: unknown) => err instanceof ApiError && err.status === 401;

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    // Distinguishable from a 4xx so the UI can say "server unreachable".
    throw new ApiError('Cannot reach the server', 0, 'NETWORK');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error || res.statusText, res.status, body.code);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

// ─── Hackathons ──────────────────────────────────────────────────────────────
export type HackathonFilters = {
  search?: string;
  domain?: string;
  hackathon_type?: 'online' | 'offline' | 'hybrid';
  prize_min?: number;
  source?: string;
  deadline_from?: string;
  deadline_to?: string;
  sort?: 'deadline_asc' | 'prize_desc' | 'newest';
  page?: number;
  limit?: number;
};

export function fetchHackathons(filters: HackathonFilters = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return apiFetch<{ data: Hackathon[]; total: number; page: number; limit: number }>(
    `/hackathons${qs ? `?${qs}` : ''}`
  );
}

export const fetchHackathon = (id: string) => apiFetch<Hackathon>(`/hackathons/${id}`);

/** Domains that actually exist in the data, most common first. */
export const fetchDomains = () =>
  apiFetch<{ domains: { name: string; count: number }[] }>('/hackathons/domains');

// ─── User ────────────────────────────────────────────────────────────────────
export const fetchProfile = () => apiFetch<Profile>('/user/profile');

export const updateProfile = (data: Partial<Profile>) =>
  apiFetch<Profile>('/user/profile', { method: 'PUT', body: JSON.stringify(data) });

export const fetchSaved = () => apiFetch<SavedHackathon[]>('/user/saved');

export const saveHackathon = (id: string) => apiFetch(`/user/saved/${id}`, { method: 'POST' });

export const unsaveHackathon = (id: string) => apiFetch(`/user/saved/${id}`, { method: 'DELETE' });

export const updateSavedStatus = (id: string, status: SavedStatus) =>
  apiFetch(`/user/saved/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });

export const fetchCalendar = () =>
  apiFetch<{ events: CalendarEvent[]; hackathons: Hackathon[] }>('/user/calendar');

export const addToCalendar = (id: string) => apiFetch(`/user/calendar/${id}`, { method: 'POST' });

export const removeFromCalendar = (id: string) =>
  apiFetch(`/user/calendar/${id}`, { method: 'DELETE' });

// ─── Recommendations ─────────────────────────────────────────────────────────
export const fetchRecommendations = () =>
  apiFetch<RecommendationsResponse>('/user/recommendations');

// ─── Admin (proxied server-side; the secret never reaches the browser) ───────
export interface ScrapeLog {
  id: string;
  source: string;
  started_at: string;
  finished_at?: string;
  records_upserted: number;
  status: 'running' | 'success' | 'error';
  error_message?: string;
}

export interface AdminStats {
  total: number;
  by_source: Record<string, number>;
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin${path}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error || res.statusText, res.status, body.code);
  }
  return res.json();
}

export const triggerScrape = () =>
  adminFetch<{ message: string }>('/scrape', { method: 'POST' });

export const fetchScrapeStatus = () =>
  adminFetch<{ logs: ScrapeLog[]; running: boolean }>('/scrape-status');

export const fetchAdminStats = () => adminFetch<AdminStats>('/stats');

// ─── Types ───────────────────────────────────────────────────────────────────
export type SavedStatus = 'saved' | 'applied' | 'submitted';

export interface Hackathon {
  id: string;
  title: string;
  source: string;
  source_url: string;
  banner_url?: string;
  description?: string;
  hackathon_type: 'online' | 'offline' | 'hybrid';
  prize_pool?: string;
  prize_value_inr?: number;
  team_size_min?: number;
  team_size_max?: number;
  team_size_label?: string;
  registration_deadline: string;
  start_date?: string;
  end_date?: string;
  submission_deadline?: string;
  domains?: string[];
  days_until_deadline?: number;
}

export type SavedHackathon = Hackathon & { status: SavedStatus; saved_at: string };

export interface Profile {
  id: string;
  display_name?: string | null;
  college?: string | null;
  year_of_study?: string | null;
  avatar_url?: string | null;
  interests?: string[];
  experience?: string | null;
  format_pref?: string | null;
  team_pref?: string | null;
  onboarding_complete?: boolean;
}

export interface CalendarEvent {
  type: 'registration_deadline' | 'submission_deadline' | 'start' | 'end';
  date: string;
  hackathon_id: string;
  hackathon_title: string;
  banner_url?: string;
  color: 'amber' | 'danger' | 'success' | 'muted';
}

export interface RecommendationsResponse {
  recommendations: { rank: number; hackathon: Hackathon; reason: string }[];
  matched_on_interests: boolean;
}
