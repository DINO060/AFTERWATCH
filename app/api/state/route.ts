import { requireUser } from '@/lib/auth';
import { assertExpectedUser } from '@/lib/auth-owner';
import { sameOrigin, stateSchema, readState, saveState, errorResponse, aiEnv } from '@/lib/server';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    return Response.json(
      { ...(await readState(supabase, user.id)), userId: user.id, aiReady: !!aiEnv().GEMINI_API_KEY },
      { headers },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function PUT(request: Request) {
  try {
    sameOrigin(request);
    const { supabase, user } = await requireUser();
    const raw = await request.text();
    if (raw.length > 2000000)
      return Response.json({ error: 'Collection trop volumineuse.' }, { status: 413, headers });
    const body = JSON.parse(raw);
    if (body === null || typeof body !== 'object' || Array.isArray(body))
      return Response.json({ error: 'Informations invalides.' }, { status: 400, headers });
    assertExpectedUser(body.expectedUserId, user.id);
    const state = stateSchema.parse(body.state);
    const revision = body.revision;
    if (!Number.isSafeInteger(revision) || revision < 0)
      return Response.json({ error: 'Version invalide.' }, { status: 400, headers });
    const savedRevision = await saveState(supabase, state, revision);
    if (savedRevision === null)
      return Response.json(
        { error: 'La collection a changé sur un autre appareil. Recharge avant de réessayer.' },
        { status: 409, headers },
      );
    return Response.json({ revision: savedRevision }, { headers });
  } catch (e) {
    return errorResponse(e);
  }
}
