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
  const { browseWith, detailWith } = await import(pathToFileURL(path.join(temp, 'catalog-gateway.mjs')).href);
  const { normalizeKitsu, normalizeTVMaze } = await import(
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
  console.log(
    'Catalogue regression checks passed: metadata, null counts, source fallback, pagination, cancellation, ID validation and episode availability.',
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
