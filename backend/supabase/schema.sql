-- ============================================================
-- HackOrbit — Full Supabase Schema Migration
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ─── TABLE: hackathons ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hackathons (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title                 TEXT NOT NULL,
  source                TEXT NOT NULL,  -- 'devfolio' | 'hackerearth' | 'unstop' | 'mlh' | 'devpost'
  source_url            TEXT NOT NULL,
  banner_url            TEXT,
  description           TEXT,
  hackathon_type        TEXT NOT NULL CHECK (hackathon_type IN ('online', 'offline', 'hybrid')),
  prize_pool            TEXT,
  prize_value_inr       INTEGER DEFAULT 0,
  team_size_min         INTEGER,
  team_size_max         INTEGER,
  team_size_label       TEXT,
  registration_deadline TIMESTAMPTZ NOT NULL,
  start_date            TIMESTAMPTZ,
  end_date              TIMESTAMPTZ,
  submission_deadline   TIMESTAMPTZ,
  domains               TEXT[] DEFAULT '{}',
  is_active             BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  -- Composite unique key for idempotent scraper upserts
  CONSTRAINT hackathons_source_url_unique UNIQUE (source, source_url)
);

-- Indexes for common filter queries
CREATE INDEX IF NOT EXISTS idx_hackathons_deadline     ON public.hackathons (registration_deadline);
CREATE INDEX IF NOT EXISTS idx_hackathons_type         ON public.hackathons (hackathon_type);
CREATE INDEX IF NOT EXISTS idx_hackathons_source       ON public.hackathons (source);
CREATE INDEX IF NOT EXISTS idx_hackathons_active       ON public.hackathons (is_active);
CREATE INDEX IF NOT EXISTS idx_hackathons_domains_gin  ON public.hackathons USING GIN (domains);

-- GET /hackathons?search= runs title/description ILIKE '%term%'. A btree index
-- cannot serve a leading wildcard; these trigram indexes can. This is what the
-- pg_trgm extension above was enabled for.
CREATE INDEX IF NOT EXISTS idx_hackathons_title_trgm ON public.hackathons USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_hackathons_desc_trgm  ON public.hackathons USING GIN (description gin_trgm_ops);

-- ─── TABLE: profiles ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id                   UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name         TEXT,
  college              TEXT,
  year_of_study        TEXT,  -- '1st'..'5th' | 'Working Professional' (validated in the API)
  avatar_url           TEXT,
  interests            TEXT[] DEFAULT '{}',
  experience           TEXT,   -- 'beginner' | 'intermediate' | 'advanced'
  format_pref          TEXT,   -- 'online' | 'offline' | 'both'
  team_pref            TEXT,   -- 'solo' | 'team' | 'either'
  onboarding_complete  BOOLEAN DEFAULT false,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

-- ─── TABLE: saved_hackathons ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saved_hackathons (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hackathon_id   UUID NOT NULL REFERENCES public.hackathons(id) ON DELETE CASCADE,
  status         TEXT DEFAULT 'saved' CHECK (status IN ('saved', 'applied', 'submitted')),
  saved_at       TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT saved_hackathons_user_hackathon_unique UNIQUE (user_id, hackathon_id)
);

-- ─── TABLE: calendar_events ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.calendar_events (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hackathon_id   UUID NOT NULL REFERENCES public.hackathons(id) ON DELETE CASCADE,
  added_at       TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT calendar_events_user_hackathon_unique UNIQUE (user_id, hackathon_id)
);

-- Both user-scoped tables are filtered by user_id on every read. Declared here,
-- after the tables exist: an index on a not-yet-created table is a 42P01.
CREATE INDEX IF NOT EXISTS idx_saved_user    ON public.saved_hackathons (user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_user ON public.calendar_events (user_id);

-- ─── TABLE: scrape_logs ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scrape_logs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source            TEXT NOT NULL,
  started_at        TIMESTAMPTZ DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  records_upserted  INTEGER DEFAULT 0,
  error_message     TEXT,
  status            TEXT DEFAULT 'running' CHECK (status IN ('running', 'success', 'error'))
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

ALTER TABLE public.hackathons                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_hackathons          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scrape_logs               ENABLE ROW LEVEL SECURITY;

-- hackathons: public read for active only
DROP POLICY IF EXISTS "hackathons_public_read" ON public.hackathons;
CREATE POLICY "hackathons_public_read"
  ON public.hackathons FOR SELECT
  USING (is_active = true);

-- profiles: own row only
DROP POLICY IF EXISTS "profiles_own_select" ON public.profiles;
CREATE POLICY "profiles_own_select"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_own_insert" ON public.profiles;
CREATE POLICY "profiles_own_insert"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_own_update" ON public.profiles;
CREATE POLICY "profiles_own_update"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- saved_hackathons: full CRUD on own rows
DROP POLICY IF EXISTS "saved_hackathons_own" ON public.saved_hackathons;
CREATE POLICY "saved_hackathons_own"
  ON public.saved_hackathons FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- calendar_events: full CRUD on own rows
DROP POLICY IF EXISTS "calendar_events_own" ON public.calendar_events;
CREATE POLICY "calendar_events_own"
  ON public.calendar_events FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- scrape_logs: NO public access (service role only — no policies needed, role bypasses RLS)

-- ============================================================
-- AUTH TRIGGER: auto-create profile on new user signup
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Drop trigger if exists to avoid duplicate
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- STORAGE BUCKETS
-- (Run these in the Supabase Dashboard > Storage, or via this SQL)
-- ============================================================

-- NOTE: Storage buckets must be created via the Dashboard UI or Management API.
-- Bucket 1: avatars (private, 5MB limit, jpg/png/webp)
-- Bucket 2: hackathon-banners (public, 10MB limit, jpg/png/webp)

-- Storage RLS policies (run after creating buckets in Dashboard):

-- avatars bucket: user can manage their own path only
-- CREATE POLICY "avatars_own_upload"
--   ON storage.objects FOR ALL
--   USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1])
--   WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- hackathon-banners: public read, service role write
-- CREATE POLICY "banners_public_read"
--   ON storage.objects FOR SELECT
--   USING (bucket_id = 'hackathon-banners');
