'use client';
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './supabase';
import {
  fetchHackathons, fetchHackathon, fetchSaved, fetchCalendar, saveHackathon, unsaveHackathon,
  updateSavedStatus, addToCalendar, removeFromCalendar, ApiError,
  type HackathonFilters, type Hackathon, type SavedHackathon, type SavedStatus, type CalendarEvent,
} from './api';

const errorMessage = (err: unknown) =>
  err instanceof ApiError
    ? err.status === 0
      ? 'Cannot reach the server. Is the backend running?'
      : err.message
    : 'Something went wrong';

// Loading is derived by comparing the key of the data we hold against the key we
// want. Calling setState synchronously in an effect body triggers cascading
// renders, which React 19 rejects outright.

// ─── Session ─────────────────────────────────────────────────────────────────

export function useUser() {
  const [state, setState] = useState<{ user: User | null; ready: boolean }>({
    user: null,
    ready: !isSupabaseConfigured,
  });

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setState({ user: data.session?.user ?? null, ready: true });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ user: session?.user ?? null, ready: true });
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
  }, []);

  return { user: state.user, loading: !state.ready, signOut, configured: isSupabaseConfigured };
}

// ─── Hackathon lists ─────────────────────────────────────────────────────────

type ListState = { key: string; data: Hackathon[]; total: number; error: string | null };

export function useHackathons(filters: HackathonFilters = {}) {
  // Filters are a fresh object each render, so key on the serialised value.
  const filterKey = JSON.stringify(filters);
  const [state, setState] = useState<ListState>({ key: '', data: [], total: 0, error: null });

  useEffect(() => {
    let cancelled = false;

    fetchHackathons(JSON.parse(filterKey))
      .then((res) => {
        if (!cancelled) setState({ key: filterKey, data: res.data, total: res.total, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ key: filterKey, data: [], total: 0, error: errorMessage(err) });
      });

    return () => { cancelled = true; };
  }, [filterKey]);

  return {
    data: state.data,
    total: state.total,
    error: state.error,
    loading: state.key !== filterKey,
  };
}

export function useHackathon(id: string | null) {
  const [state, setState] = useState<{ key: string | null; data: Hackathon | null; error: string | null }>({
    key: null, data: null, error: null,
  });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    fetchHackathon(id)
      .then((res) => !cancelled && setState({ key: id, data: res, error: null }))
      .catch((err) => !cancelled && setState({ key: id, data: null, error: errorMessage(err) }));

    return () => { cancelled = true; };
  }, [id]);

  return { data: state.data, error: state.error, loading: Boolean(id) && state.key !== id };
}

// ─── Saved + calendar, shared app-wide ───────────────────────────────────────
// These were per-page hooks, so /explore alone fired three requests on mount and
// every navigation refetched the same rows. One provider, one fetch.

type LibraryData = {
  userId: string | null;
  saved: SavedHackathon[];
  events: CalendarEvent[];
  hackathons: Hackathon[];
  error: string | null;
};

type LibraryValue = {
  saved: SavedHackathon[];
  events: CalendarEvent[];
  calendarHackathons: Hackathon[];
  savedIds: Set<string>;
  calendarIds: Set<string>;
  loading: boolean;
  error: string | null;
  save: (id: string) => Promise<void>;
  unsave: (id: string) => Promise<void>;
  setStatus: (id: string, status: SavedStatus) => Promise<void>;
  addEvent: (id: string) => Promise<void>;
  removeEvent: (id: string) => Promise<void>;
  refetch: () => void;
};

const EMPTY: LibraryData = { userId: null, saved: [], events: [], hackathons: [], error: null };

const LibraryContext = createContext<LibraryValue | null>(null);

export function useLibraryState(): LibraryValue {
  const { user } = useUser();
  const [data, setData] = useState<LibraryData>(EMPTY);

  // Stops a slow earlier refetch from overwriting a newer one — rapid
  // save/unsave clicks used to leave the UI showing the older result.
  const runId = useRef(0);

  const load = useCallback((userId: string) => {
    const run = ++runId.current;
    Promise.all([fetchSaved(), fetchCalendar()])
      .then(([saved, cal]) => {
        if (run !== runId.current) return;
        setData({ userId, saved, events: cal.events, hackathons: cal.hackathons, error: null });
      })
      .catch((err) => {
        if (run !== runId.current) return;
        setData({ userId, saved: [], events: [], hackathons: [], error: errorMessage(err) });
      });
  }, []);

  useEffect(() => {
    if (!user) return;
    load(user.id);
  }, [user, load]);

  // Rows are only ever shown to the user they were fetched for, so signing out
  // (or switching accounts) hides them without clearing state from an effect.
  const mine = Boolean(user) && data.userId === user?.id;
  const view = mine ? data : EMPTY;

  const refetch = useCallback(() => {
    if (user) load(user.id);
  }, [user, load]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      await fn();
      refetch();
    },
    [refetch]
  );

  return useMemo(
    () => ({
      saved: view.saved,
      events: view.events,
      calendarHackathons: view.hackathons,
      savedIds: new Set(view.saved.map((s) => s.id)),
      calendarIds: new Set(view.events.map((e) => e.hackathon_id)),
      loading: Boolean(user) && !mine && !data.error,
      error: mine ? data.error : null,
      save: (id) => act(() => saveHackathon(id)),
      unsave: (id) => act(() => unsaveHackathon(id)),
      setStatus: (id, status) => act(() => updateSavedStatus(id, status)),
      addEvent: (id) => act(() => addToCalendar(id)),
      removeEvent: (id) => act(() => removeFromCalendar(id)),
      refetch,
    }),
    [view, mine, data.error, user, act, refetch]
  );
}

export const LibraryProvider = LibraryContext.Provider;

export function useLibrary(): LibraryValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used inside <Providers>');
  return ctx;
}

// ─── Misc ────────────────────────────────────────────────────────────────────

/** Delays a fast-changing value — one request per pause, not per keystroke. */
export function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
