'use client';
import { useState, useEffect, useRef } from 'react';
import {
  Search,
  Plus,
  Check,
  Star,
  BookOpen,
  Film,
  Clapperboard,
  LibraryBig,
  RefreshCw,
  LoaderCircle,
  ExternalLink,
  Flame,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetTitle, SheetDescription, SheetHeader } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { Pagination, PaginationContent, PaginationItem } from '@/components/ui/pagination';
import { type Kind, type Media } from '@/lib/watch';
import { type CatalogItem, type CatalogPage, sameTitle } from '@/lib/catalog';
import type { Messages } from '@/lib/i18n';
import { useI18n } from './i18n-provider';
const categories = [
  { key: 'anime', icon: Clapperboard },
  { key: 'manga', icon: BookOpen },
  { key: 'film', icon: Film },
  { key: 'series', icon: LibraryBig },
] as const;
import { loadCatalog, loadDetail as loadCatalogDetail, catalogErrorText } from '@/lib/catalog-client';
export { loadDetail as loadCatalogDetail } from '@/lib/catalog-client';

/** Source values (English or French) shown in the interface language when known. */
const translated = (map: Record<string, string>, value: string) => map[value] || value;

export function countLabel(item: CatalogItem, t: Messages) {
  const c = item.catalog;
  if (item.kind === 'film') return c.durationKnown ? `${item.duration} min` : t.catalog.filmCount;
  if (item.kind === 'manga')
    return c.chapters !== null
      ? t.catalog.chapterCount(c.chapters)
      : c.volumes !== null
        ? t.catalog.volumeCount(c.volumes)
        : t.catalog.chaptersUnknown;
  if (c.episodes !== null) return t.catalog.episodeCount(c.episodes);
  return c.seasons !== null ? t.catalog.seasonCount(c.seasons) : t.catalog.episodesSeeDetails;
}
export function CatalogPoster({ item, className = '' }: { item: CatalogItem; className?: string }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.poster]);
  return item.poster && !failed ? (
    <img
      className={className}
      src={item.poster}
      alt={t.catalog.coverOf(item.title)}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <div className={`catalog-no-cover ${className}`}>
      <BookOpen size={32} />
      <span>{t.catalog.noCover}</span>
    </div>
  );
}
function facts(item: CatalogItem, t: Messages) {
  const c = item.catalog;
  const rows: { label: string; value: string; unknown: boolean }[] = [];
  const count = (label: string, value: number | null) =>
    rows.push({ label, value: value === null ? t.catalog.unknown : String(value), unknown: value === null });
  if (item.kind === 'anime' || item.kind === 'series') count(t.catalog.episodesListed, c.episodes);
  if (item.kind === 'manga') {
    count(t.catalog.chapters, c.chapters);
    count(t.catalog.volumes, c.volumes);
  }
  if (item.kind === 'series') count(t.catalog.seasons, c.seasons);
  if (item.kind !== 'manga')
    rows.push({
      label: item.kind === 'film' ? t.catalog.runtime : t.catalog.episodeLength,
      value: c.durationKnown ? `${item.duration} min` : t.catalog.unknown,
      unknown: !c.durationKnown,
    });
  if (c.available !== null && item.kind !== 'film')
    rows.push({ label: t.catalog.aired, value: String(c.available), unknown: false });
  if (c.releaseStatus)
    rows.push({
      label: t.catalog.releaseStatus,
      value: translated(t.catalog.releaseStatuses, c.releaseStatus),
      unknown: false,
    });
  return rows;
}
export function CatalogDetail({
  item,
  collection,
  saving,
  onClose,
  onAdd,
  onEdit,
}: {
  item: CatalogItem;
  collection: Media[];
  saving: boolean;
  onClose: () => void;
  onAdd: (i: CatalogItem, priority: boolean) => Promise<boolean>;
  onEdit: (m: Media) => void;
}) {
  const { t } = useI18n();
  const [detail, setDetail] = useState(item);
  const [loading, setLoading] = useState(!!item.catalog.id);
  const [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  const [adding, setAdding] = useState(false);
  const [priority, setPriority] = useState(false);
  const current = collection.find((m) => sameTitle(m, detail));
  useEffect(() => {
    const controller = new AbortController();
    setLoading(!!item.catalog.id);
    setDetail(item);
    setError(null);
    if (!item.catalog.id) return;
    loadCatalogDetail(item, controller.signal)
      .then(setDetail)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [item, retry]);
  const add = async () => {
    setAdding(true);
    try {
      await onAdd(detail, priority);
    } finally {
      setAdding(false);
    }
  };
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="catalog-detail-sheet">
        <SheetHeader className="catalog-detail-heading">
          <SheetTitle>{t.catalog.detailTitle}</SheetTitle>
          <SheetDescription>{t.catalog.detailDescription}</SheetDescription>
        </SheetHeader>
        <div className="catalog-detail-scroll">
          <div className="catalog-detail-hero">
            <CatalogPoster item={detail} />
            <div>
              <p className="eyebrow">
                {t.kindsPlural[detail.kind]} {detail.catalog.year && `/ ${detail.catalog.year}`}
              </p>
              <h2>{detail.title}</h2>
              <div className="catalog-detail-tags">
                {detail.catalog.format && <span>{translated(t.catalog.formats, detail.catalog.format)}</span>}
                {detail.catalog.score !== null && (
                  <span className="catalog-score">
                    <Star size={14} fill="currentColor" />
                    {detail.catalog.score.toFixed(1)} / 10
                  </span>
                )}
              </div>
              <p className="subdued">{countLabel(detail, t)}</p>
            </div>
          </div>
          {error !== null && (
            <div className="notice danger" role="status">
              {catalogErrorText(error, t)} {detail.catalog.synopsis ? t.catalog.keptInfo : ''}
              <button className="ghost-btn small-btn" onClick={() => setRetry((n) => n + 1)}>
                <RefreshCw size={14} />
                {t.common.retry}
              </button>
            </div>
          )}
          <div className="catalog-facts" aria-busy={loading}>
            {facts(detail, t).map((f) => (
              <div key={f.label}>
                <span>{f.label}</span>
                {loading && f.unknown ? <Skeleton className="h-5 w-16" /> : <strong>{f.value}</strong>}
              </div>
            ))}
          </div>
          {detail.catalog.genres.length > 0 && (
            <div className="catalog-genres">
              {detail.catalog.genres.map((g) => (
                <span key={g}>{g}</span>
              ))}
            </div>
          )}
          <section className="catalog-synopsis">
            <h3>{t.catalog.synopsis}</h3>
            {loading && !detail.catalog.synopsis ? (
              <div className="loading-grid">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            ) : (
              <p>{detail.catalog.synopsis || t.catalog.noSynopsis}</p>
            )}
            <small>{t.catalog.synopsisLanguage}</small>
          </section>
          <div className="catalog-attribution">
            <span>
              {t.catalog.source}{' '}
              {detail.catalog.source === 'kitsu'
                ? 'Kitsu'
                : detail.catalog.source === 'jikan'
                  ? 'Jikan / MyAnimeList'
                  : detail.catalog.source === 'tvmaze'
                    ? 'TVmaze · CC BY-SA'
                    : 'Cinemeta / IMDb'}
            </span>
            {detail.sourceUrl && (
              <a href={detail.sourceUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={13} />
                {t.catalog.viewSource}
              </a>
            )}
          </div>
          {detail.catalog.available !== null &&
            detail.catalog.episodes !== null &&
            detail.catalog.available < detail.catalog.episodes && (
              <p className="form-hint">{t.catalog.upcomingHint}</p>
            )}
        </div>
        <div className="catalog-detail-footer">
          {current ? (
            <>
              <p className="inline-note">
                <Check size={17} />
                {t.catalog.alreadyIn(current.priority)}
              </p>
              <button className="primary full" onClick={() => onEdit(current)}>
                {t.catalog.setProgress}
              </button>
            </>
          ) : (
            <>
              <button
                className={`catalog-priority ${priority ? 'selected' : ''}`}
                aria-pressed={priority}
                onClick={() => setPriority((p) => !p)}
              >
                <Flame size={17} />
                {priority ? t.mediaEditor.priority : t.catalog.makePriority}
              </button>
              <button className="primary full" disabled={saving || loading || adding} onClick={add}>
                {adding ? <LoaderCircle size={17} className="loading-icon" /> : <Plus size={17} />}
                {t.catalog.addToList}
              </button>
              <p className="form-hint">{t.catalog.laterHint}</p>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
export default function CatalogBrowser({
  collection,
  saving,
  onAdd,
  onDetail,
  onManual,
}: {
  collection: Media[];
  saving: boolean;
  onAdd: (item: CatalogItem, priority: boolean) => Promise<boolean>;
  onDetail: (item: CatalogItem) => void;
  onManual: () => void;
}) {
  const { t, locale } = useI18n();
  const [kind, setKind] = useState<Kind>('anime');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CatalogPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  const [busyId, setBusyId] = useState('');
  const cache = useRef(new Map<string, CatalogPage>());
  useEffect(() => {
    const c = new AbortController();
    const params = new URLSearchParams({ kind, page: String(page), q: search });
    const key = params.toString();
    const saved = cache.current.get(key);
    setError(null);
    if (saved && !retry) {
      setData(saved);
      setLoading(false);
      return;
    }
    setLoading(true);
    setData(null);
    loadCatalog(kind, search, page, c.signal)
      .then((result) => {
        if (c.signal.aborted) return;
        setData(result);
        if (cache.current.size > 20) cache.current.clear();
        cache.current.set(key, result);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [kind, search, page, retry]);
  const changeKind = (v: string) => {
    setKind(v as Kind);
    setPage(1);
    setRetry(0);
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(query.trim());
    setPage(1);
    setRetry((n) => n + 1);
  };
  const select = async (item: CatalogItem) => {
    setBusyId(item.catalog.id);
    try {
      const detail = await loadCatalogDetail(item);
      await onAdd(detail, false);
    } catch {
      onDetail(item);
    } finally {
      setBusyId('');
    }
  };
  return (
    <section className="catalog-browser">
      <Tabs value={kind} onValueChange={changeKind} className="catalog-tabs">
        <TabsList aria-label={t.catalog.categoriesAria}>
          {categories.map(({ key, icon: Icon }) => (
            <TabsTrigger value={key} key={key}>
              <Icon size={18} />
              {t.kindsPlural[key]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <form className="catalog-search-bar" onSubmit={submit}>
        <Search size={20} />
        <input
          value={query}
          maxLength={150}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t.catalog.searchAria}
          placeholder={t.catalog.searchPlaceholders[kind]}
        />
        <button className="primary" disabled={loading && search === query.trim()} type="submit">
          {t.catalog.search}
        </button>
      </form>
      <div className="catalog-section-heading">
        <div>
          <h2>
            {search
              ? t.catalog.resultsFor(search)
              : kind === 'series'
                ? t.catalog.headingSeries
                : kind === 'film'
                  ? t.catalog.headingFilm
                  : t.catalog.headingDefault}
          </h2>
          <p>{search ? t.catalog.pickCover : t.catalog.explore}</p>
        </div>
        {search && (
          <button
            className="ghost-btn small-btn"
            onClick={() => {
              setQuery('');
              setSearch('');
              setPage(1);
            }}
          >
            {t.catalog.clearSearch}
          </button>
        )}
      </div>
      {loading ? (
        <div className="catalog-grid" aria-label={t.catalog.loadingCovers}>
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i}>
              <Skeleton className="catalog-poster-skeleton" />
              <Skeleton className="h-5 w-4/5 mt-3" />
              <Skeleton className="h-4 w-3/5 mt-3" />
            </div>
          ))}
        </div>
      ) : error !== null ? (
        <div className="catalog-error" role="alert">
          <RefreshCw size={30} />
          <h3>{t.catalog.paused}</h3>
          <p>{catalogErrorText(error, t)}</p>
          <button className="secondary" onClick={() => setRetry((n) => n + 1)}>
            <RefreshCw size={16} />
            {t.common.retry}
          </button>
          <button className="ghost-btn" onClick={onManual}>
            {t.catalog.addManuallyInstead}
          </button>
        </div>
      ) : data?.results.length ? (
        <>
          <div className="catalog-grid">
            {data.results.map((item) => {
              const added = collection.some((m) => sameTitle(m, item));
              const busy = busyId === item.catalog.id;
              return (
                <article className="catalog-card" key={`${item.catalog.source}:${item.catalog.id}`}>
                  <button
                    className="catalog-cover-button"
                    onClick={() => onDetail(item)}
                    aria-label={t.media.viewDetailsOf(item.title)}
                  >
                    <CatalogPoster item={item} />
                    {item.catalog.score !== null && (
                      <span className="cover-score">
                        <Star size={12} fill="currentColor" />
                        {item.catalog.score.toFixed(1)}
                      </span>
                    )}
                    {added && (
                      <span className="cover-added">
                        <Check size={13} />
                        {t.catalog.inMyList}
                      </span>
                    )}
                  </button>
                  <div className="catalog-card-body">
                    <button className="catalog-title" onClick={() => onDetail(item)}>
                      {item.title}
                    </button>
                    <p>
                      {[
                        item.catalog.year,
                        item.catalog.format && translated(t.catalog.formats, item.catalog.format),
                      ]
                        .filter(Boolean)
                        .join(' · ') || t.kindsPlural[kind]}
                    </p>
                    <span className="catalog-count">{countLabel(item, t)}</span>
                    <button
                      className={`catalog-add-button ${added ? 'added' : ''}`}
                      disabled={added || saving || !!busyId}
                      onClick={() => select(item)}
                    >
                      {busy ? (
                        <LoaderCircle size={15} className="loading-icon" />
                      ) : added ? (
                        <Check size={15} />
                      ) : (
                        <Plus size={15} />
                      )}{' '}
                      {added ? t.catalog.inMyList : t.catalog.myList}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="catalog-pagination-row">
            <span className="form-hint">
              {data.totalResults !== null
                ? t.catalog.titlesFound(data.totalResults.toLocaleString(locale))
                : t.catalog.sourceLine(data.source)}{' '}
              · {t.catalog.page(page)}
            </span>
            <Pagination aria-label={t.catalog.pagesAria}>
              <PaginationContent>
                <PaginationItem>
                  <button
                    className="secondary small-btn"
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft size={15} />
                    {t.catalog.previous}
                  </button>
                </PaginationItem>
                <PaginationItem>
                  <span className="page-indicator" aria-current="page">
                    {page}
                  </span>
                </PaginationItem>
                <PaginationItem>
                  <button
                    className="secondary small-btn"
                    disabled={!data.hasNext}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t.catalog.next}
                    <ChevronRight size={15} />
                  </button>
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        </>
      ) : (
        <Empty className="catalog-empty">
          <EmptyHeader>
            <Search size={30} />
            <EmptyTitle>{t.catalog.noneFound}</EmptyTitle>
            <EmptyDescription>{t.catalog.noneFoundHint}</EmptyDescription>
          </EmptyHeader>
          <button className="secondary" onClick={onManual}>
            {t.catalog.addManually}
          </button>
        </Empty>
      )}
      <div className="catalog-bottom-note">
        <p>
          {t.catalog.sources}{' '}
          <a href="https://kitsu.app" target="_blank" rel="noreferrer">
            Kitsu
          </a>
          ,{' '}
          <a href="https://jikan.moe" target="_blank" rel="noreferrer">
            Jikan / MyAnimeList
          </a>
          ,{' '}
          <a href="https://www.tvmaze.com/api" target="_blank" rel="noreferrer">
            TVmaze (CC BY-SA)
          </a>
          ,{' '}
          <a href="https://www.stremio.com" target="_blank" rel="noreferrer">
            Cinemeta
          </a>
          . {t.catalog.sourcesNote}
        </p>
        <button className="ghost-btn small-btn" onClick={onManual}>
          {t.catalog.notFoundManual}
        </button>
      </div>
    </section>
  );
}
