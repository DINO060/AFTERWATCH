import { requireUser } from '@/lib/auth';
import { getEnabledProviders } from '@/lib/auth-providers';
import { cleanDisplayName } from '@/lib/display-name';
import { langFromRequest, messages } from '@/lib/i18n';
import { getSupabaseConfig, getTelegramProvider } from '@/lib/supabase/config';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  const lang = langFromRequest(request);
  const t = messages[lang].api;
  const config = getSupabaseConfig();
  const configured = Boolean(config);
  const telegramProvider = getTelegramProvider();
  const telegramEnabled = configured && Boolean(telegramProvider);
  if (!config)
    return Response.json({ user: null, configured, telegramEnabled, googleEnabled: false }, { headers });
  // Started now so it runs alongside the session check; it never rejects.
  const providers = getEnabledProviders(config);

  try {
    const [{ user }, { google: googleEnabled }] = await Promise.all([requireUser(lang), providers]);
    const metadata = user.user_metadata;
    // display_name is the one the member chose in Afterwatch; provider names (Google…) come after.
    const name = [
      metadata.display_name,
      metadata.full_name,
      metadata.name,
      metadata.preferred_username,
      metadata.username,
    ]
      .map(cleanDisplayName)
      .find(Boolean);
    return Response.json(
      {
        user: {
          id: user.id,
          email: user.email || null,
          displayName: name || cleanDisplayName(user.email?.split('@')[0]) || t.memberFallback,
          telegramLinked: Boolean(
            telegramProvider && user.identities?.some((identity) => identity.provider === telegramProvider),
          ),
        },
        configured,
        telegramEnabled,
        googleEnabled,
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof Response && error.status === 401) {
      return Response.json(
        { user: null, configured, telegramEnabled, googleEnabled: (await providers).google },
        { headers },
      );
    }
    if (error instanceof Response) return error;
    return Response.json({ error: t.verifyFailed }, { status: 503, headers });
  }
}
