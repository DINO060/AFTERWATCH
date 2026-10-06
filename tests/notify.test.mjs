import test from 'node:test';
import assert from 'node:assert/strict';
import {
  zonedInstant,
  zonedDay,
  windowStart,
  dueReminders,
  weeklyDue,
  weekSessions,
  episodesFor,
} from '../lib/notify/plan.ts';

const iso = (ms) => new Date(ms).toISOString();
const media = (over = {}) => ({
  id: 'm1',
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
  catalog: { source: 'jikan', id: '52991' },
  ...over,
});
const state = (sessions, zone = 'America/New_York', items = [media()]) => ({
  media: items,
  sessions,
  settings: { budget: 60, time: '21:00', days: [0, 1, 2, 3, 4, 5, 6], reminders: true, timezone: zone },
});
const session = (over = {}) => ({
  id: 's1',
  mediaId: 'm1',
  date: '2026-10-06',
  time: '21:00',
  from: 1,
  to: 2,
  duration: 48,
  done: false,
  ...over,
});

test('local times convert to the right instant, across daylight-saving changes', () => {
  assert.equal(iso(zonedInstant('2026-10-06', '21:00', 'America/New_York')), '2026-10-07T01:00:00.000Z');
  assert.equal(iso(zonedInstant('2026-12-06', '21:00', 'America/New_York')), '2026-12-07T02:00:00.000Z');
  assert.equal(iso(zonedInstant('2026-10-06', '21:00', 'Europe/Paris')), '2026-10-06T19:00:00.000Z');
  assert.equal(
    iso(zonedInstant('2026-03-29', '09:00', 'Europe/Paris')),
    '2026-03-29T07:00:00.000Z',
    'day of the spring change',
  );
  assert.equal(iso(zonedInstant('2026-10-06', '21:00', 'UTC')), '2026-10-06T21:00:00.000Z');
  assert.deepEqual(zonedDay(Date.parse('2026-10-07T01:30:00Z'), 'America/New_York'), {
    date: '2026-10-06',
    weekday: 2,
  });
});

test('the processing window starts at the last run but never more than an hour back', () => {
  const now = Date.parse('2026-10-06T12:00:00Z');
  assert.equal(windowStart(now - 10 * 60000, now), now - 10 * 60000);
  assert.equal(windowStart(null, now), now - 10 * 60000);
  assert.equal(windowStart(now - 5 * 3600000, now), now - 3600000);
});

test('reminders fire once, for unfinished sessions starting inside the window', () => {
  const start = zonedInstant('2026-10-06', '21:00', 'America/New_York');
  const s = state([session(), session({ id: 's2', done: true }), session({ id: 's3', time: '22:00' })]);
  const due = dueReminders(s, start - 10 * 60000, start + 60000);
  assert.deepEqual(
    due.map((d) => d.session.id),
    ['s1'],
  );
  assert.equal(due[0].ref, 'session:s1:2026-10-06T21:00');
  assert.equal(
    dueReminders(s, start, start + 10 * 60000).length,
    0,
    'the start instant belongs to the earlier window only',
  );
});

test('the weekly summary is due on Monday 09:00 local time', () => {
  const monday9 = zonedInstant('2026-10-05', '09:00', 'Europe/Paris');
  assert.equal(weeklyDue('Europe/Paris', monday9 - 60000, monday9 + 60000), '2026-10-05');
  assert.equal(weeklyDue('Europe/Paris', monday9 + 60000, monday9 + 600000), null);
  assert.equal(
    weeklyDue('America/New_York', monday9 - 60000, monday9 + 60000),
    null,
    'still 03:00 in New York',
  );
  const week = weekSessions(
    state([
      session({ date: '2026-10-11' }),
      session({ id: 'x', date: '2026-10-12' }),
      session({ id: 'y', date: '2026-10-05', time: '08:00' }),
    ]),
    '2026-10-05',
  );
  assert.deepEqual(
    week.map((w) => w.session.id),
    ['y', 's1'],
  );
});

test('new episodes match titles by MyAnimeList, TMDB or TVmaze id, skipping finished and paused titles', () => {
  const items = [
    media(),
    media({ id: 'm2', catalog: { source: 'kitsu', id: '7442' } }),
    media({ id: 'm3', kind: 'series', catalog: { source: 'tmdb', id: '1399' } }),
    media({ id: 'm4', status: 'completed', catalog: { source: 'jikan', id: '1' } }),
    media({ id: 'm5', status: 'paused', catalog: { source: 'jikan', id: '2' } }),
  ];
  const aired = new Map([
    ['mal:52991', [{ key: 'mal:52991', episode: 5, season: null }]],
    ['mal:16498', [{ key: 'mal:16498', episode: 12, season: null }]],
    ['tmdb:1399', [{ key: 'tmdb:1399', episode: 3, season: 2 }]],
    ['mal:1', [{ key: 'mal:1', episode: 9, season: null }]],
    ['mal:2', [{ key: 'mal:2', episode: 9, season: null }]],
  ]);
  const found = episodesFor(state([], 'UTC', items), aired, (kitsu) => (kitsu === '7442' ? 16498 : null));
  assert.deepEqual(
    found.map((f) => f.ref),
    ['ep:mal:52991:0x5', 'ep:mal:16498:0x12', 'ep:tmdb:1399:2x3'],
  );
});

test('e-mails escape titles from members and carry an unsubscribe link', async () => {
  const { messages } = await import('../lib/i18n.ts');
  const { reminderNote, episodeNote, weeklyNote } = await import('../lib/notify/messages.ts');
  const evil = media({ title: '<img src=x onerror=alert(1)> & "Frieren"' });
  const note = reminderNote(messages.fr, evil, session(), 'https://www.afterwatch.online', 'https://www.afterwatch.online/api/notifications/unsubscribe?token=t');
  assert.ok(!note.html.includes('<img src=x'), 'no raw HTML from a title');
  assert.ok(note.html.includes('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;Frieren&quot;'));
  assert.ok(note.html.includes('unsubscribe?token=t') && note.text.includes('unsubscribe?token=t'));
  assert.equal(note.body, 'ép. 1–2 · 48 min au programme.');
  assert.equal(episodeNote(messages.en, media(), { episode: 5, season: 2 }, 'https://x', 'https://x/u').body, 'Season 2, episode 5 is out.');
  const weekly = weeklyNote(messages.en, 'en-US', [{ session: session({ date: '2026-10-07' }), media: media() }], 2, 'https://x', 'https://x/u');
  assert.equal(weekly.subject, 'Your week on Afterwatch');
  assert.ok(weekly.text.includes('Wednesday, October 7 · 21:00 — Frieren (ep. 1–2, 48 min)'));
  assert.ok(weekly.text.includes('2 priority titles in your list.'));
});
