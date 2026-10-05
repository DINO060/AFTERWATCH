import type { SupabaseConfig } from '@/lib/supabase/config';

export type EnabledProviders = { google: boolean };

const ttlMs = 5 * 60 * 1000;
let cached: { until: number; value: EnabledProviders } | null = null;

/** Reads Supabase's public auth settings so a provider button appears as soon as it is enabled in the dashboard. */
export async function getEnabledProviders(config: SupabaseConfig): Promise<EnabledProviders> {
  if (cached && cached.until > Date.now()) return cached.value;
  try {
    const response = await fetch(`${config.url}/auth/v1/settings`, {
      headers: { apikey: config.publishableKey },
      signal: AbortSignal.timeout(3000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`settings ${response.status}`);
    const settings: { external?: Record<string, unknown> } = await response.json();
    const value = { google: settings.external?.google === true };
    cached = { until: Date.now() + ttlMs, value };
    return value;
  } catch {
    // Hide optional providers rather than show a button that would fail.
    return cached?.value ?? { google: false };
  }
}
