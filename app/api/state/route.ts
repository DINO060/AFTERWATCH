import { requireUser } from '@/lib/auth';
import { assertExpectedUser } from '@/lib/auth-owner';
import { langFromRequest, messages } from '@/lib/i18n';
import { sameOrigin, stateSchema, readState, saveState, errorResponse, aiEnv } from '@/lib/server';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request) {
  const lang = langFromRequest(request);
  try {
    const { supabase, user } = await requireUser(lang);
    return Response.json(
      { ...(await readState(supabase, user.id)), userId: user.id, aiReady: !!aiEnv().GEMINI_API_KEY },
      { headers },
    );
  } catch (e) {
    return errorResponse(e, lang);
  }
}
export async function PUT(request: Request) {
  const lang = langFromRequest(request);
  const t = messages[lang].api;
  try {
    sameOrigin(request, t.sameOrigin);
    const { supabase, user } = await requireUser(lang);
    const raw = await request.text();
    if (raw.length > 2000000) return Response.json({ error: t.collectionTooLarge }, { status: 413, headers });
    const body = JSON.parse(raw);
    if (body === null || typeof body !== 'object' || Array.isArray(body))
      return Response.json({ error: t.invalid }, { status: 400, headers });
    assertExpectedUser(body.expectedUserId, user.id, t.accountChanged);
    const state = stateSchema.parse(body.state);
    const revision = body.revision;
    if (!Number.isSafeInteger(revision) || revision < 0)
      return Response.json({ error: t.invalidRevision }, { status: 400, headers });
    const savedRevision = await saveState(supabase, state, revision);
    if (savedRevision === null) return Response.json({ error: t.conflict }, { status: 409, headers });
    return Response.json({ revision: savedRevision }, { headers });
  } catch (e) {
    return errorResponse(e, lang);
  }
}
