import { supabaseAdmin } from './supabase.js';
import { dbError } from '../middleware/errorHandler.js';

/** PostgREST reports "no rows" from .single() as PGRST116; anything else is a real failure. */
export function isNoRows(error) {
  return error?.code === 'PGRST116';
}

/**
 * Returns the caller's profile, creating an empty row if the signup trigger
 * never ran (users created before the trigger, or via the admin API).
 * Every personalised route depends on this row existing.
 */
export async function getProfile(userId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw dbError(error);
  if (data) return data;

  const { data: created, error: createError } = await supabaseAdmin
    .from('profiles')
    .upsert({ id: userId }, { onConflict: 'id' })
    .select()
    .single();

  if (createError) throw dbError(createError);
  return created;
}
