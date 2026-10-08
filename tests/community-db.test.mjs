// Runs the real migrations in an embedded Postgres (PGlite) and checks the community rules as
// different members: permissions, uniqueness, limits, spoilers, moderation, deleted accounts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = (name) =>
  fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const id = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [A, B, C, MOD, E, F, G] = [1, 2, 3, 4, 5, 6, 7].map(id);
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
  `);
  for (const name of [
    '202610070002_assistant_usage.sql',
    '202610080001_public_profiles.sql',
    '202610080002_community.sql',
  ])
    await db.exec(migration(name));
  await db.exec(
    `insert into auth.users (id) values ${[A, B, C, MOD, E, F, G].map((u) => `('${u}')`).join(', ')}`,
  );
  await db.exec(`insert into public.community_moderators (user_id) values ('${MOD}')`);
  for (const [user, name] of [
    [A, 'alice'],
    [B, 'bruno'],
    [MOD, 'mila'],
    [E, 'eli'],
    [F, 'fanny'],
    [G, 'gina'],
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
