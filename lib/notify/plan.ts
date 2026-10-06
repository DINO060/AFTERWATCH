// What is due between two runs of the notification job. Pure and dependency-free (type imports
// only) so the tests can load it directly.
import type { Media, Session, WatchState } from '../watch';

const MINUTE = 60 * 1000;

/** Offset of `timeZone` at `instant`, in ms (local wall clock = UTC + offset). */
export function zoneOffset(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return wall - Math.floor(instant / 1000) * 1000;
}

/** UTC instant of a local date (YYYY-MM-DD) and time (HH:MM) in `timeZone`. */
export function zonedInstant(date: string, time: string, timeZone: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes settle the offset across daylight-saving changes.
  const first = wall - zoneOffset(wall, timeZone);
  return wall - zoneOffset(first, timeZone);
}

/** Local calendar date and weekday (0 = Sunday) of `instant` in `timeZone`. */
export function zonedDay(instant: number, timeZone: string): { date: string; weekday: number } {
  const local = new Date(instant + zoneOffset(instant, timeZone));
  return { date: local.toISOString().slice(0, 10), weekday: local.getUTCDay() };
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Start of the window to process: the last run, but never more than an hour back (a missed run is skipped, not replayed). */
export function windowStart(lastRun: number | null, now: number, interval = 10 * MINUTE): number {
  const earliest = now - 60 * MINUTE;
  return Math.max(lastRun ?? now - interval, earliest);
}

export type DueReminder = { session: Session; media: Media; ref: string };

/** Unfinished sessions that start in (since, now] in the member's time zone. */
export function dueReminders(state: WatchState, since: number, now: number): DueReminder[] {
  const zone = state.settings.timezone;
  return state.sessions.flatMap((session) => {
    if (session.done) return [];
    const media = state.media.find((m) => m.id === session.mediaId);
    const at = zonedInstant(session.date, session.time, zone);
    return media && at > since && at <= now
      ? [{ session, media, ref: `session:${session.id}:${session.date}T${session.time}` }]
      : [];
  });
}

export const WEEKLY_TIME = '09:00';

/** The Monday (local date) whose 09:00 falls in (since, now], or null. */
export function weeklyDue(timeZone: string, since: number, now: number): string | null {
  const { date, weekday } = zonedDay(now, timeZone);
  const monday = addDays(date, -((weekday + 6) % 7));
  const at = zonedInstant(monday, WEEKLY_TIME, timeZone);
  return at > since && at <= now ? monday : null;
}

/** Sessions of the week starting on `monday`, in order. */
export function weekSessions(state: WatchState, monday: string): { session: Session; media: Media }[] {
  const end = addDays(monday, 6);
  return state.sessions
    .filter((s) => s.date >= monday && s.date <= end)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
    .flatMap((session) => {
      const media = state.media.find((m) => m.id === session.mediaId);
      return media ? [{ session, media }] : [];
    });
}

/** Catalog key used to match aired episodes: MyAnimeList for anime, TMDB or TVmaze for series. */
export function episodeKey(media: Media, malIdOfKitsu: (kitsuId: string) => number | null): string | null {
  const c = media.catalog;
  // Finished or paused titles do not get episode alerts.
  if (!c || media.status === 'completed' || media.status === 'paused') return null;
  if (media.kind === 'anime') {
    if (c.source === 'jikan') return `mal:${c.id}`;
    if (c.source === 'kitsu') {
      const mal = malIdOfKitsu(c.id);
      return mal ? `mal:${mal}` : null;
    }
    return null;
  }
  if (media.kind === 'series' && (c.source === 'tmdb' || c.source === 'tvmaze')) return `${c.source}:${c.id}`;
  return null;
}

export type AiredEpisode = { key: string; episode: number; season: number | null };

/** New episodes for titles in this member's list, with a stable reference for de-duplication. */
export function episodesFor(
  state: WatchState,
  aired: Map<string, AiredEpisode[]>,
  malIdOfKitsu: (kitsuId: string) => number | null,
): { media: Media; episode: AiredEpisode; ref: string }[] {
  return state.media.flatMap((media) => {
    const key = episodeKey(media, malIdOfKitsu);
    if (!key) return [];
    return (aired.get(key) || []).map((episode) => ({
      media,
      episode,
      ref: `ep:${key}:${episode.season ?? 0}x${episode.episode}`,
    }));
  });
}
