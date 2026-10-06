import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { messages, type Lang } from './i18n';
import { defaults, type WatchState } from './watch';
export { assertSameOrigin as sameOrigin } from './auth-origin';
// Custom issues carry a key of messages.*.api.validation, translated by errorResponse.
type ValidationKey = keyof (typeof messages)['fr']['api']['validation'];
const issue = (key: ValidationKey) => key;
const imageUrl = z
  .string()
  .max(2000)
  .refine(
    (s) =>
      !s ||
      /^https:\/\/(media\.kitsu\.app|media\.kitsu\.io|cdn\.myanimelist\.net|static\.tvmaze\.com|images\.metahub\.space|m\.media-amazon\.com|image\.tmdb\.org)\//.test(
        s,
      ),
  );
const sourceUrl = z
  .string()
  .max(2000)
  .refine(
    (s) =>
      !s ||
      /^https:\/\/(kitsu\.app|kitsu\.io|myanimelist\.net|www\.tvmaze\.com|www\.imdb\.com|www\.themoviedb\.org)\//.test(
        s,
      ),
  );
const mediaSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(180),
    kind: z.enum(['anime', 'manga', 'series', 'film']),
    priority: z.boolean(),
    status: z.enum(['watching', 'later', 'paused', 'completed']),
    progress: z.number().int().min(0).max(100000),
    total: z.number().int().min(0).max(100000),
    duration: z.number().int().min(1).max(600),
    poster: imageUrl,
    sourceUrl,
    notes: z.string().max(2000),
    catalog: z
      .object({
        source: z.enum(['jikan', 'kitsu', 'cinemeta', 'tvmaze', 'tmdb']),
        id: z.string().max(50),
        synopsis: z.string().max(12000),
        genres: z.array(z.string().max(100)).max(20),
        year: z.string().max(40),
        score: z.number().min(0).max(10).nullable(),
        episodes: z.number().int().min(0).max(100000).nullable(),
        chapters: z.number().int().min(0).max(100000).nullable(),
        volumes: z.number().int().min(0).max(100000).nullable(),
        seasons: z.number().int().min(0).max(10000).nullable(),
        available: z.number().int().min(0).max(100000).nullable(),
        releaseStatus: z.string().max(100),
        format: z.string().max(100),
        durationKnown: z.boolean(),
      })
      .optional(),
  })
  .refine((m) => m.total === 0 || m.progress <= m.total, { message: issue('progressOverTotal') });
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  });
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const stateSchema = z
  .object({
    media: z.array(mediaSchema).max(1000),
    sessions: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            mediaId: z.string().uuid(),
            date,
            time,
            from: z.number().int().min(1).max(100000),
            to: z.number().int().min(1).max(100000),
            duration: z.number().int().min(1).max(1440),
            done: z.boolean(),
          })
          .refine((s) => s.to >= s.from),
      )
      .max(5000),
    settings: z.object({
      budget: z.number().int().min(15).max(600),
      time,
      days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
      reminders: z.boolean(),
      timezone: z
        .string()
        .max(100)
        .refine((s) => {
          try {
            new Intl.DateTimeFormat('fr', { timeZone: s });
            return true;
          } catch {
            return false;
          }
        }),
    }),
  })
  .superRefine((s, ctx) => {
    if (
      new Set(s.media.map((m) => m.id)).size !== s.media.length ||
      new Set(s.sessions.map((m) => m.id)).size !== s.sessions.length
    )
      ctx.addIssue({ code: 'custom', message: issue('duplicateId') });
    for (const session of s.sessions) {
      const m = s.media.find((x) => x.id === session.mediaId);
      if (!m || (m.total > 0 && session.to > m.total))
        ctx.addIssue({ code: 'custom', message: issue('sessionMismatch') });
    }
  });
export async function readState(
  supabase: SupabaseClient,
  id: string,
): Promise<{ state: WatchState; revision: number }> {
  const { data, error } = await supabase
    .from('watch_states')
    .select('data,revision')
    .eq('user_id', id)
    .maybeSingle();
  if (error) throw new Error('Collection read failed');
  return data
    ? { state: stateSchema.parse(data.data), revision: data.revision }
    : { state: defaults, revision: 0 };
}
export async function saveState(
  supabase: SupabaseClient,
  state: WatchState,
  revision: number,
): Promise<number | null> {
  const { data, error } = await supabase.rpc('save_watch_state', { p_state: state, p_revision: revision });
  if (error) throw new Error('Collection save failed');
  return data;
}
export function errorResponse(e: unknown, lang: Lang) {
  const headers = { 'Cache-Control': 'private, no-store' };
  const t = messages[lang].api;
  if (e instanceof Response) {
    e.headers.set('Cache-Control', 'private, no-store');
    return e;
  }
  if (e instanceof z.ZodError) {
    // Zod's built-in messages are English-only; show our own text or a generic one.
    const key = e.issues[0]?.message;
    const error = key && key in t.validation ? t.validation[key as ValidationKey] : t.invalid;
    return Response.json({ error }, { status: 400, headers });
  }
  if (e instanceof SyntaxError) return Response.json({ error: t.invalid }, { status: 400, headers });
  console.error('Afterwatch operation failed', e instanceof Error ? e.message : 'unknown');
  return Response.json({ error: t.saveUnavailable }, { status: 503, headers });
}
export const aiEnv = () => ({ GEMINI_API_KEY: process.env.GEMINI_API_KEY });
