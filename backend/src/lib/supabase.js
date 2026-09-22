import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// `npm run scrape` runs jobs/scraper.js directly, so load .env here too.
dotenv.config();

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in backend/.env');
}

// Service-role client — bypasses RLS. Never exposed to the frontend.
// Every user-scoped query must filter on req.user.id explicitly; RLS is not a safety net here.
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
