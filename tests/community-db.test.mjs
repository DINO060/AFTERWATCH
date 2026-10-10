// Runs the real migrations in an embedded Postgres (PGlite) and checks the community rules as
// different members: permissions, uniqueness, limits, spoilers, moderation, deleted accounts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = (name) =>
  fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const id = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [A, B, C, MOD, E, F, G, H, I, J, K, L, N, P] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(id);
const db = new PGlite();

async function as(user, query, params = []) {
  const role = user === 'service' ? 'service_role' : user ? 'authenticated' : 'anon';
  const sub = user && user !== 'service' ? user : '';
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub]);
  await db.exec(`set role ${role}`);
  try {
    return (await db.query(query, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}
const one = async (user, query, params) => (await as(user, query, params))[0];
async function rejects(user, query, params, pattern) {
  await assert.rejects(as(user, query, params), (e) => {
    assert.match(String(e.message), pattern);
    return true;
  });
}
const rpc = (fn, args) => `select public.${fn}(${args}) as r`;
const value = async (user, fn, args, params) => (await one(user, rpc(fn, args), params)).r;

let T1, T2, WORK, FILM, SERIES, a1, b1;

test.before(async () => {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    -- Just enough of Supabase Storage for the photo rules.
    create schema storage;
    create table storage.buckets (
      id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(), bucket_id text, name text,
      owner_id text default nullif(current_setting('request.jwt.claim.sub', true), ''),
      created_at timestamptz default now()
    );
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable
      as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
    grant usage on schema storage to anon, authenticated, service_role;
    grant select, insert, delete on storage.objects to authenticated;
    grant select on storage.buckets to service_role;
  `);
  for (const name of [
    '202610070002_assistant_usage.sql',
    '202610080001_public_profiles.sql',
    '202610080002_community.sql',
    '202610090001_community_hub.sql',
    '202610100001_community_v2.sql',
    '202610110001_community_threads.sql',
  ])
    await db.exec(migration(name));
  await db.exec(
    `insert into auth.users (id) values ${[A, B, C, MOD, E, F, G, H, I, J, K, L, N, P].map((u) => `('${u}')`).join(', ')}`,
  );
  await db.exec(`insert into public.community_moderators (user_id) values ('${MOD}')`);
  for (const [user, name] of [
    [A, 'alice'],
    [B, 'bruno'],
    [MOD, 'mila'],
    [E, 'eli'],
    [F, 'fanny'],
    [G, 'gina'],
    [H, 'hugo'],
    [I, 'ines'],
    [K, 'kim'],
    [L, 'leo'],
    [N, 'nia'],
    [P, 'pablo'],
  ])
    await value(user, 'set_username', '$1', [name]);
});

const ensure = (kind, source, sourceId, season, episode, title = 'One Piece') =>
  value('service', 'community_ensure_target', '$1, $2, $3, $4, $5, $6, $7', [
    kind,
    source,
    sourceId,
    season,
    episode,
    title,
    'https://media.kitsu.app/anime/poster_images/12/small.jpg',
  ]);
const add = (user, target, body, { parent = null, spoiler = 'none', showRating = false } = {}) =>
  value(user, 'community_add_comment', '$1, $2, $3, $4, $5', [target, parent, body, spoiler, showRating]);
const thread = (user, target, sort = 'recent') =>
  value(user, 'community_thread', '$1, $2, 0, 20', [target, sort]);

test('works and episodes: only the server creates them, one per catalog identity', async () => {
  T1 = await ensure('anime', 'kitsu', '12', null, 1151);
  T2 = await ensure('anime', 'kitsu', '12', null, 1152);
  WORK = await ensure('anime', 'kitsu', '12', null, null);
  FILM = await ensure('film', 'tmdb', '27205', null, null, 'Inception');
  SERIES = await ensure('series', 'tmdb', '1399', 2, 7, 'Game of Thrones');
  assert.equal(await ensure('anime', 'kitsu', '12', null, 1151), T1, 'same episode, same discussion');
  assert.equal(new Set([T1, T2, WORK, FILM, SERIES]).size, 5, 'different episodes stay separate');
  await rejects(
    A,
    `insert into public.community_targets (kind, source, source_id, title) values ('film', 'tmdb', '1', 'x')`,
    [],
    /permission denied/,
  );
  await rejects(
    'service',
    rpc('community_ensure_target', `'series', 'tmdb', '1', null, 3, 'x', ''`),
    [],
    /check/,
  );
  await rejects(
    'service',
    rpc('community_ensure_target', `'anime', 'kitsu', '1', 1, 3, 'x', ''`),
    [],
    /check/,
  );
  await rejects(
    'service',
    rpc('community_ensure_target', `'film', 'tmdb', '1', null, null, 'x', 'https://evil.example/p.jpg'`),
    [],
    /check/,
  );
  await rejects(
    A,
    rpc('community_ensure_target', `'film', 'tmdb', '2', null, null, 'x', ''`),
    [],
    /permission denied/,
  );
  assert.equal(
    (await as(A, 'select id from public.community_targets where id = $1', [T1])).length,
    1,
    'members can read targets',
  );
});

test('posting needs a session and a username; members can only change their own débriefs', async () => {
  await rejects(
    null,
    rpc('community_add_comment', `$1, null, 'hi', 'none', false`),
    [T1],
    /permission denied|Authentication/,
  );
  await rejects(C, rpc('community_add_comment', `$1, null, 'hi', 'none', false`), [T1], /username_required/);
  a1 = await add(A, T1, '  Quel épisode !  ', { showRating: true });
  assert.equal(a1.body, 'Quel épisode !', 'trimmed');
  assert.equal(a1.username, 'alice');
  assert.equal(a1.mine, true);
  assert.equal(a1.id && typeof a1.id, 'string');
  b1 = await add(B, T1, 'Je suis d’accord');
  await rejects(B, rpc('community_edit_comment', `$1, 'pirate', 'none', false`), [a1.id], /not_allowed/);
  await rejects(B, rpc('community_delete_comment', '$1'), [a1.id], /not_allowed/);
  const edited = await value(A, 'community_edit_comment', `$1, 'Quel épisode, vraiment !', 'none', true`, [
    a1.id,
  ]);
  assert.equal(edited.edited, true);
  await rejects(
    A,
    rpc('community_add_comment', `$1, null, $2, 'none', false`),
    [T1, 'x'.repeat(2001)],
    /invalid_body/,
  );
  await rejects(A, rpc('community_add_comment', `$1, null, '   ', 'none', false`), [T1], /invalid_body/);
  await rejects(A, 'select * from public.community_comments', [], /permission denied/);
  await rejects(A, `update public.community_comments set body = 'x'`, [], /permission denied/);
});

test('replies are one level deep and stay in the same discussion', async () => {
  const reply = await add(B, T1, 'Réponse', { parent: a1.id });
  assert.equal(reply.parentId, a1.id);
  await rejects(
    A,
    rpc('community_add_comment', `$1, $2, 'trop profond', 'none', false`),
    [T1, reply.id],
    /invalid_parent/,
  );
  await rejects(
    A,
    rpc('community_add_comment', `$1, $2, 'ailleurs', 'none', false`),
    [T2, a1.id],
    /invalid_parent/,
  );
  const t = await thread(A, T1);
  const top = t.comments.find((c) => c.id === a1.id);
  assert.equal(top.replyCount, 1);
  assert.equal(top.replies[0].body, 'Réponse');
});

test('spoiler levels: "later" only exists for episodes', async () => {
  await rejects(
    A,
    rpc('community_add_comment', `$1, null, 'fin', 'later', false`),
    [FILM],
    /invalid_spoiler/,
  );
  const s = await add(A, FILM, 'La toupie…', { spoiler: 'episode' });
  assert.equal(s.spoiler, 'episode');
  const later = await add(E, T1, 'Attendez trois épisodes', { spoiler: 'later' });
  assert.equal(later.spoiler, 'later');
  await rejects(A, rpc('community_add_comment', `$1, null, 'x', 'maybe', false`), [T1], /invalid_spoiler/);
});

test('the same text twice is one débrief, and posting is limited to 5 a minute', async () => {
  const first = await add(F, T2, 'Doublon');
  const again = await add(F, T2, 'Doublon');
  assert.equal(again.id, first.id);
  for (let i = 0; i < 4; i++) await add(F, T2, `Message ${i}`);
  await rejects(F, rpc('community_add_comment', `$1, null, 'Un de trop', 'none', false`), [T2], /too_fast/);
});

test('reactions: one per member, the same again removes it, another replaces it', async () => {
  let r = await value(B, 'community_react', `$1, 'heart'`, [a1.id]);
  assert.deepEqual(r, { reactions: { heart: 1 }, myReaction: 'heart' });
  r = await value(B, 'community_react', `$1, 'heart'`, [a1.id]);
  assert.deepEqual(r, { reactions: {}, myReaction: null });
  await value(B, 'community_react', `$1, 'fire'`, [a1.id]);
  r = await value(B, 'community_react', `$1, 'laugh'`, [a1.id]);
  assert.deepEqual(r, { reactions: { laugh: 1 }, myReaction: 'laugh' });
  r = await value(E, 'community_react', `$1, 'fire'`, [a1.id]);
  assert.deepEqual(r, { reactions: { laugh: 1, fire: 1 }, myReaction: 'fire' });
  await rejects(E, rpc('community_react', `$1, 'poop'`), [a1.id], /invalid_reaction/);
  await rejects(E, 'select * from public.community_reactions', [], /permission denied/);
});

test('verdicts: one per member, changeable, removable; the average needs 5 verdicts', async () => {
  let s = await value(A, 'community_set_rating', '$1, 8', [T1]);
  s = await value(A, 'community_set_rating', '$1, 9', [T1]);
  assert.equal(s.myScore, 9);
  assert.equal(s.verdicts, 1);
  assert.equal(s.average, null);
  assert.equal(s.histogram, null);
  for (const [user, score] of [
    [B, 7],
    [E, 10],
    [F, 9],
  ])
    await value(user, 'community_set_rating', '$1, $2', [T1, score]);
  s = await value(MOD, 'community_set_rating', '$1, 5', [T1]);
  assert.equal(s.verdicts, 5);
  assert.equal(Number(s.average), 8);
  assert.deepEqual(s.histogram, [0, 0, 0, 0, 1, 0, 1, 0, 2, 1]);
  s = await value(MOD, 'community_set_rating', '$1, null', [T1]);
  assert.equal(s.verdicts, 4);
  assert.equal(s.myScore, null);
  await rejects(A, rpc('community_set_rating', '$1, 11'), [T1], /invalid_score/);
  await rejects(A, 'select * from public.community_ratings', [], /permission denied/);
  // The verdict shown next to a débrief is the author's current one.
  let shown = (await thread(B, T1)).comments.find((c) => c.id === a1.id);
  assert.equal(shown.rating, 9);
  await value(A, 'community_set_rating', '$1, null', [T1]);
  shown = (await thread(B, T1)).comments.find((c) => c.id === a1.id);
  assert.equal(shown.rating, null);
  await value(A, 'community_set_rating', '$1, 9', [T1]);
});

test('reports and moderation: only moderators see and act; a banned member can read but not post', async () => {
  await rejects(A, rpc('community_report', `$1, 'spam', ''`), [a1.id], /own_comment/);
  await value(B, 'community_report', `$1, 'harassment', 'insulte'`, [a1.id]);
  await value(B, 'community_report', `$1, 'harassment', 'encore'`, [a1.id]);
  await value(E, 'community_report', `$1, 'spam', ''`, [a1.id]);
  await rejects(B, rpc('community_moderation_queue', ''), [], /not_allowed/);
  await rejects(B, rpc('community_resolve', `$1, 'remove', true`), [a1.id], /not_allowed/);
  const queue = await value(MOD, 'community_moderation_queue', '', []);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].reports, 2, 'one report per member');
  assert.deepEqual(queue[0].reasons, { harassment: 1, spam: 1 });
  assert.equal(queue[0].author, 'alice');
  assert.equal(queue[0].target.episode, 1151);
  await value(MOD, 'community_resolve', `$1, 'remove', true`, [a1.id]);
  assert.equal((await value(MOD, 'community_moderation_queue', '', [])).length, 0);
  const removed = (await thread(B, T1)).comments.find((c) => c.id === a1.id);
  assert.equal(removed.removed, true, 'kept as a placeholder because it has a reply');
  assert.equal(removed.body, '');
  await rejects(A, rpc('community_add_comment', `$1, null, 'retour', 'none', false`), [T1], /banned/);
  await rejects(A, rpc('community_react', `$1, 'heart'`), [b1.id], /banned/);
  await rejects(A, rpc('community_set_rating', '$1, 3'), [T2], /banned/);
  assert.ok((await thread(A, T1)).comments.length > 0, 'a banned member can still read');
});

test('threads: newest first or most reacted first; deleted débriefs without replies disappear', async () => {
  const lonely = await add(E, T2, 'Je vais supprimer ça');
  await value(E, 'community_delete_comment', '$1', [lonely.id]);
  const t2 = await thread(B, T2);
  assert.ok(!t2.comments.some((c) => c.id === lonely.id));
  const recent = await thread(B, T1);
  assert.deepEqual(
    recent.comments.map((c) => c.createdAt),
    [...recent.comments.map((c) => c.createdAt)].sort().reverse(),
  );
  const fresh = await add(MOD, T1, 'Le plus aimé');
  for (const user of [B, E, F]) await value(user, 'community_react', `$1, 'fire'`, [fresh.id]);
  assert.equal((await thread(C, T1, 'top')).comments[0].id, fresh.id);
  await rejects(
    null,
    rpc('community_thread', `$1, 'recent', 0, 20`),
    [T1],
    /permission denied|Authentication/,
  );
});

test('a deleted account leaves "comment deleted" and keeps the others’ replies', async () => {
  const parent = await add(G, SERIES, 'Ce dernier plan…');
  const reply = await add(E, SERIES, 'Incroyable', { parent: parent.id });
  await value(G, 'community_react', `$1, 'heart'`, [reply.id]);
  await value(G, 'community_set_rating', '$1, 10', [SERIES]);
  await db.exec(`delete from auth.users where id = '${G}'`);
  const t = await thread(E, SERIES);
  const gone = t.comments.find((c) => c.id === parent.id);
  assert.equal(gone.deleted, true);
  assert.equal(gone.body, '');
  assert.equal(gone.username, null);
  assert.equal(gone.replies[0].body, 'Incroyable', 'replies stay');
  assert.deepEqual(gone.replies[0].reactions, {}, 'their reactions go with the account');
  assert.equal((await value(E, 'community_summary', '$1', [SERIES])).verdicts, 0);
});

test('the community page: latest débriefs without spoiler text, and activity per work', async () => {
  await rejects(null, rpc('community_recent', 'null, 0, 20'), [], /permission denied|Authentication/);
  const recent = await value(E, 'community_recent', 'null, 0, 40', []);
  assert.ok(recent.items.length > 0);
  const times = recent.items.map((i) => i.createdAt);
  assert.deepEqual(times, [...times].sort().reverse(), 'newest first');
  assert.ok(
    recent.items.every((i) => !i.deleted && i.parentId === undefined),
    'no deleted débriefs, no replies',
  );
  for (const item of recent.items.filter((i) => i.spoiler !== 'none'))
    assert.equal(item.body, null, 'a spoiler’s text never appears in the list');
  assert.ok(
    recent.items.some((i) => i.spoiler !== 'none'),
    'spoilers are listed, veiled',
  );
  assert.ok(
    recent.items.every((i) => i.target && i.target.title),
    'each débrief says where it was posted',
  );
  const films = await value(E, 'community_recent', `'film', 0, 40`, []);
  assert.ok(films.items.length > 0 && films.items.every((i) => i.target.kind === 'film'));
  const page = await value(E, 'community_recent', 'null, 0, 2', []);
  assert.equal(page.items.length, 2);
  assert.equal(page.hasMore, true);
  await rejects(E, rpc('community_recent', `'livre', 0, 20`), [], /invalid_kind/);

  const works = await value(E, 'community_works_activity', '$1', [
    JSON.stringify([
      { kind: 'anime', source: 'kitsu', sourceId: '12' },
      { kind: 'film', source: 'tmdb', sourceId: '27205' },
      { kind: 'film', source: 'tmdb', sourceId: '999' },
    ]),
  ]);
  const anime = works.find((w) => w.sourceId === '12');
  const film = works.find((w) => w.sourceId === '27205');
  assert.ok(anime.debriefs > 5, 'all episodes of the work count');
  assert.equal(film.debriefs, 1);
  assert.ok(!works.some((w) => w.sourceId === '999'), 'works without débriefs are left out');
  await rejects(E, rpc('community_works_activity', `'{}'::jsonb`), [], /invalid_works/);
});

// ---------- Community v2 ----------
const BACKDROP = 'https://image.tmdb.org/t/p/w1280/frieren.jpg';
let FRIEREN, recoH;
const ensureWide = (kind, source, sourceId, season, episode, title, backdrop = BACKDROP, year = '2023') =>
  value('service', 'community_ensure_target', '$1, $2, $3, $4, $5, $6, $7, $8, $9', [
    kind,
    source,
    sourceId,
    season,
    episode,
    title,
    '',
    backdrop,
    year,
  ]);
const recommend = (user, target, body, spoiler = 'none', score = null) =>
  value(user, 'community_recommend', '$1, $2, $3, $4', [target, body, spoiler, score]);
const feed = (user, kind, works = [], offset = 0, limit = 20) =>
  value(user, 'community_feed', '$1, $2, $3, $4', [kind, JSON.stringify(works), offset, limit]);

test('v2 works carry a wide image and a year; the earlier server function still works', async () => {
  FRIEREN = await ensureWide('anime', 'kitsu', '46474', null, null, 'Frieren');
  const row = await one(A, 'select backdrop, year from public.community_targets where id = $1', [FRIEREN]);
  assert.deepEqual(row, { backdrop: BACKDROP, year: '2023' });
  assert.equal(await ensure('anime', 'kitsu', '46474', null, null, 'Frieren'), FRIEREN, 'old signature');
  await rejects(
    'service',
    rpc(
      'community_ensure_target',
      `'film', 'tmdb', '5', null, null, 'x', '', 'https://evil.example/b.jpg', ''`,
    ),
    [],
    /check/,
  );
  await rejects(
    H,
    rpc('community_ensure_target', `'film', 'tmdb', '5', null, null, 'x', '', '', ''`),
    [],
    /permission denied/,
  );
});

test('recommendations: whole works only, 500 characters, a username, and the verdict joins the work', async () => {
  await rejects(J, rpc('community_recommend', `$1, 'Top', 'none', null`), [FRIEREN], /username_required/);
  await rejects(H, rpc('community_recommend', `$1, 'Top', 'none', null`), [T1], /invalid_parent/);
  await rejects(
    H,
    rpc('community_recommend', `$1, $2, 'none', null`),
    [FRIEREN, 'x'.repeat(501)],
    /invalid_body/,
  );
  await rejects(H, rpc('community_recommend', `$1, 'Top', 'later', null`), [FRIEREN], /invalid_spoiler/);
  await rejects(H, rpc('community_recommend', `$1, 'Top', 'none', 0`), [FRIEREN], /invalid_score/);
  await rejects(A, rpc('community_recommend', `$1, 'Top', 'none', null`), [FRIEREN], /banned/);
  recoH = await recommend(H, FRIEREN, '  Un voyage calme qui reste longtemps en tête.  ', 'none', 9);
  assert.equal(recoH.kind, 'reco');
  assert.equal(recoH.body, 'Un voyage calme qui reste longtemps en tête.');
  assert.equal(recoH.rating, 9, 'the verdict shows on the recommendation');
  const again = await recommend(H, FRIEREN, 'Un voyage calme qui reste longtemps en tête.', 'none', 9);
  assert.equal(again.id, recoH.id, 'sent twice, published once');
  assert.equal((await value(H, 'community_summary', '$1', [FRIEREN])).myScore, 9, 'and counts for the work');
  const t = await thread(I, FRIEREN);
  assert.equal(t.comments[0].kind, 'reco', 'recommendations appear in the discussion of the work');
  assert.equal((await add(I, FRIEREN, 'Pas encore vu')).kind, 'debrief');
  await recommend(I, FRIEREN, 'La fin de la saison 1…', 'episode');
});

test('reactions to an episode: one per member, toggled or replaced, counted in the summary', async () => {
  let r = await value(H, 'community_react_target', `$1, 'fire'`, [T1]);
  assert.deepEqual(r, { targetReactions: { fire: 1 }, myTargetReaction: 'fire' });
  r = await value(I, 'community_react_target', `$1, 'fire'`, [T1]);
  assert.deepEqual(r.targetReactions, { fire: 2 });
  r = await value(H, 'community_react_target', `$1, 'cry'`, [T1]);
  assert.deepEqual(r, { targetReactions: { fire: 1, cry: 1 }, myTargetReaction: 'cry' });
  r = await value(H, 'community_react_target', `$1, 'cry'`, [T1]);
  assert.deepEqual(r, { targetReactions: { fire: 1 }, myTargetReaction: null });
  const s = await value(I, 'community_summary', '$1', [T1]);
  assert.deepEqual([s.targetReactions, s.myTargetReaction], [{ fire: 1 }, 'fire']);
  await rejects(H, rpc('community_react_target', `$1, 'laugh'`), [T1], /invalid_reaction/);
  await rejects(A, rpc('community_react_target', `$1, 'fire'`), [T1], /banned/);
  await rejects(null, rpc('community_react_target', `$1, 'fire'`), [T1], /permission denied|Authentication/);
  await rejects(H, 'select * from public.community_target_reactions', [], /permission denied/);
});

test('spoiler protection is on by default, per member', async () => {
  assert.deepEqual(await value(H, 'community_get_prefs', '', []), { spoilerProtection: true });
  assert.deepEqual(await value(H, 'community_set_prefs', 'false', []), { spoilerProtection: false });
  assert.deepEqual(await value(H, 'community_get_prefs', '', []), { spoilerProtection: false });
  assert.deepEqual(
    await value(I, 'community_get_prefs', '', []),
    { spoilerProtection: true },
    'the others keep theirs',
  );
  await rejects(null, rpc('community_get_prefs', ''), [], /permission denied|Authentication/);
  await rejects(H, 'select * from public.community_prefs', [], /permission denied/);
});

test('the feed: the works of the member first, spoiler text only once protection is off', async () => {
  const mine = [{ kind: 'film', source: 'tmdb', sourceId: '27205' }];
  const forI = await feed(I, null, mine, 0, 40);
  assert.equal(forI.spoilerProtection, true);
  assert.equal(forI.items[0].target.title, 'Inception', 'posts about the list of the member come first');
  assert.equal(forI.items[0].inList, true);
  assert.ok(forI.items.slice(1).every((i) => !i.inList));
  const veiled = forI.items.filter((i) => i.spoiler !== 'none');
  assert.ok(veiled.length > 0 && veiled.every((i) => i.body === null), 'spoilers are listed without text');
  assert.ok(
    forI.items.every((i) => i.parentId === undefined && !i.deleted),
    'no replies, nothing deleted',
  );
  const reco = forI.items.find((i) => i.id === recoH.id);
  assert.equal(reco.kind, 'reco');
  assert.equal(reco.target.backdrop, BACKDROP);
  assert.equal(reco.rating, 9);

  const forH = await feed(H, null, [], 0, 40);
  assert.equal(forH.spoilerProtection, false);
  assert.ok(forH.items.filter((i) => i.spoiler !== 'none').every((i) => typeof i.body === 'string'));
  const times = forH.items.map((i) => i.createdAt);
  assert.deepEqual(times, [...times].sort().reverse(), 'without a list: newest first');

  const films = await feed(I, 'film', []);
  assert.ok(films.items.length > 0 && films.items.every((i) => i.target.kind === 'film'));
  const page = await feed(I, null, [], 0, 2);
  assert.equal(page.items.length, 2);
  assert.equal(page.hasMore, true);
  const next = await feed(I, null, [], 2, 2);
  assert.ok(!next.items.some((i) => page.items.some((p) => p.id === i.id)), 'pages do not overlap');
  await rejects(I, rpc('community_feed', `'livre', '[]', 0, 20`), [], /invalid_kind/);
  await rejects(I, rpc('community_feed', `null, '{}', 0, 20`), [], /invalid_works/);
  await rejects(null, rpc('community_feed', `null, '[]', 0, 20`), [], /permission denied|Authentication/);

  const bodies = await value(I, 'community_bodies', '$1', [veiled.map((v) => v.id)]);
  assert.ok(veiled.every((v) => typeof bodies[v.id] === 'string' && bodies[v.id].length > 0));
});

test('tes discussions and à découvrir', async () => {
  const works = await value(I, 'community_works_activity', '$1', [
    JSON.stringify([
      { kind: 'anime', source: 'kitsu', sourceId: '12' },
      { kind: 'anime', source: 'kitsu', sourceId: '12' },
    ]),
  ]);
  assert.equal(works.length, 1, 'a work listed twice counts once');
  assert.ok('episode' in works[0].latest, 'says which episode was talked about last');
  const discover = await value(I, 'community_discover', '$1, 4', [JSON.stringify([])]);
  assert.equal(discover[0].title, 'Frieren');
  assert.equal(discover[0].recos, 2);
  assert.equal(discover[0].backdrop, BACKDROP);
  const known = await value(I, 'community_discover', '$1, 4', [
    JSON.stringify([{ kind: 'anime', source: 'kitsu', sourceId: '46474' }]),
  ]);
  assert.ok(!known.some((w) => w.sourceId === '46474'), 'works already in the list are left out');
});

// ---------- Community, X / Threads style ----------
const photo = (user, n, w = 1200, h = 800) => ({
  path: `${user}/00000000-0000-4000-8000-${String(n).padStart(12, '0')}.webp`,
  w,
  h,
});
const publish = (user, target, body, o = {}) =>
  value(user, 'community_publish', '$1, $2, $3, $4, $5, $6, $7, $8', [
    target,
    o.parent ?? null,
    o.kind ?? 'debrief',
    body,
    o.spoiler ?? 'none',
    o.score ?? null,
    o.tags ?? [],
    JSON.stringify(o.photos ?? []),
  ]);
const publishSql = (args) => rpc('community_publish', args);
const timeline = (user, o = {}) =>
  value(user, 'community_timeline', '$1, $2, $3, $4, $5', [
    o.kind ?? null,
    o.tag ?? null,
    JSON.stringify(o.works ?? []),
    o.offset ?? 0,
    o.limit ?? 40,
  ]);
let withPhotos;

test('photos go only into the member’s own folder', async () => {
  const insert = `insert into storage.objects (bucket_id, name) values ('community-photos', $1)`;
  await as(K, insert, [photo(K, 1).path]);
  await rejects(K, insert, [photo(L, 1).path], /row-level security/);
  await rejects(K, insert, [`${K}/../escape.png`], /row-level security/);
  const bucket = await one(
    'service',
    `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'community-photos'`,
  );
  assert.equal(bucket.public, true);
  assert.equal(Number(bucket.file_size_limit), 2097152);
  assert.deepEqual(bucket.allowed_mime_types, ['image/webp', 'image/jpeg']);
});

test('a post can carry up to 4 photos of its author, each used once', async () => {
  withPhotos = await publish(K, T2, 'Regardez ce plan #Toei #Gojo', {
    photos: [photo(K, 1), photo(K, 2, 800, 1200)],
    tags: ['toei', 'gojo', 'absent'],
  });
  assert.deepEqual(
    withPhotos.photos.map((p) => p.h),
    [800, 1200],
  );
  assert.deepEqual([...withPhotos.tags].sort(), ['gojo', 'toei'], 'only the tags written in the text');
  const args = `$1, null, 'debrief', 'x', 'none', null, '{}', $2`;
  await rejects(K, publishSql(args), [T2, JSON.stringify([photo(L, 3)])], /invalid_photos/);
  await rejects(
    K,
    publishSql(args),
    [T2, JSON.stringify([1, 2, 3, 4, 5].map((n) => photo(K, 10 + n)))],
    /invalid_photos/,
  );
  await rejects(K, publishSql(args), [T2, JSON.stringify([photo(K, 1)])], /invalid_photos/);
  await rejects(
    K,
    publishSql(args),
    [T2, JSON.stringify([{ path: photo(K, 20).path, w: 0, h: 10 }])],
    /invalid_photos/,
  );
  const only = await publish(K, T2, '', { photos: [photo(K, 3)] });
  assert.equal(only.body, '', 'photos alone are a post');
  await rejects(K, publishSql(`$1, null, 'debrief', '  ', 'none', null, '{}', '[]'`), [T2], /invalid_body/);
});

test('spoilers keep no #tags; replies and recommendations go through the same door', async () => {
  const spoiler = await publish(L, T2, 'La fin #Gojo', {
    spoiler: 'episode',
    tags: ['gojo'],
    photos: [photo(L, 1)],
  });
  assert.deepEqual(spoiler.tags, []);
  const reply = await publish(L, T2, 'Grave #Gojo', { parent: withPhotos.id, tags: ['gojo'] });
  assert.equal(reply.parentId, withPhotos.id);
  assert.equal(reply.rating, null, 'replies never show a score');
  await rejects(
    L,
    publishSql(`$1, $2, 'reco', 'x', 'none', null, '{}', '[]'`),
    [T2, withPhotos.id],
    /invalid_parent/,
  );
  await rejects(L, publishSql(`$1, null, 'reco', 'x', 'none', 8, '{}', '[]'`), [T2], /invalid_parent/);
  await rejects(L, publishSql(`$1, null, 'debrief', 'x', 'none', 8, '{}', '[]'`), [T2], /invalid_score/);
  const reco = await publish(L, FRIEREN, 'À voir #Frieren', { kind: 'reco', score: 8, tags: ['frieren'] });
  assert.equal(reco.kind, 'reco');
  assert.equal(reco.rating, 8);
  await rejects(
    L,
    publishSql(`$1, null, 'reco', $2, 'none', null, '{}', '[]'`),
    [FRIEREN, 'x'.repeat(501)],
    /invalid_body/,
  );
});

test('the timeline: #tag filter, and spoiler photos stay hidden while protection is on', async () => {
  const gojo = await timeline(N, { tag: 'Gojo' });
  assert.deepEqual(
    gojo.items.map((i) => i.id),
    [withPhotos.id],
    'top-level, non-spoiler posts with the tag',
  );
  const all = await timeline(N);
  const hidden = all.items.find((i) => i.spoiler !== 'none' && i.photoCount > 0);
  assert.ok(hidden, 'the spoiler with a photo is listed');
  assert.equal(hidden.body, null);
  assert.deepEqual(hidden.photos, [], 'its photo is not sent');
  assert.equal(hidden.photoCount, 1, 'only how many');
  assert.equal(all.items.find((i) => i.id === withPhotos.id).photos.length, 2);
  const revealed = await value(N, 'community_reveal', '$1', [[hidden.id]]);
  assert.equal(revealed[hidden.id].photos.length, 1);
  assert.equal(revealed[hidden.id].body, 'La fin #Gojo');
  await rejects(N, rpc('community_timeline', `null, 'deux mots', '[]', 0, 20`), [], /invalid_kind/);
});

test('trends count members, not posts, and never spoilers', async () => {
  const before = await value(N, 'community_trending', '8', []);
  assert.ok(!before.some((t) => t.tag === 'toei'), 'one member is not a trend');
  await publish(N, T2, 'Toei en forme #Toei', { tags: ['toei'] });
  const toei = (await value(N, 'community_trending', '8', [])).find((t) => t.tag === 'toei');
  assert.equal(toei.members, 2);
  await publish(P, T2, 'Chut #Secret', { spoiler: 'episode', tags: ['secret'] });
  await publish(N, T2, 'Chut aussi #Secret', { spoiler: 'episode', tags: ['secret'] });
  assert.ok(!(await value(N, 'community_trending', '8', [])).some((t) => t.tag === 'secret'));
});

test('a deleted post loses its photos and tags', async () => {
  await value(K, 'community_delete_comment', '$1', [withPhotos.id]);
  const row = await one('service', 'select photos, tags, body from public.community_comments where id = $1', [
    withPhotos.id,
  ]);
  assert.deepEqual(row, { photos: [], tags: [], body: '' });
  assert.equal((await timeline(N, { tag: 'gojo' })).items.length, 0);
});
