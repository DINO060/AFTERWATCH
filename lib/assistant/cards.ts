// Facts the assistant checked, sent with its answer so the app can show them as cards (poster,
// progress, next episode) instead of repeating them in the text. Types only.
import type { Kind } from '../watch';

/** A day (YYYY-MM-DD) and, when known, a time (HH:MM) in the member's time zone. */
export type LocalWhen = { date: string; time?: string };
export type StatusCard = {
  /** Media id for a title in the collection, catalog ref otherwise. */
  key: string;
  inCollection: boolean;
  title: string;
  kind: Kind;
  poster: string;
  /** airing | finished | upcoming | hiatus | cancelled | between seasons | unknown, or a source's words. */
  status: string;
  total: number | null;
  released: number | null;
  progress?: number;
  left?: number;
  next?: (LocalWhen & { episode: number }) | null;
  finale?: (LocalWhen & { estimated: boolean }) | null;
};
