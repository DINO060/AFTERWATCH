import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from './config';

/**
 * Server-only client with the project's secret key: it bypasses RLS. Only the notification job
 * and the unsubscribe link use it. SUPABASE_SECRET_KEY is never a NEXT_PUBLIC_ variable, so it
 * cannot reach a browser bundle.
 */
export function createSupabaseAdminClient(): SupabaseClient | null {
  const config = getSupabaseConfig();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!config || !secret) return null;
  return createClient(config.url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
