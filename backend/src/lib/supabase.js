import { createClient } from '@supabase/supabase-js';

// Env is loaded by the npm scripts (`node --env-file=.env ...`), not here.
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
