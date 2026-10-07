// Changes the assistant proposes. The server builds them on a draft copy of the collection; the
// browser applies them to the latest collection when the member taps Apply. Pure and
// dependency-free (type imports only) so the client, the server and the tests share it.
import type { Media, Session, WatchState } from '../watch';

export type MediaPatch = Partial<Pick<Media, 'progress' | 'status' | 'priority'>>;
export type Op =
  | { op: 'add'; media: Media }
  | { op: 'update'; id: string; title: string; patch: MediaPatch }
  | { op: 'remove'; id: string; title: string }
  | { op: 'addSessions'; sessions: Session[] }
  | { op: 'removeSessions'; ids: string[] };

const MAX_MEDIA = 1000;
const MAX_SESSIONS = 5000;
const sameMedia = (a: Media, b: Media) =>
  a.kind === b.kind &&
  ((!!a.catalog && a.catalog.source === b.catalog?.source && a.catalog.id === b.catalog?.id) ||
    a.title.trim().toLocaleLowerCase() === b.title.trim().toLocaleLowerCase());

/** A media with the patch applied, keeping the collection's rules (progress within the total). */
export function patchMedia(m: Media, patch: MediaPatch): Media {
  let progress = patch.progress ?? m.progress;
  let status = patch.status ?? m.status;
  progress = Math.max(0, Math.min(Math.trunc(progress), m.total > 0 ? m.total : 100000));
  if (m.total > 0 && patch.status === 'completed' && patch.progress === undefined) progress = m.total;
  if (m.total > 0 && progress >= m.total) status = 'completed';
  else if (status === 'completed' && m.total > 0) status = 'watching';
  return { ...m, progress, status, priority: patch.priority ?? m.priority };
}

/**
 * Applies the operations in order. An operation that no longer fits (a title removed meanwhile,
 * a duplicate, a session past the end of its title) is skipped instead of failing the rest.
 */
export function applyOps(state: WatchState, ops: Op[]): WatchState {
  let media = [...state.media];
  let sessions = [...state.sessions];
  for (const op of ops) {
    if (op.op === 'add') {
      if (media.length >= MAX_MEDIA || media.some((m) => m.id === op.media.id || sameMedia(m, op.media)))
        continue;
      media.push(op.media);
    } else if (op.op === 'update') {
      const index = media.findIndex((m) => m.id === op.id);
      if (index < 0) continue;
      const next = patchMedia(media[index], op.patch);
      media[index] = next;
      // Episodes now behind the progress count as watched.
      sessions = sessions.map((s) =>
        s.mediaId === next.id && s.to <= next.progress ? { ...s, done: true } : s,
      );
    } else if (op.op === 'remove') {
      media = media.filter((m) => m.id !== op.id);
      sessions = sessions.filter((s) => s.mediaId !== op.id);
    } else if (op.op === 'addSessions') {
      for (const s of op.sessions) {
        const m = media.find((x) => x.id === s.mediaId);
        if (
          !m ||
          sessions.length >= MAX_SESSIONS ||
          sessions.some((x) => x.id === s.id) ||
          s.from < 1 ||
          s.to < s.from ||
          (m.total > 0 && s.to > m.total)
        )
          continue;
        sessions.push(s);
      }
    } else if (op.op === 'removeSessions') {
      const ids = new Set(op.ids);
      sessions = sessions.filter((s) => !ids.has(s.id));
    }
  }
  return { ...state, media, sessions };
}
