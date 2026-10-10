'use client';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BookOpen,
  BookText,
  Check,
  Clapperboard,
  Film,
  LayoutGrid,
  LibraryBig,
  LoaderCircle,
  Plus,
  Smartphone,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { sameTitle, type CatalogItem, type CatalogPage } from '@/lib/catalog';
import { feedsFor, type Feed } from '@/lib/catalog-gateway';
import { loadCatalog, loadDetail } from '@/lib/catalog-client';
import type { Lang } from '@/lib/i18n';
import type { CatalogKind, Media } from '@/lib/watch';
import { CatalogPoster, feedLabel } from './catalog-browser';
import { HeroCarousel } from './hero-carousel';
import { useI18n } from './i18n-provider';

type HomeKind = CatalogKind | 'all';
const kinds = [
  { key: 'all', icon: LayoutGrid },
  { key: 'anime', icon: Clapperboard },
  { key: 'manga', icon: BookOpen },
  { key: 'manhwa', icon: Smartphone },
  { key: 'novel', icon: BookText },
  { key: 'film', icon: Film },
  { key: 'series', icon: LibraryBig },
] as const;
// "Tout": the carousel mixes what is new in these, and each kind gets its "popular" row.
const ALL_HERO: CatalogKind[] = ['anime', 'film', 'series'];
const ALL_ROWS: CatalogKind[] = ['anime', 'manga', 'series', 'film', 'manhwa', 'novel'];

// One request per list for 10 minutes, shared by the carousel and the rows across views.
const TTL = 10 * 60 * 1000;
const feedCache = new Map<string, { until: number; promise: Promise<CatalogPage> }>();
function loadFeed(kind: CatalogKind, feed: Feed, lang: Lang): Promise<CatalogPage> {
  const key = `${lang}:${kind}:${feed}`;
  const cached = feedCache.get(key);
  if (cached && cached.until > Date.now()) return cached.promise;
  const promise = loadCatalog(kind, '', 1, undefined, feed);
  feedCache.set(key, { until: Date.now() + TTL, promise });
  promise.catch(() => feedCache.delete(key));
  return promise;
}
/** What a row or the carousel can do; the same object for the page's whole life. */
type Actions = {
  add: (item: CatalogItem) => Promise<boolean>;
  detail: (item: CatalogItem) => void;
  seeAll: (kind: CatalogKind, feed: Feed) => void;
};

/** Turns true once the element comes within ~one screen of the viewport, and stays true. */
function useNear<T extends Element>() {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: '600px 0px' },
    );
    watch.observe(el);
    return () => watch.disconnect();
  }, [near]);
  return [ref, near] as const;
}

