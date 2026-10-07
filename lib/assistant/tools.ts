// The assistant's tools. Reads (catalog, release facts) run right away; changes are applied to a
// draft copy of the collection and returned as operations the member confirms. Server-only.
import { z } from 'zod';
import { browseCatalog, catalogDetail, tmdbEnabled } from '../catalog-server';
import { allFeeds, feedsFor, type Feed } from '../catalog-gateway';
import { mediaFromCatalog, sameTitle, type CatalogItem, type CatalogSource } from '../catalog';
import type { Lang } from '../i18n';
import { zoneOffset } from '../notify/plan';
import { catalogKinds, kindKeys, type CatalogKind, type Kind, type Media, type WatchState } from '../watch';
import { applyOps, patchMedia, type Op } from './ops';
import { nextEpisode, planSessions, toMinute, type LocalTime } from './planner';
import { titleStatus, type Release, type TitleStatus } from './sources';

const statuses = ['watching', 'later', 'paused', 'completed'] as const;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const mediaId = z.string().uuid();
const ref = z
  .string()
  .regex(/^(anime|manga|series|film):(jikan|kitsu|cinemeta|tvmaze|tmdb):[A-Za-z0-9]{1,20}$/);

const args = {
  search_catalog: z.object({ kind: z.enum(catalogKinds), query: z.string().trim().min(1).max(150) }),
  browse_catalog: z.object({ kind: z.enum(catalogKinds), feed: z.enum(allFeeds as [Feed, ...Feed[]]) }),
  title_status: z.object({
    titles: z
      .array(z.object({ media_id: mediaId.optional(), ref: ref.optional() }))
      .min(1)
      .max(8),
  }),
  add_titles: z.object({
    items: z
      .array(
        z.object({
          ref,
          status: z.enum(statuses).optional(),
          priority: z.boolean().optional(),
          progress: z.number().int().min(0).max(100000).optional(),
        }),
      )
      .min(1)
      .max(10),
  }),
  update_titles: z.object({
    items: z
      .array(
        z.object({
          media_id: mediaId,
          progress: z.number().int().min(0).max(100000).optional(),
          status: z.enum(statuses).optional(),
          priority: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(30),
  }),
  remove_titles: z.object({ media_ids: z.array(mediaId).min(1).max(30) }),
  plan_sessions: z.object({
    titles: z
      .array(
        z.object({
          media_id: mediaId,
          per_day: z.number().int().min(1).max(50).optional(),
          max_episodes: z.number().int().min(1).max(500).optional(),
        }),
      )
      .max(20)
      .optional(),
    start_date: day.optional(),
    days: z.number().int().min(1).max(28).optional(),
    daily_minutes: z.number().int().min(15).max(600).optional(),
    start_time: clock.optional(),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    replace: z.enum(['none', 'listed', 'all']).optional(),
  }),
  add_session: z.object({
    media_id: mediaId,
    date: day,
    time: clock,
    episodes: z.number().int().min(1).max(50),
  }),
  remove_sessions: z.object({
    session_ids: z.array(mediaId).max(200).optional(),
    media_id: mediaId.optional(),
    from_date: day.optional(),
    to_date: day.optional(),
  }),
};
export type ToolName = keyof typeof args;

const kindHelp =
  'anime, manga, manhwa (Korean comics), novel (light novels), film, or series (live-action TV).';
const titleRef = {
  type: 'object',
  properties: {
    media_id: { type: 'string', description: 'For a title in the collection.' },
    ref: { type: 'string', description: 'For a catalog result (from search_catalog or browse_catalog).' },
  },
};
/** Function declarations in the Gemini API format. Arguments are validated again when they run. */
export const toolDeclarations = [
  {
    name: 'search_catalog',
    description: 'Search the public catalog by title. Returns refs for add_titles and title_status.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...catalogKinds], description: kindHelp },
        query: { type: 'string', description: 'The title, in any language.' },
      },
      required: ['kind', 'query'],
    },
  },
  {
    name: 'browse_catalog',
    description:
      'Lists of the moment: new (just started), airing (on air now), upcoming, popular, top (best rated). Not every list exists for every kind.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...catalogKinds], description: kindHelp },
        feed: { type: 'string', enum: [...allFeeds] },
      },
      required: ['kind', 'feed'],
    },
  },
  {
    name: 'title_status',
    description:
      'Live release facts for up to 8 titles: airing or finished, total episodes, episodes out so far, next episode and its date, finale date (exact or estimated). For titles in the collection it also tells how many released episodes are left to watch.',
    parameters: {
      type: 'object',
      properties: { titles: { type: 'array', items: titleRef } },
      required: ['titles'],
    },
  },
  {
    name: 'add_titles',
    description:
      'Propose adding catalog titles to the collection. Default status: later (or watching when progress > 0).',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ref: { type: 'string' },
              status: { type: 'string', enum: [...statuses] },
              priority: { type: 'boolean' },
              progress: { type: 'integer', description: 'Episodes or chapters already watched or read.' },
            },
            required: ['ref'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'update_titles',
    description:
      'Propose changes to titles in the collection: progress (episodes or chapters done), status, priority.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              media_id: { type: 'string' },
              progress: { type: 'integer' },
              status: { type: 'string', enum: [...statuses] },
              priority: { type: 'boolean' },
            },
            required: ['media_id'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'remove_titles',
    description: 'Propose removing titles (and their sessions) from the collection.',
    parameters: {
      type: 'object',
      properties: { media_ids: { type: 'array', items: { type: 'string' } } },
      required: ['media_ids'],
    },
  },
  {
    name: 'plan_sessions',
    description:
      'Propose a schedule computed by the app: it places episodes day by day within the daily time, after the sessions already planned, and only once episodes are out. List titles in priority order (default: every unfinished title that is not paused, priorities first). Returns the sessions placed.',
    parameters: {
      type: 'object',
      properties: {
        titles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              media_id: { type: 'string' },
              per_day: { type: 'integer', description: 'Most episodes of this title per day.' },
              max_episodes: { type: 'integer', description: 'Most episodes of this title in this plan.' },
            },
            required: ['media_id'],
          },
        },
        start_date: { type: 'string', description: 'YYYY-MM-DD, default today.' },
        days: { type: 'integer', description: '1 to 28, default 7.' },
        daily_minutes: { type: 'integer', description: 'Default: the member setting.' },
        start_time: { type: 'string', description: 'HH:MM, default: the member setting.' },
        weekdays: {
          type: 'array',
          items: { type: 'integer' },
          description: '0 = Sunday … 6 = Saturday. Default: the member setting.',
        },
        replace: {
          type: 'string',
          enum: ['none', 'listed', 'all'],
          description:
            'Remove unfinished sessions from start_date on before planning: none (default), listed titles only, or all.',
        },
      },
    },
  },
  {
    name: 'add_session',
    description:
      'Propose one session at a given date and time; the app picks the next episodes of the title.',
    parameters: {
      type: 'object',
      properties: {
        media_id: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        time: { type: 'string', description: 'HH:MM' },
        episodes: { type: 'integer' },
      },
      required: ['media_id', 'date', 'time', 'episodes'],
    },
  },
  {
    name: 'remove_sessions',
    description:
      'Propose removing unfinished sessions: by session_ids, or by title and/or date range (from_date, to_date included).',
    parameters: {
      type: 'object',
      properties: {
        session_ids: { type: 'array', items: { type: 'string' } },
        media_id: { type: 'string' },
        from_date: { type: 'string', description: 'YYYY-MM-DD' },
        to_date: { type: 'string', description: 'YYYY-MM-DD' },
      },
    },
  },
];

