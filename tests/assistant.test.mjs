import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOps, patchMedia } from '../lib/assistant/ops.ts';
import { planSessions, nextEpisode } from '../lib/assistant/planner.ts';

const media = (over = {}) => ({
  id: 'a',
  title: 'Frieren',
  kind: 'anime',
  priority: false,
  status: 'watching',
  progress: 0,
  total: 28,
  duration: 24,
  poster: '',
  sourceUrl: '',
  notes: '',
  ...over,
});
const session = (over = {}) => ({
  id: 's1',
  mediaId: 'a',
  date: '2026-10-08',
  time: '21:00',
  from: 1,
  to: 2,
  duration: 48,
  done: false,
  ...over,
});
const state = (items = [media()], sessions = [], settings = {}) => ({
  media: items,
  sessions,
  settings: {
    budget: 60,
    time: '21:00',
    days: [0, 1, 2, 3, 4, 5, 6],
    reminders: true,
    timezone: 'Europe/Paris',
    ...settings,
  },
});
let n = 0;
const ids = () => `id${++n}`;
const request = (over = {}) => ({
  items: [],
  startDate: '2026-10-08',
  days: 3,
  budget: 60,
  time: '21:00',
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  now: { date: '2026-10-08', minute: 600 },
  ...over,
});
const brief = (sessions) => sessions.map((s) => `${s.date} ${s.time} ${s.mediaId} ${s.from}-${s.to}`);

test('progress stays within the total, and reaching it completes the title', () => {
  assert.deepEqual(
    [patchMedia(media(), { progress: 40 }).progress, patchMedia(media(), { progress: 40 }).status],
    [28, 'completed'],
  );
  assert.equal(
    patchMedia(media(), { status: 'completed' }).progress,
    28,
    'completed means watched to the end',
  );
  assert.equal(patchMedia(media({ status: 'completed', progress: 28 }), { progress: 10 }).status, 'watching');
  assert.equal(patchMedia(media({ total: 0 }), { progress: 500 }).progress, 500, 'unknown total');
});

test('operations apply in order and skip what no longer fits', () => {
  const start = state([media()], [session(), session({ id: 's2', from: 3, to: 4, date: '2026-10-09' })]);
  const added = media({ id: 'b', title: 'Dandadan', total: 12 });
  const next = applyOps(start, [
    { op: 'add', media: added },
    { op: 'add', media: media({ id: 'c', title: 'frieren ' }) },
    { op: 'update', id: 'a', title: 'Frieren', patch: { progress: 2, priority: true } },
    { op: 'update', id: 'gone', title: 'Gone', patch: { progress: 1 } },
    {
      op: 'addSessions',
      sessions: [
        session({ id: 's3', mediaId: 'b', from: 1, to: 2 }),
        session({ id: 's4', mediaId: 'b', from: 12, to: 13 }),
        session({ id: 's5', mediaId: 'missing' }),
      ],
    },
    { op: 'removeSessions', ids: ['s2'] },
  ]);
  assert.deepEqual(
    next.media.map((m) => m.id),
    ['a', 'b'],
    'the same title twice is added once',
  );
  assert.equal(next.media[0].priority, true);
  assert.deepEqual(
    next.sessions.map((s) => [s.id, s.done]),
    [
      ['s1', true],
      ['s3', false],
    ],
    'watched sessions are done; impossible ones are skipped',
  );
  const removed = applyOps(next, [{ op: 'remove', id: 'b', title: 'Dandadan' }]);
  assert.deepEqual(
    removed.sessions.map((s) => s.id),
    ['s1'],
    'removing a title removes its sessions',
  );
});

test('plans continue after the progress and the sessions already planned', () => {
  const s = state([media({ progress: 3 })], [session({ from: 4, to: 5 })]);
  assert.equal(nextEpisode(s, s.media[0]), 6);
});

test('titles share the evening one episode at a time, in priority order', () => {
  const s = state([media(), media({ id: 'b', title: 'Dandadan', total: 12 })]);
  const plan = planSessions(s, request({ items: [{ mediaId: 'b' }, { mediaId: 'a' }], days: 2 }), ids);
  assert.deepEqual(brief(plan), [
    '2026-10-08 21:00 b 1-1',
    '2026-10-08 21:24 a 1-1',
    '2026-10-09 21:00 b 2-2',
    '2026-10-09 21:24 a 2-2',
  ]);
});

test('per-day caps and episode limits are respected', () => {
  const s = state([media(), media({ id: 'b', title: 'Dandadan', total: 12, duration: 10 })]);
  const plan = planSessions(
    s,
    request({
      items: [
        { mediaId: 'a', perDay: 1 },
        { mediaId: 'b', maxEpisodes: 4 },
      ],
      days: 2,
    }),
    ids,
  );
  assert.deepEqual(brief(plan), [
    '2026-10-08 21:00 a 1-1',
    '2026-10-08 21:24 b 1-3',
    '2026-10-09 21:00 a 2-2',
    '2026-10-09 21:24 b 4-4',
  ]);
});

test('new episodes are planned only once they are out', () => {
  const s = state([media({ progress: 3, total: 12 })]);
  const plan = planSessions(
    s,
    request({
      days: 4,
      released: { a: 5 },
      airing: {
        a: { 6: { date: '2026-10-10', minute: 18 * 60 }, 7: { date: '2026-10-17', minute: 18 * 60 } },
      },
    }),
    ids,
  );
  assert.deepEqual(brief(plan), ['2026-10-08 21:00 a 4-5', '2026-10-10 21:00 a 6-6']);
});

test('nothing is placed in the past, after existing sessions, or on days off', () => {
  const s = state([media()], [session({ id: 'x', date: '2026-10-09', from: 1, to: 1, duration: 24 })]);
  const plan = planSessions(
    s,
    request({
      now: { date: '2026-10-08', minute: 21 * 60 + 32 },
      days: 3,
      weekdays: [4, 5],
    }),
    ids,
  );
  assert.deepEqual(brief(plan), ['2026-10-08 21:40 a 2-3', '2026-10-09 21:24 a 4-4']);
});

test('a film longer than the daily time takes a free evening', () => {
  const s = state([media({ kind: 'film', title: 'Dune', total: 1, duration: 155 })]);
  const plan = planSessions(s, request({ days: 2 }), ids);
  assert.deepEqual(brief(plan), ['2026-10-08 21:00 a 1-1']);
  assert.equal(plan[0].duration, 155);
});

test('with an unknown count only the next episode is planned, unless a limit is given', () => {
  const s = state([media({ total: 0, progress: 10, kind: 'manga', duration: 10 })]);
  assert.deepEqual(brief(planSessions(s, request(), ids)), ['2026-10-08 21:00 a 11-11']);
  assert.deepEqual(brief(planSessions(s, request({ items: [{ mediaId: 'a', maxEpisodes: 8 }] }), ids)), [
    '2026-10-08 21:00 a 11-16',
    '2026-10-09 21:00 a 17-18',
  ]);
});

test('paused and finished titles are left out unless listed', () => {
  const s = state([media({ status: 'paused' }), media({ id: 'b', status: 'completed', progress: 28 })]);
  assert.equal(planSessions(s, request(), ids).length, 0);
  assert.equal(planSessions(s, request({ items: [{ mediaId: 'a' }] }), ids).length > 0, true);
});