/** Several lists at once (null while they load); `failed` when none of them could load. */
function useFeeds(sources: [CatalogKind, Feed][], lang: Lang) {
  const key = `${lang}|${sources.map(([k, f]) => `${k}:${f}`).join('|')}`;
  const [state, setState] = useState<{ key: string; pages: (CatalogPage | null)[] } | null>(null);
  useEffect(() => {
    let live = true;
    Promise.allSettled(sources.map(([k, f]) => loadFeed(k, f, lang))).then((results) => {
      if (live) setState({ key, pages: results.map((r) => (r.status === 'fulfilled' ? r.value : null)) });
    });
    return () => {
      live = false;
    };
    // `key` stands for the sources and the language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!state || state.key !== key) return null;
  return { pages: state.pages, failed: state.pages.every((p) => !p) };
}

function useFeed(kind: CatalogKind, feed: Feed, lang: Lang) {
  const [state, setState] = useState<{ page: CatalogPage | null; failed: boolean }>({
    page: null,
    failed: false,
  });
  useEffect(() => {
    let live = true;
    setState({ page: null, failed: false });
    loadFeed(kind, feed, lang)
      .then((page) => live && setState({ page, failed: false }))
      .catch(() => live && setState({ page: null, failed: true }));
    return () => {
      live = false;
    };
  }, [kind, feed, lang]);
  return state;
}

export default function HomeView({
  tmdb,
  collection,
  saving,
  onAdd,
  onDetail,
  onSeeAll,
  tonight,
}: {
  tmdb: boolean;
  collection: Media[];
  saving: boolean;
  onAdd: (item: CatalogItem, priority: boolean) => Promise<boolean>;
  onDetail: (item: CatalogItem) => void;
  onSeeAll: (kind: CatalogKind, feed: Feed) => void;
  tonight?: ReactNode;
}) {
  const { t, lang } = useI18n();
  const [kind, setKind] = useState<HomeKind>('all');
  const feeds = kind === 'all' ? [] : feedsFor(kind, tmdb);
  const heroFeed: Feed =
    kind === 'all' ? 'new' : feeds.includes('new') ? 'new' : feeds.includes('airing') ? 'airing' : 'popular';
  const heroSources: [CatalogKind, Feed][] =
    kind === 'all' ? ALL_HERO.map((k) => [k, 'new']) : [[kind, heroFeed]];
  const hero = useFeeds(heroSources, lang);
  const heroItems = useMemo(() => {
    if (!hero) return [];
    // Titles with a wide image first; with several lists, take them in turn.
    const lists = hero.pages.map((page) =>
      [...(page?.results || [])].sort((a, b) => Number(Boolean(b.backdrop)) - Number(Boolean(a.backdrop))),
    );
    const mixed: CatalogItem[] = [];
    for (let i = 0; mixed.length < 8 && lists.some((l) => i < l.length); i++)
      for (const list of lists) if (list[i] && mixed.length < 8) mixed.push(list[i]);
    return mixed;
  }, [hero]);
  const rows: { kind: CatalogKind; feed: Feed; title?: string }[] =
    kind === 'all'
      ? ALL_ROWS.map((k) => ({ kind: k, feed: 'popular', title: t.home.popularOf(t.kindsPlural[k]) }))
      : feeds.map((feed) => ({ kind, feed }));
  // List entries can lack counts; load the full record first, as the catalog does.
  const addWithDetail = async (item: CatalogItem) => {
    try {
      return await onAdd(await loadDetail(item), false);
    } catch {
      onDetail(item);
      return false;
    }
  };
  // The app redraws often while it loads (account, list…). The rows and the carousel only redraw
  // when their own data changes: they call the latest actions through this stable object.
  const latest = useRef<Actions>({ add: addWithDetail, detail: onDetail, seeAll: onSeeAll });
  useLayoutEffect(() => {
    latest.current = { add: addWithDetail, detail: onDetail, seeAll: onSeeAll };
  });
  const actions = useMemo<Actions>(
    () => ({
      add: (item) => latest.current.add(item),
      detail: (item) => latest.current.detail(item),
      seeAll: (k, f) => latest.current.seeAll(k, f),
    }),
    [],
  );

  return (
    <div className="home">
      <div className="kind-pills" role="tablist" aria-label={t.catalog.categoriesAria}>
        {kinds.map(({ key, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={kind === key}
            className={kind === key ? 'on' : ''}
            onClick={() => setKind(key)}
          >
            <Icon size={17} />
            {key === 'all' ? t.home.all : t.kindsPlural[key]}
          </button>
        ))}
      </div>
      {hero && !hero.failed ? (
        <HeroCarousel
          key={`${kind}:${heroFeed}`}
          items={heroItems}
          feed={heroFeed}
          collection={collection}
          saving={saving}
          onAdd={actions.add}
          onDetail={actions.detail}
        />
      ) : hero?.failed ? null : (
        <Skeleton className="hero-skeleton" />
      )}
      {tonight}
      {rows.map((row) => (
        <FeedRow
          key={`${row.kind}:${row.feed}`}
          kind={row.kind}
          feed={row.feed}
          title={row.title}
          lang={lang}
          saving={saving}
          collection={collection}
          actions={actions}
        />
      ))}
    </div>
  );
}

const FeedRow = memo(function FeedRow({
  kind,
  feed,
  title: customTitle,
  lang,
  saving,
  collection,
  actions,
}: {
  kind: CatalogKind;
  feed: Feed;
  /** In place of the list's usual name (e.g. "Mangas populaires" under "Tout"). */
  title?: string;
  lang: Lang;
  saving: boolean;
  collection: Media[];
  actions: Actions;
}) {
  const { t, locale } = useI18n();
  const isAdded = (item: CatalogItem) => collection.some((m) => sameTitle(m, item));
  const { page, failed } = useFeed(kind, feed, lang);
  // The list is fetched right away (it is small), but its cards and covers are only drawn when the
  // row comes near the screen: the rows further down do not slow the top of the page.
  const [rowRef, near] = useNear<HTMLElement>();
  const [busy, setBusy] = useState('');
  const title = customTitle || feedLabel(t, kind, feed);
  const meta = (item: CatalogItem) => {
    if (feed === 'upcoming' && item.startDate)
      return new Date(item.startDate + 'T12:00:00').toLocaleDateString(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    const format = item.catalog.format
      ? (t.catalog.formats as Record<string, string>)[item.catalog.format] || item.catalog.format
      : '';
    return [item.catalog.year, format].filter(Boolean).join(' · ');
  };
  const add = async (item: CatalogItem) => {
    setBusy(`${item.catalog.source}:${item.catalog.id}`);
    try {
      await actions.add(item);
    } finally {
      setBusy('');
    }
  };
  return (
    <section className="feed-row" aria-label={title} ref={rowRef}>
      <div className="feed-row-heading">
        <h2>{title}</h2>
        <button className="ghost-btn small-btn" onClick={() => actions.seeAll(kind, feed)}>
          {t.today.seeAll}
        </button>
      </div>
      {failed ? (
        <p className="inline-note">{t.home.rowError}</p>
      ) : !page || !near ? (
        <div className="feed-row-track" aria-busy="true">
          {Array.from({ length: 7 }, (_, i) => (
            <div className="row-card" key={i}>
              <Skeleton className="row-card-skeleton" />
            </div>
          ))}
        </div>
      ) : page.results.length === 0 ? (
        <p className="inline-note">{t.home.rowEmpty}</p>
      ) : (
        <div className="feed-row-track">
          {page.results.map((item) => {
            const key = `${item.catalog.source}:${item.catalog.id}`;
            const added = isAdded(item);
            return (
              <article className="row-card" key={key}>
                <button
                  className="row-cover"
                  onClick={() => actions.detail(item)}
                  aria-label={t.media.viewDetailsOf(item.title)}
                >
                  <CatalogPoster item={item} />
                </button>
                <button
                  className={`row-add ${added ? 'added' : ''}`}
                  aria-label={
                    added ? `${t.catalog.inMyList}, ${item.title}` : `${t.catalog.addToList}, ${item.title}`
                  }
                  disabled={added || saving || busy !== ''}
                  onClick={() => add(item)}
                >
                  {busy === key ? (
                    <LoaderCircle size={16} className="loading-icon" />
                  ) : added ? (
                    <Check size={16} />
                  ) : (
                    <Plus size={16} />
                  )}
                </button>
                <strong>{item.title}</strong>
                <span>{meta(item)}</span>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
});
