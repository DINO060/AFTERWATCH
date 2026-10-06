import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require(process.env.AFTERWATCH_TYPESCRIPT_PATH || 'typescript');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'afterwatch-test-'));
try {
  for (const name of ['catalog', 'catalog-gateway']) {
    const input = fs.readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
    const js = ts
      .transpileModule(input, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      })
      .outputText.replaceAll("'./catalog'", "'./catalog.mjs'");
    fs.writeFileSync(path.join(temp, `${name}.mjs`), js);
  }
  const { browseWith, detailWith, feedsFor, currentSeason } = await import(
    pathToFileURL(path.join(temp, 'catalog-gateway.mjs')).href
  );
  const { normalizeKitsu, normalizeTVMaze, normalizeTmdb, mediaFromCatalog } = await import(
    pathToFileURL(path.join(temp, 'catalog.mjs')).href
  );
  const resource = {
    id: '1',
    attributes: {
      canonicalTitle: 'Cowboy Bebop',
      episodeCount: 26,
      episodeLength: 24,
      averageRating: '85.5',
      status: 'finished',
      synopsis: '<p>Space &amp; jazz.</p>',
      posterImage: { large: 'https://media.kitsu.app/anime/poster_images/1/large.jpg' },
    },
    relationships: { categories: { data: [{ id: '4' }] } },
  };
  const included = [{ type: 'categories', id: '4', attributes: { title: 'Science Fiction' } }];
  const item = normalizeKitsu(resource, 'anime', included);
  assert.equal(item.total, 26);
  assert.equal(item.catalog.available, 26);
  assert.equal(item.catalog.score, 8.55);
  assert.equal(item.catalog.synopsis, 'Space & jazz.');
  assert.deepEqual(item.catalog.genres, ['Science Fiction']);
  const ongoing = normalizeKitsu(
    { id: '2', attributes: { canonicalTitle: 'Ongoing manga', status: 'current' } },
    'manga',
  );
  assert.equal(ongoing.total, 0);
  assert.equal(ongoing.catalog.chapters, null);
  assert.equal(ongoing.catalog.score, null);
  assert.equal(ongoing.catalog.available, null);
  const page = await browseWith(
    async (url) => {
      assert.ok(url.includes('page%5Boffset%5D=20'));
      assert.ok(url.includes('filter%5Btext%5D=naruto'));
      return { data: [resource], included, links: { next: 'next' }, meta: { count: 50 } };
    },
    'anime',
    'naruto',
    2,
  );
  assert.equal(page.source, 'Kitsu');
  assert.equal(page.hasNext, true);
  assert.equal(page.results[0].total, 26);
  let calls = 0;
  const fallback = await browseWith(
    async (url) => {
      calls++;
      if (url.includes('kitsu.app')) throw Error('upstream timeout');
      return {
        data: [{ mal_id: 1, title: 'Cowboy Bebop', episodes: 26 }],
        pagination: { has_next_page: false },
      };
    },
    'anime',
    '',
    1,
  );
  assert.equal(calls, 2);
  assert.equal(fallback.source, 'Jikan / MyAnimeList');
  assert.equal(fallback.results[0].total, 26);
  await assert.rejects(
    () =>
      detailWith(
        async () => {
          throw Error('must not fetch');
        },
        'anime',
        'kitsu',
        'https://evil.test',
      ),
    { key: 'badReference', status: 400 },
  );
  await assert.rejects(
    () =>
      browseWith(
        async () => {
          throw new DOMException('cancelled', 'AbortError');
        },
        'manga',
        '',
        1,
      ),
    { name: 'AbortError' },
  );
  const series = normalizeTVMaze({
    id: 1,
    name: 'Series',
    url: 'https://www.tvmaze.com/shows/1',
    _embedded: {
      episodes: [
        { number: 1, season: 1, airstamp: '2020-01-01' },
        { number: null, season: 1, airstamp: '2020-01-01' },
        { number: 2, season: 1, airstamp: '2099-01-01' },
      ],
    },
  });
  assert.equal(series.catalog.episodes, 2);
  assert.equal(series.catalog.available, 1);

  // ---- Feeds: each filter asks the source for the right list.
  const kitsuUrl = async (kind, feed) => {
    let seen = '';
    await browseWith(
      async (url) => {
        seen = decodeURIComponent(url);
        return { data: [], included: [] };
      },
      kind,
      '',
      1,
      { feed },
    );
    return seen;
  };
  assert.match(await kitsuUrl('anime', 'popular'), /sort=-userCount/);
  assert.match(await kitsuUrl('anime', 'top'), /sort=-averageRating/);
  assert.match(await kitsuUrl('anime', 'airing'), /filter\[status\]=current/);
  assert.match(await kitsuUrl('anime', 'upcoming'), /filter\[status\]=upcoming,unreleased/);
  const { season, year } = currentSeason(new Date());
  const seasonUrl = await kitsuUrl('anime', 'new');
  assert.ok(
    seasonUrl.includes(`filter[season]=${season}`) && seasonUrl.includes(`filter[seasonYear]=${year}`),
  );
  assert.deepEqual(currentSeason(new Date('2026-10-06T12:00:00Z')), { season: 'fall', year: 2026 });
  assert.deepEqual(currentSeason(new Date('2027-01-15T12:00:00Z')), { season: 'winter', year: 2027 });
  await assert.rejects(() => kitsuUrl('manga', 'upcoming'), { key: 'feedUnavailable', status: 400 });
  assert.deepEqual(feedsFor('film', false), ['popular', 'new', 'top']);
  assert.deepEqual(feedsFor('film', true), ['popular', 'new', 'upcoming', 'top']);

  // Jikan fallback: the current season list for "new" anime.
  let jikanUrl = '';
  await browseWith(
    async (url) => {
      if (url.includes('kitsu.app')) throw Error('down');
      jikanUrl = url;
      return { data: [], pagination: { has_next_page: false } };
    },
    'anime',
    '',
    1,
    { feed: 'new' },
  );
  assert.match(jikanUrl, /api\.jikan\.moe\/v4\/seasons\/now\?/);

  // Cinemeta without TMDB: "new" is this year's catalog.
  let cinemetaUrl = '';
  await browseWith(
    async (url) => {
      cinemetaUrl = url;
      return { metas: [] };
    },
    'film',
    '',
    1,
    { feed: 'new' },
  );
  assert.equal(
    cinemetaUrl,
    `https://v3-cinemeta.strem.io/catalog/movie/year/genre=${new Date().getUTCFullYear()}.json`,
  );

  // ---- TMDB: lists, genres, images, fallback and detail.
  const tmdbCalls = [];
  const tmdb = async (p, params = {}) => {
    tmdbCalls.push([p, params]);
    if (p.startsWith('/genre/')) return { genres: [{ id: 18, name: 'Drame' }] };
    return {
      results: [
        {
          id: 42,
          title: 'Film',
          release_date: '2026-11-20',
          genre_ids: [18],
          poster_path: '/p.jpg',
          backdrop_path: '/b.jpg',
          overview: 'Résumé',
          vote_average: 7.5,
          vote_count: 3,
        },
      ],
      total_pages: 3,
      total_results: 60,
    };
  };
  const upcoming = await browseWith(async () => assert.fail('no free source expected'), 'film', '', 1, {
    feed: 'upcoming',
    tmdb,
    lang: 'fr',
  });
  assert.deepEqual(tmdbCalls[0], ['/movie/upcoming', { page: '1', region: 'FR' }]);
  const film = upcoming.results[0];
  assert.equal(upcoming.source, 'TMDB');
  assert.equal(upcoming.hasNext, true);
  assert.equal(film.poster, 'https://image.tmdb.org/t/p/w500/p.jpg');
  assert.equal(film.backdrop, 'https://image.tmdb.org/t/p/w1280/b.jpg');
  assert.equal(film.sourceUrl, 'https://www.themoviedb.org/movie/42');
  assert.equal(film.startDate, '2026-11-20');
  assert.deepEqual(film.catalog.genres, ['Drame']);
  assert.equal(film.catalog.score, null, 'a score from 3 votes is hidden');
  const saved = mediaFromCatalog(film);
  assert.ok(
    !('backdrop' in saved) && !('startDate' in saved) && !('subtitle' in saved),
    'display-only fields are not saved',
  );

  tmdbCalls.length = 0;
  await browseWith(async () => assert.fail(), 'series', '', 2, { feed: 'upcoming', tmdb });
  assert.equal(tmdbCalls[0][0], '/discover/tv');
  assert.equal(tmdbCalls[0][1].page, '2');
  assert.ok(tmdbCalls[0][1]['first_air_date.gte'] > new Date().toISOString().slice(0, 10));

  // TMDB down: free sources take over when they can serve the feed, otherwise the error stays.
  const broken = async () => {
    throw Object.assign(Error('down'), { name: 'Error' });
  };
  const rescued = await browseWith(
    async () => ({ metas: [{ id: 'tt1', type: 'movie', name: 'Rescued' }] }),
    'film',
    '',
    1,
    { feed: 'popular', tmdb: broken },
  );
  assert.equal(rescued.source, 'Cinemeta / IMDb');
  await assert.rejects(
    () => browseWith(async () => ({ metas: [] }), 'film', '', 1, { feed: 'upcoming', tmdb: broken }),
    /down/,
  );

  // Detail: the browser fallback has no key; the server one counts aired episodes.
  await assert.rejects(() => detailWith(async () => ({}), 'film', 'tmdb', '42'), { key: 'unavailable' });
  const show = normalizeTmdb(
    {
      id: 7,
      name: 'Show',
      first_air_date: '2024-01-01',
      number_of_episodes: 30,
      number_of_seasons: 3,
      episode_run_time: [50],
      genres: [{ id: 1, name: 'Crime' }],
      seasons: [
        { season_number: 0, episode_count: 4 },
        { season_number: 1, episode_count: 10 },
        { season_number: 2, episode_count: 10 },
        { season_number: 3, episode_count: 10 },
      ],
      last_episode_to_air: { season_number: 3, episode_number: 4 },
    },
    'series',
    {},
    true,
  );
  assert.equal(show.total, 30);
  assert.equal(show.catalog.available, 24, 'two full seasons + 4 episodes; specials excluded');
  assert.equal(show.duration, 50);
  assert.equal(show.catalog.seasons, 3);
  console.log(
    'Catalogue regression checks passed: metadata, null counts, source fallback, pagination, cancellation, ID validation, episode availability, feeds and TMDB.',
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