/** The member's local date and minute of an instant. */
export function localTime(instant: number, zone: string): LocalTime {
  const local = new Date(instant + zoneOffset(instant, zone));
  return { date: local.toISOString().slice(0, 10), minute: local.getUTCHours() * 60 + local.getUTCMinutes() };
}
const pad = (n: number) => String(n).padStart(2, '0');
/** A ref already passed the `ref` pattern, so its parts are a kind, a source and an id. */
const parseRef = (value: string) => {
  const [kind, source, id] = value.split(':');
  return { kind: kind as Kind, catalog: { source: source as CatalogSource, id } };
};
const refOf = (item: CatalogItem) => `${item.kind}:${item.catalog.source}:${item.catalog.id}`;
const range = (from: number, to: number) => (to > from ? `${from}-${to}` : String(from));

export function createToolbox(initial: WatchState, lang: Lang, zone: string, now = Date.now()) {
  let draft = initial;
  const ops: Op[] = [];
  const statusCache = new Map<string, Promise<TitleStatus>>();
  const today = localTime(now, zone);
  const when = (r: Release) => {
    if (r.dateOnly) return new Date(r.at).toISOString().slice(0, 10);
    const t = localTime(r.at, zone);
    return `${t.date} ${pad(Math.floor(t.minute / 60))}:${pad(t.minute % 60)}`;
  };
  const propose = (op: Op) => {
    ops.push(op);
    draft = applyOps(draft, [op]);
  };
  const find = (id: string) => draft.media.find((m) => m.id === id);
  const statusOf = (key: string, target: Parameters<typeof titleStatus>[0]) => {
    if (!statusCache.has(key)) statusCache.set(key, titleStatus(target, lang));
    return statusCache.get(key)!;
  };
  const brief = (item: CatalogItem) => ({
    ref: refOf(item),
    title: item.title,
    year: item.catalog.year || undefined,
    format: item.catalog.format || undefined,
    status: item.catalog.releaseStatus || undefined,
    episodes: item.catalog.episodes ?? undefined,
    chapters: item.catalog.chapters ?? undefined,
    seasons: item.catalog.seasons ?? undefined,
    genres: item.catalog.genres.slice(0, 4),
    in_collection: draft.media.find((m) => sameTitle(m, item))?.id ?? null,
  });

  const run: { [K in ToolName]: (input: z.infer<(typeof args)[K]>) => Promise<unknown> } = {
    async search_catalog({ kind, query }) {
      const page = await browseCatalog(kind as CatalogKind, query, 1, 'popular', lang);
      return { results: page.results.slice(0, 6).map(brief) };
    },
    async browse_catalog({ kind, feed }) {
      if (!feedsFor(kind as CatalogKind, tmdbEnabled()).includes(feed))
        return { error: `The ${feed} list is not available for ${kind}.` };
      const page = await browseCatalog(kind as CatalogKind, '', 1, feed, lang);
      return { results: page.results.slice(0, 10).map(brief) };
    },
    async title_status({ titles }) {
      const answers = await Promise.all(
        titles.map(async (t) => {
          const media = t.media_id ? find(t.media_id) : undefined;
          if (t.media_id && !media) return { media_id: t.media_id, error: 'Not in the collection.' };
          if (!media && !t.ref) return { error: 'Give a media_id or a ref.' };
          const target = media
            ? { kind: media.kind, title: media.title, catalog: media.catalog }
            : { ...parseRef(t.ref!), title: '' };
          try {
            const s = await statusOf(media?.id || t.ref!, target);
            return {
              ...(media ? { media_id: media.id, progress: media.progress } : { ref: t.ref }),
              title: media?.title || s.title,
              status: s.status,
              total: s.total,
              released: s.released,
              left_to_watch:
                media && s.released !== null ? Math.max(0, s.released - media.progress) : undefined,
              next: s.next ? { episode: s.next.episode, when: when(s.next) } : null,
              finale: s.finale
                ? { episode: s.finale.episode, when: when(s.finale), estimated: s.finale.estimated }
                : null,
              started: s.started,
            };
          } catch {
            return { title: media?.title, error: 'Release source unavailable right now.' };
          }
        }),
      );
      return { titles: answers };
    },
    async add_titles({ items }) {
      const added = [];
      for (const item of items) {
        const {
          kind,
          catalog: { source, id },
        } = parseRef(item.ref);
        if (!kindKeys.includes(kind)) {
          added.push({ ref: item.ref, error: 'Unknown kind.' });
          continue;
        }
        try {
          const detail = await catalogDetail(kind, source, id, lang);
          const existing = draft.media.find((m) => sameTitle(m, detail));
          if (existing) {
            added.push({ ref: item.ref, media_id: existing.id, note: 'Already in the collection.' });
            continue;
          }
          const progress = item.progress ?? 0;
          const media = patchMedia(
            {
              ...mediaFromCatalog(detail),
              priority: item.priority ?? false,
              status: item.status ?? (progress > 0 ? 'watching' : 'later'),
            },
            { progress, status: item.status },
          );
          propose({ op: 'add', media });
          added.push({
            ref: item.ref,
            media_id: media.id,
            title: media.title,
            total: media.total,
            minutes: media.duration,
          });
        } catch {
          added.push({ ref: item.ref, error: 'Catalog unavailable for this title.' });
        }
      }
      return { added };
    },
    async update_titles({ items }) {
      const updated = [];
      for (const { media_id, ...patch } of items) {
        const media = find(media_id);
        if (!media) {
          updated.push({ media_id, error: 'Not in the collection.' });
          continue;
        }
        propose({ op: 'update', id: media_id, title: media.title, patch });
        const next = find(media_id)!;
        updated.push({ media_id, title: next.title, progress: next.progress, status: next.status });
      }
      return { updated };
    },
    async remove_titles({ media_ids }) {
      const removed = [];
      for (const id of media_ids) {
        const media = find(id);
        if (!media) continue;
        propose({ op: 'remove', id, title: media.title });
        removed.push(media.title);
      }
      return { removed };
    },
    async plan_sessions(input) {
      const start = input.start_date && input.start_date > today.date ? input.start_date : today.date;
      const listed = (input.titles || []).filter((t) => find(t.media_id));
      if (input.replace && input.replace !== 'none') {
        const ids = new Set(listed.map((t) => t.media_id));
        const stale = draft.sessions.filter(
          (s) => !s.done && s.date >= start && (input.replace === 'all' || ids.has(s.mediaId)),
        );
        if (stale.length) propose({ op: 'removeSessions', ids: stale.map((s) => s.id) });
      }
      // Release dates of airing titles, so new episodes are planned once they are out.
      const candidates: Media[] = listed.length
        ? listed.map((t) => find(t.media_id)!)
        : draft.media.filter((m) => m.status !== 'completed' && m.status !== 'paused');
      const airing: Record<string, Record<number, LocalTime>> = {};
      const released: Record<string, number> = {};
      await Promise.all(
        candidates
          .filter((m) => (m.kind === 'anime' || m.kind === 'series') && m.catalog)
          .slice(0, 8)
          .map(async (m) => {
            try {
              const s = await statusOf(m.id, { kind: m.kind, title: m.title, catalog: m.catalog });
              if (s.released !== null) released[m.id] = s.released;
              airing[m.id] = Object.fromEntries(
                s.upcoming.map((r) => [
                  r.episode,
                  r.dateOnly
                    ? { date: new Date(r.at).toISOString().slice(0, 10), minute: 1440 }
                    : localTime(r.at, zone),
                ]),
              );
            } catch {
              // Unknown: the planner falls back to the catalog counts.
            }
          }),
      );
      const sessions = planSessions(draft, {
        items: listed.map((t) => ({ mediaId: t.media_id, perDay: t.per_day, maxEpisodes: t.max_episodes })),
        startDate: start,
        days: input.days ?? 7,
        budget: input.daily_minutes ?? draft.settings.budget,
        time: input.start_time ?? draft.settings.time,
        weekdays: input.weekdays ?? draft.settings.days,
        now: today,
        airing,
        released,
      });
      if (!sessions.length)
        return {
          placed: 0,
          hint: 'Nothing fits: no free time left on those days, no episode out yet, or nothing left to watch.',
        };
      propose({ op: 'addSessions', sessions });
      return {
        placed: sessions.length,
        sessions: sessions.slice(0, 60).map((s) => ({
          date: s.date,
          time: s.time,
          title: find(s.mediaId)?.title,
          episodes: range(s.from, s.to),
          minutes: s.duration,
        })),
      };
    },
    async add_session({ media_id, date, time, episodes }) {
      const media = find(media_id);
      if (!media) return { error: 'Not in the collection.' };
      if (date < today.date) return { error: 'That date is in the past.' };
      const from = nextEpisode(draft, media);
      const to = media.total > 0 ? Math.min(media.total, from + episodes - 1) : from + episodes - 1;
      if (to < from) return { error: 'Every episode of this title is already watched or planned.' };
      const duration = (to - from + 1) * media.duration;
      if (toMinute(time) + duration > 1440) return { error: 'The session would run past midnight.' };
      const session = {
        id: crypto.randomUUID(),
        mediaId: media_id,
        date,
        time,
        from,
        to,
        duration,
        done: false,
      };
      propose({ op: 'addSessions', sessions: [session] });
      return { date, time, title: media.title, episodes: range(from, to), minutes: duration };
    },
    async remove_sessions({ session_ids, media_id, from_date, to_date }) {
      if (!session_ids?.length && !media_id && !from_date && !to_date)
        return { error: 'Say which sessions: ids, a title or dates.' };
      const ids = new Set(session_ids || []);
      const removed = draft.sessions.filter(
        (s) =>
          !s.done &&
          (!ids.size || ids.has(s.id)) &&
          (!media_id || s.mediaId === media_id) &&
          (!from_date || s.date >= from_date) &&
          (!to_date || s.date <= to_date),
      );
      if (removed.length) propose({ op: 'removeSessions', ids: removed.map((s) => s.id) });
      return { removed: removed.length };
    },
  };

  return {
    ops,
    get state() {
      return draft;
    },
    /** Runs one tool call; bad arguments come back as an error the model can correct. */
    async execute(name: string, input: unknown): Promise<unknown> {
      if (!(name in args)) return { error: `Unknown tool ${name}.` };
      const parsed = args[name as ToolName].safeParse(input ?? {});
      if (!parsed.success)
        return {
          error: 'Invalid arguments.',
          issues: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`),
        };
      try {
        return await (run[name as ToolName] as (i: unknown) => Promise<unknown>)(parsed.data);
      } catch {
        return { error: 'This source is unavailable right now. Try again later or continue without it.' };
      }
    },
  };
}

/** What the model knows about the member: settings, collection and upcoming sessions. */
export function memberContext(state: WatchState, lang: Lang, zone: string, now = Date.now()) {
  const t = localTime(now, zone);
  const titleOf = new Map(state.media.map((m) => [m.id, m.title]));
  return {
    today: t.date,
    weekday: new Date(t.date + 'T12:00:00Z').toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US', {
      weekday: 'long',
      timeZone: 'UTC',
    }),
    time: `${pad(Math.floor(t.minute / 60))}:${pad(t.minute % 60)}`,
    timezone: zone,
    settings: {
      daily_minutes: state.settings.budget,
      start_time: state.settings.time,
      weekdays: state.settings.days,
    },
    collection: state.media.slice(0, 150).map((m) => ({
      media_id: m.id,
      title: m.title,
      kind: m.kind,
      status: m.status,
      progress: m.progress,
      total: m.total || 'unknown',
      minutes: m.duration,
      priority: m.priority || undefined,
      release: m.catalog?.releaseStatus || undefined,
      genres: m.catalog?.genres.slice(0, 3),
    })),
    upcoming_sessions: state.sessions
      .filter((s) => !s.done && s.date >= t.date)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
      .slice(0, 80)
      .map((s) => ({
        session_id: s.id,
        media_id: s.mediaId,
        title: titleOf.get(s.mediaId),
        date: s.date,
        time: s.time,
        episodes: range(s.from, s.to),
        minutes: s.duration,
      })),
  };
}
