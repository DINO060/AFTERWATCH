import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from './config';

let browserClient: SupabaseClient | null = null;

export function createSupabaseBrowserClient(): SupabaseClient | null {
  if (typeof window === 'undefined') return null;
  const config = getSupabaseConfig();
  if (!config) return null;
  browserClient ??= createBrowserClient(config.url, config.publishableKey);
  return browserClient;
}
