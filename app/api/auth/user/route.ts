import { requireUser } from '@/lib/auth';
import { getSupabaseConfig, getTelegramProvider } from '@/lib/supabase/config';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET() {
  const configured = Boolean(getSupabaseConfig());
  const telegramProvider = getTelegramProvider();
  const telegramEnabled = configured && Boolean(telegramProvider);
  if (!configured) return Response.json({ user: null, configured, telegramEnabled }, { headers });

  try {
    const { user } = await requireUser();
    const metadata = user.user_metadata;
    const name = [metadata.full_name, metadata.name, metadata.display_name, metadata.preferred_username, metadata.username]
      .find((value) => typeof value === 'string' && value.trim());
    return Response.json({
      user: {
        id: user.id,
        email: user.email || null,
        displayName: typeof name === 'string' ? name : user.email?.split('@')[0] || 'Membre Afterwatch',
        telegramLinked: Boolean(telegramProvider && user.identities?.some((identity) => identity.provider === telegramProvider)),
      },
      configured,
      telegramEnabled,
    }, { headers });
  } catch (error) {
    if (error instanceof Response && error.status === 401) {
      return Response.json({ user: null, configured, telegramEnabled }, { headers });
    }
    if (error instanceof Response) return error;
    return Response.json({ error: 'Impossible de vérifier ta connexion.' }, { status: 503, headers });
  }
}
