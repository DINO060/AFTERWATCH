// The assistant chooses what to watch and in which order; this code places the sessions, so dates,
// times and episode numbers are always right. Pure and dependency-free (type imports only).
import type { Media, Session, WatchState } from '../watch';

/** A local moment in the member's time zone. */
export type LocalTime = { date: string; minute: number };
export type PlanItem = { mediaId: string; perDay?: number; maxEpisodes?: number };
export type PlanRequest = {
  /** In priority order. Empty: every unfinished title that is not paused, priorities first. */
  items: PlanItem[];
  startDate: string;
  days: number;
  /** Minutes per day, including sessions already planned that day. */
  budget: number;
  /** Earliest start of a day's first session (HH:MM). */
  time: string;
  /** Days that can hold sessions (0 = Sunday). */
  weekdays: number[];
  /** Nothing is placed before this moment. */
  now: LocalTime;
  /** Release moment of upcoming episodes, by media id then episode number. */
  airing?: Record<string, Record<number, LocalTime>>;
  /** Episodes (or chapters) already out, by media id, when a source knows it. */
  released?: Record<string, number>;
};

export const toMinute = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};
export const fromMinute = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export function addDays(date: string, days: number): string {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const weekday = (date: string) => new Date(date + 'T12:00:00Z').getUTCDay();

/** The next episode to plan for a title: after its progress and after sessions already planned. */
export function nextEpisode(state: WatchState, m: Media): number {
  return Math.max(m.progress, ...state.sessions.filter((s) => s.mediaId === m.id).map((s) => s.to)) + 1;
}

export function planSessions(
  state: WatchState,
  request: PlanRequest,
  newId: () => string = () => crypto.randomUUID(),
): Session[] {
  const unfinished = (m: Media) => m.status !== 'completed' && (m.total === 0 || m.progress < m.total);
  const titles: { media: Media; perDay: number; max: number }[] = [];
  const listed: PlanItem[] = request.items.length
    ? request.items
    : state.media
        .filter((m) => unfinished(m) && m.status !== 'paused')
        .sort((a, b) => Number(b.priority) - Number(a.priority) || a.title.localeCompare(b.title))
        .map((m) => ({ mediaId: m.id }));
  for (const item of listed) {
    const media = state.media.find((m) => m.id === item.mediaId);
    if (!media || !unfinished(media) || titles.some((t) => t.media.id === media.id)) continue;
    titles.push({
      media,
      perDay: item.perDay && item.perDay > 0 ? item.perDay : Infinity,
      max: item.maxEpisodes && item.maxEpisodes > 0 ? item.maxEpisodes : Infinity,
    });
  }
  const next = new Map(titles.map((t) => [t.media.id, nextEpisode(state, t.media)]));
  const planned = new Map<string, number>();
  const dayStart = toMinute(request.time);

  /** Whether episode `e` of `m` is out by the start of the evening of `date`. */
  const available = (m: Media, e: number, limited: boolean, date: string, minute: number) => {
    if (m.total > 0 && e > m.total) return false;
    const released = request.released?.[m.id] ?? m.catalog?.available ?? null;
    if (released !== null && e <= released) return true;
    const airs = request.airing?.[m.id]?.[e];
    if (airs) return airs.date < date || (airs.date === date && airs.minute <= minute);
    if (released !== null) return false;
    // Unknown count: only the next episode, unless the assistant set how many to plan.
    return m.total > 0 || limited || e === m.progress + 1;
  };

  const result: Session[] = [];
  const days = Math.max(1, Math.min(28, Math.trunc(request.days)));
  for (let d = 0; d < days; d++) {
    const date = addDays(request.startDate, d);
    if (date < request.now.date || !request.weekdays.includes(weekday(date))) continue;
    const existing = state.sessions.filter((s) => s.date === date);
    let start = Math.max(dayStart, ...existing.map((s) => toMinute(s.time) + s.duration));
    if (date === request.now.date) start = Math.max(start, Math.ceil((request.now.minute + 5) / 5) * 5);
    const used = existing.reduce((n, s) => n + s.duration, 0);
    let room = Math.min(request.budget - used, 1440 - start);
    if (room <= 0) continue;
    // Round robin, one episode at a time, so several titles share the evening.
    const counts = new Map<string, number>();
    let added = true;
    while (added) {
      added = false;
      for (const { media: m, perDay, max } of titles) {
        const count = counts.get(m.id) || 0;
        if (count >= perDay || (planned.get(m.id) || 0) + count >= max) continue;
        const fits =
          m.duration <= room ||
          // A film longer than the daily time can still take a whole free evening.
          (!existing.length && !counts.size && room === request.budget && m.duration <= 1440 - start);
        if (!fits || !available(m, next.get(m.id)! + count, Number.isFinite(max), date, start)) continue;
        counts.set(m.id, count + 1);
        room -= m.duration;
        added = true;
      }
    }
    // One session per title and day, in priority order.
    let minute = start;
    for (const { media: m } of titles) {
      const count = counts.get(m.id);
      if (!count) continue;
      const from = next.get(m.id)!;
      result.push({
        id: newId(),
        mediaId: m.id,
        date,
        time: fromMinute(minute),
        from,
        to: from + count - 1,
        duration: count * m.duration,
        done: false,
      });
      next.set(m.id, from + count);
      planned.set(m.id, (planned.get(m.id) || 0) + count);
      minute += count * m.duration;
    }
  }
  return result;
}
