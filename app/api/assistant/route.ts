import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { assertExpectedUser } from '@/lib/auth-owner';
import { langFromRequest, messages } from '@/lib/i18n';
import { sameOrigin, readState, aiEnv, errorResponse } from '@/lib/server';
import { AssistantFailure, converse, type Content } from '@/lib/assistant/gemini';
import { createToolbox, memberContext, toolDeclarations } from '@/lib/assistant/tools';
import { systemPrompt } from '@/lib/assistant/prompt';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store' };
const input = z.object({
  expectedUserId: z.string().uuid(),
  message: z.string().trim().min(1).max(2500),
  history: z
    .array(z.object({ role: z.enum(['user', 'model']), text: z.string().max(6000) }))
    .max(12)
    .optional(),
});

export async function POST(request: Request) {
  const started = Date.now();
  const lang = langFromRequest(request);
  const t = messages[lang].api;
  try {
    sameOrigin(request, t.sameOrigin);
    const { supabase, user } = await requireUser(lang);
    const raw = await request.text();
    if (raw.length > 100000) return Response.json({ error: t.messageTooLong }, { status: 413, headers });
    const body = input.parse(JSON.parse(raw));
    assertExpectedUser(body.expectedUserId, user.id, t.accountChanged);
    const key = aiEnv().GEMINI_API_KEY?.trim();
    if (!key) return Response.json({ error: t.assistantOff }, { status: 503, headers });
    // Daily allowance per member, counted in the database (the limit lives in the SQL function).
    const { data: remaining, error: quotaError } = await supabase.rpc('use_assistant_message');
    if (quotaError) {
      console.error('assistant_quota', quotaError.code);
      return Response.json({ error: t.assistantOff }, { status: 503, headers });
    }
    if (typeof remaining !== 'number' || remaining < 0)
      return Response.json({ error: t.assistantDailyLimit }, { status: 429, headers });

    const { state } = await readState(supabase, user.id);
    const zone = state.settings.timezone;
    const toolbox = createToolbox(state, lang, zone);
    const history = (body.history || []).slice(-10);
    while (history.length && history[0].role !== 'user') history.shift();
    const contents: Content[] = [
      ...history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      { role: 'user', parts: [{ text: body.message }] },
    ];
    const text = await converse({
      key,
      system: systemPrompt(lang, memberContext(state, lang, zone)),
      contents,
      tools: toolDeclarations,
      execute: toolbox.execute,
      deadline: started + 50000,
    });
    return Response.json({ text, ops: toolbox.ops, cards: toolbox.cards, remaining }, { headers });
  } catch (e) {
    if (e instanceof AssistantFailure) {
      const error =
        e.key === 'quota'
          ? t.assistantQuota
          : e.key === 'config'
            ? t.assistantOff
            : e.key === 'empty'
              ? t.assistantEmpty
              : t.assistantDown;
      return Response.json({ error }, { status: e.status, headers });
    }
    if (e instanceof Response || e instanceof z.ZodError || e instanceof SyntaxError)
      return errorResponse(e, lang);
    console.error('assistant_failed', e instanceof Error ? e.message.slice(0, 200) : 'unknown');
    return Response.json({ error: t.assistantFailed }, { status: 503, headers });
  }
}
