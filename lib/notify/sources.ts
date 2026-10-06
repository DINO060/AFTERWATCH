// Where new episodes come from: AniList's airing schedule for anime (matched by MyAnimeList id),
// TMDB and TVmaze for series. Server-only.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TmdbFetch } from '../catalog-gateway';
import { catalogJson } from '../catalog-server';
import type { AiredEpisode } from './plan';

const push = (map: Map<string, AiredEpisode[]>, episode: AiredEpisode) =>
  map.set(episode.key, [...(map.get(episode.key) || []), episode]);

/** Anime episodes that aired in (since, now], keyed `mal:<MyAnimeList id>`. */
export async function airedAnime(since: number, now: number): Promise<Map<string, AiredEpisode[]>> {
  const map = new Map<string, AiredEpisode[]>();
  const query = `query ($from: Int, $to: Int, $page: Int) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) { episode media { idMal } }
    }
  }`;
  for (let page = 1; page <= 4; page++) {
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      // Bounds are exclusive on AniList: one extra second includes `now`.
      body: JSON.stringify({
        query,
        variables: { from: Math.floor(since / 1000), to: Math.floor(now / 1000) + 1, page },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`AniList ${response.status}`);
    const data: any = await response.json();
    for (const item of data?.data?.Page?.airingSchedules || []) {
      const mal = item?.media?.idMal;
      if (Number.isInteger(mal) && Number.isInteger(item.episode))
        push(map, { key: `mal:${mal}`, episode: item.episode, season: null });
    }
    if (!data?.data?.Page?.pageInfo?.hasNextPage) break;
  }
  return map;
}

/** MyAnimeList ids of Kitsu anime, cached in catalog_links; a few new lookups per run. */
export async function malIdsForKitsu(
  admin: SupabaseClient,
  kitsuIds: string[],
): Promise<Map<string, number | null>> {
  const ids = [...new Set(kitsuIds)].filter((id) => /^\d{1,9}$/.test(id));
  const result = new Map<string, number | null>();
  if (!ids.length) return result;
  const { data } = await admin.from('catalog_links').select('kitsu_id, mal_id').in('kitsu_id', ids);
  for (const row of data || []) result.set(row.kitsu_id, row.mal_id);
  const fresh: { kitsu_id: string; mal_id: number | null }[] = [];
  for (const id of ids.filter((id) => !result.has(id)).slice(0, 25)) {
    try {
      const mapping = await catalogJson(
        `https://kitsu.app/api/edge/anime/${id}/mappings?filter[externalSite]=myanimelist/anime`,
      );
      const mal = Number(mapping?.data?.[0]?.attributes?.externalId);
      const value = Number.isInteger(mal) && mal > 0 ? mal : null;
      result.set(id, value);
      fresh.push({ kitsu_id: id, mal_id: value });
    } catch {
      // Kitsu unavailable: try again on a later run.
    }
  }
  if (fresh.length) await admin.from('catalog_links').upsert(fresh);
  return result;
}

/** Latest aired episode of followed series, kept when it aired in the last 36 hours. */
export async function airedSeries(
  keys: string[],
  now: number,
  tmdb: TmdbFetch | undefined,
): Promise<Map<string, AiredEpisode[]>> {
  const map = new Map<string, AiredEpisode[]>();
  const recent = now - 36 * 3600 * 1000;
  for (const key of [...new Set(keys)].slice(0, 80)) {
    const [source, id] = key.split(':');
    if (!/^\d{1,9}$/.test(id || '')) continue;
    try {
      if (source === 'tmdb' && tmdb) {
        const last = (await tmdb(`/tv/${id}`))?.last_episode_to_air;
        // TMDB gives a date only: count the whole day.
        const day = Date.parse(`${last?.air_date}T23:59:59Z`);
        if (day >= recent && Date.parse(`${last.air_date}T00:00:00Z`) <= now)
          push(map, { key, episode: last.episode_number, season: last.season_number ?? null });
      } else if (source === 'tvmaze') {
        const previous = (await catalogJson(`https://api.tvmaze.com/shows/${id}?embed=previousepisode`))
          ?._embedded?.previousepisode;
        const at = Date.parse(previous?.airstamp || '');
        if (at >= recent && at <= now)
          push(map, { key, episode: previous.number, season: previous.season ?? null });
      }
    } catch {
      // One series failing does not stop the others.
    }
  }
  return map;
}
