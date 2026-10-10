import test from 'node:test';
import assert from 'node:assert/strict';
import {
  refProblem,
  refPath,
  parseRefPath,
  refFromMedia,
  absoluteEpisode,
  viewerSeen,
  spoilerHidden,
  sameRef,
  workOf,
  topReactions,
  inCollection,
  extractTags,
  splitTags,
} from '../lib/community.ts';

const ref = (over = {}) => ({
  kind: 'anime',
  source: 'kitsu',
  sourceId: '12',
  season: null,
  episode: 1151,
  ...over,
});
const media = (over = {}) => ({
  id: 'm',
  title: 'One Piece',
  kind: 'anime',
  priority: false,
  status: 'watching',
  progress: 1150,
  total: 0,
  duration: 24,
  poster: '',
  sourceUrl: '',
  notes: '',
  catalog: { source: 'kitsu', id: '12' },
  ...over,
});

test('a discussion is identified by the catalog, never by a title', () => {
  assert.equal(refProblem(ref()), null);
  assert.equal(refProblem(ref({ episode: null })), null, 'the whole work');
  assert.equal(
    refProblem(ref({ kind: 'series', source: 'tmdb', sourceId: '1399', season: 2, episode: 7 })),
    null,
  );
  assert.equal(
    refProblem(ref({ kind: 'film', source: 'cinemeta', sourceId: 'tt1375666', episode: null })),
    null,
  );
  assert.equal(refProblem(ref({ season: 1 })), 'season', 'anime episodes have no season');
  assert.equal(refProblem(ref({ kind: 'series', source: 'tmdb', sourceId: '1', episode: 3 })), 'season');
  assert.equal(
    refProblem(ref({ kind: 'film', source: 'tmdb', sourceId: '1' })),
    'episode',
    'films are discussed whole',
  );
  assert.equal(refProblem(ref({ source: 'tmdb' })), 'source', 'anime come from Kitsu or MyAnimeList');
  assert.equal(refProblem(ref({ sourceId: 'One Piece' })), 'id');
  assert.equal(refProblem(ref({ kind: 'film', source: 'cinemeta', sourceId: '123', episode: null })), 'id');
  assert.equal(refProblem(ref({ episode: 0 })), 'episode');
});

test('each discussion has its own address, and the address leads back to it', () => {
  const cases = [
    [ref(), '/oeuvre/anime/kitsu/12/episode/1151'],
    [ref({ episode: null }), '/oeuvre/anime/kitsu/12'],
    [
      ref({ kind: 'series', source: 'tmdb', sourceId: '1399', season: 2, episode: 7 }),
      '/oeuvre/serie/tmdb/1399/saison/2/episode/7',
    ],
    [
      ref({ kind: 'film', source: 'cinemeta', sourceId: 'tt1375666', episode: null }),
      '/oeuvre/film/cinemeta/tt1375666',
    ],
  ];
  for (const [r, path] of cases) {
    assert.equal(refPath(r), path);
    assert.deepEqual(parseRefPath(path), r);
    assert.deepEqual(parseRefPath(path + '/'), r);
  }
  for (const bad of [
    '/',
    '/oeuvre',
    '/oeuvre/anime/kitsu',
    '/oeuvre/livre/x/1',
    '/oeuvre/anime/kitsu/12/saison/1/episode/2',
    '/oeuvre/anime/kitsu/12/episode/abc',
    '/oeuvre/film/tmdb/1/episode/2',
  ])
    assert.equal(parseRefPath(bad), null, bad);
  assert.ok(sameRef(parseRefPath('/oeuvre/anime/kitsu/12/episode/1151'), ref()));
  assert.ok(!sameRef(ref(), ref({ episode: 1152 })), 'different episodes stay separate');
  assert.deepEqual(workOf(ref()), ref({ episode: null }));
});

test('titles in a collection open their whole-work discussion', () => {
  assert.deepEqual(refFromMedia(media()), ref({ episode: null }));
  assert.equal(refFromMedia(media({ catalog: undefined })), null);
});

test('series episodes are matched across seasons', () => {
  const seasons = [
    { season: 0, episodes: 3 },
    { season: 1, episodes: 10 },
    { season: 2, episodes: 8 },
  ];
  assert.equal(absoluteEpisode(1, 4, seasons), 4);
  assert.equal(absoluteEpisode(2, 3, seasons), 13, 'specials (season 0) do not count');
  assert.equal(absoluteEpisode(2, 9, seasons), null);
  assert.equal(absoluteEpisode(3, 1, seasons), null);
});

