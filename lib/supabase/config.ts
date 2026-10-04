export type SupabaseConfig = { url: string; publishableKey: string };

/** Public configuration only; never use a service-role key in these clients. */
export function getSupabaseConfig(): SupabaseConfig | null {
  // Explicit accesses let Next.js replace these variables in browser bundles.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return null;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  } catch {
    return null;
  }
  return { url, publishableKey };
}

export function getTelegramProvider(): `custom:${string}` | null {
  const provider = process.env.NEXT_PUBLIC_TELEGRAM_AUTH_PROVIDER?.trim();
  if (!provider?.startsWith('custom:') || !/^custom:[a-z0-9:-]+$/.test(provider) || provider.length > 50) return null;
  return provider as `custom:${string}`;
}
