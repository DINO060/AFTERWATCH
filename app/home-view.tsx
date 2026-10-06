'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { BookOpen, Check, Clapperboard, Film, LibraryBig, LoaderCircle, Plus } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { sameTitle, type CatalogItem, type CatalogPage } from '@/lib/catalog';
import { feedsFor, type Feed } from '@/lib/catalog-gateway';
import { loadCatalog, loadDetail } from '@/lib/catalog-client';
import type { Lang } from '@/lib/i18n';
import type { Kind, Media } from '@/lib/watch';
import { CatalogPoster, feedLabel } from './catalog-browser';
import { HeroCarousel } from './hero-carousel';
import { useI18n } from './i18n-provider';

const kinds = [
  { key: 'anime', icon: Clapperboard },
  { key: 'manga', icon: BookOpen },
  { key: 'film', icon: Film },
  { key: 'series', icon: LibraryBig },
] as const;

// One request per list for 10 minutes, shared by the carousel and the rows across views.
const TTL = 10 * 60 * 1000;
const feedCache = new Map<string, { until: number; promise: Promise<CatalogPage> }>();
function loadFeed(kind: Kind, feed: Feed, lang: Lang): Promise<CatalogPage> {
  const key = `${lang}:${kind}:${feed}`;
  const cached = feedCache.get(key);
  if (cached && cached.until > Date.now()) return cached.promise;
  const promise = loadCatalog(kind, '', 1, undefined, feed);
  feedCache.set(key, { until: Date.now() + TTL, promise });
  promise.catch(() => feedCache.delete(key));
  return promise;
}
function useFeed(kind: Kind, feed: Feed, lang: Lang) {
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
  onSeeAll: (kind: Kind, feed: Feed) => void;
  tonight?: ReactNode;
}) {
  const { t, lang } = useI18n();
  const [kind, setKind] = useState<Kind>('anime');
  const feeds = feedsFor(kind, tmdb);
  const heroFeed: Feed = feeds.includes('new') ? 'new' : feeds.includes('airing') ? 'airing' : 'popular';
  const hero = useFeed(kind, heroFeed, lang);
  const heroItems = hero.page
    ? [...hero.page.results]
        .sort((a, b) => Number(Boolean(b.backdrop)) - Number(Boolean(a.backdrop)))
        .slice(0, 8)
    : [];
  const isAdded = (item: CatalogItem) => collection.some((m) => sameTitle(m, item));
  // List entries can lack counts; load the full record first, as the catalog does.
  const addWithDetail = async (item: CatalogItem) => {
    try {
      return await onAdd(await loadDetail(item), false);
    } catch {
      onDetail(item);
      return false;
    }
  };

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
            {t.kindsPlural[key]}
          </button>
        ))}
      </div>
      {hero.page ? (
        <HeroCarousel
          key={`${kind}:${heroFeed}`}
          items={heroItems}
          feed={heroFeed}
          isAdded={isAdded}
          saving={saving}
          onAdd={addWithDetail}
          onDetail={onDetail}
        />
      ) : hero.failed ? null : (
        <Skeleton className="hero-skeleton" />
      )}
      {tonight}
      {feeds.map((feed) => (
        <FeedRow
          key={`${kind}:${feed}`}
          kind={kind}
          feed={feed}
          lang={lang}
          saving={saving}
          isAdded={isAdded}
          onAdd={addWithDetail}
          onDetail={onDetail}
          onSeeAll={() => onSeeAll(kind, feed)}
        />
      ))}
    </div>
  );
}

function FeedRow({
  kind,
  feed,
  lang,
  saving,
  isAdded,
  onAdd,
  onDetail,
  onSeeAll,
}: {
  kind: Kind;
  feed: Feed;
  lang: Lang;
  saving: boolean;
  isAdded: (item: CatalogItem) => boolean;
  onAdd: (item: CatalogItem) => Promise<unknown>;
  onDetail: (item: CatalogItem) => void;
  onSeeAll: () => void;
}) {
  const { t, locale } = useI18n();
  const { page, failed } = useFeed(kind, feed, lang);
  const [busy, setBusy] = useState('');
  const title = feedLabel(t, kind, feed);
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
      await onAdd(item);
    } finally {
      setBusy('');
    }
  };
  return (
    <section className="feed-row" aria-label={title}>
      <div className="feed-row-heading">
        <h2>{title}</h2>
        <button className="ghost-btn small-btn" onClick={onSeeAll}>
          {t.today.seeAll}
        </button>
      </div>
      {failed ? (
        <p className="inline-note">{t.home.rowError}</p>
      ) : !page ? (
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
                  onClick={() => onDetail(item)}
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
}