test('"seen" comes only from the viewer’s own list, and stays unknown when unsure', () => {
  const list = [media()];
  assert.equal(viewerSeen(ref({ episode: 1150 }), list), true);
  assert.equal(viewerSeen(ref({ episode: 1151 }), list), false);
  assert.equal(viewerSeen(ref({ sourceId: '13' }), list), null, 'not in the list');
  assert.equal(viewerSeen(ref({ source: 'jikan' }), list), null, 'another catalog is another work');
  assert.equal(viewerSeen(ref({ episode: null }), list), false, 'the work is not finished');
  assert.equal(viewerSeen(ref({ episode: null }), [media({ status: 'completed' })]), true);
  const series = media({ kind: 'series', catalog: { source: 'tmdb', id: '1399' }, progress: 13 });
  const sRef = ref({ kind: 'series', source: 'tmdb', sourceId: '1399', season: 2, episode: 3 });
  assert.equal(viewerSeen(sRef, [series]), null, 'without the season list, unknown');
  assert.equal(
    viewerSeen(
      sRef,
      [series],
      [
        { season: 1, episodes: 10 },
        { season: 2, episodes: 8 },
      ],
    ),
    true,
  );
  assert.equal(
    viewerSeen(
      { ...sRef, episode: 4 },
      [series],
      [
        { season: 1, episodes: 10 },
        { season: 2, episodes: 8 },
      ],
    ),
    false,
  );
});

test('spoilers stay hidden unless they only spoil what the viewer has seen', () => {
  assert.equal(spoilerHidden('none', null), false);
  assert.equal(spoilerHidden('episode', true), false);
  assert.equal(spoilerHidden('episode', false), true);
  assert.equal(spoilerHidden('episode', null), true, 'unknown progress keeps it hidden');
  assert.equal(spoilerHidden('later', true), true, 'later episodes stay hidden even when this one is seen');
});

test('with spoiler protection off, nothing is hidden', () => {
  assert.equal(spoilerHidden('episode', false, false), false);
  assert.equal(spoilerHidden('later', true, false), false);
  assert.equal(spoilerHidden('episode', null, true), true, 'on by default');
  assert.equal(spoilerHidden('none', null), false);
});

test('reactions read as "🔥😭🤯 12": the most used first, at most three', () => {
  assert.deepEqual(topReactions({ cry: 4, fire: 6, mind: 2, heart: 1 }), {
    emojis: ['🔥', '😭', '🤯'],
    total: 13,
  });
  assert.deepEqual(topReactions({}), { emojis: [], total: 0 });
});

test('"+ Ma liste" knows a title already in the list by its catalog entry', () => {
  const list = [{ kind: 'anime', catalog: { source: 'kitsu', id: '12' } }];
  assert.equal(inCollection({ kind: 'anime', source: 'kitsu', sourceId: '12' }, list), true);
  assert.equal(inCollection({ kind: 'anime', source: 'jikan', sourceId: '12' }, list), false);
  assert.equal(inCollection({ kind: 'manga', source: 'kitsu', sourceId: '12' }, list), false);
});

test('#tags: letters with accents, digits and _, lower case, no duplicates, at most 10', () => {
  assert.deepEqual(extractTags('Quel épisode #Gojo #JJK_S2 #gojo #Épisode17'), [
    'gojo',
    'jjk_s2',
    'épisode17',
  ]);
  assert.deepEqual(extractTags('mail@site.fr #a # #x1 C#Sharp &#39; ##double'), ['x1']);
  assert.deepEqual(extractTags('#' + 'a'.repeat(31)), [], 'too long');
  assert.equal(extractTags(Array.from({ length: 12 }, (_, i) => `#tag${i}`).join(' ')).length, 10);
});

test('a text becomes plain parts and clickable #tags, in order', () => {
  assert.deepEqual(splitTags('Trop bien #Gojo !'), [
    { text: 'Trop bien ' },
    { tag: 'gojo', text: '#Gojo' },
    { text: ' !' },
  ]);
  assert.deepEqual(splitTags('#JJK'), [{ tag: 'jjk', text: '#JJK' }]);
  assert.deepEqual(splitTags('rien ici'), [{ text: 'rien ici' }]);
});
