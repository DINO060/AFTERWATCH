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
  Clock3,
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
import { type CatalogItem, type CatalogPage, sameTitle, countLabel } from '@/lib/catalog';
const categories = [
  { key: 'anime', name: 'Anime', icon: Clapperboard },
  { key: 'manga', name: 'Mangas', icon: BookOpen },
  { key: 'film', name: 'Films', icon: Film },
  { key: 'series', name: 'Séries', icon: LibraryBig },
] as const;
import { loadCatalog, loadDetail as loadCatalogDetail } from '@/lib/catalog-client';
export { loadDetail as loadCatalogDetail } from '@/lib/catalog-client';
export function CatalogPoster({ item, className = '' }: { item: CatalogItem; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.poster]);
  return item.poster && !failed ? (
    <img
      className={className}
      src={item.poster}
      alt={`Couverture de ${item.title}`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <div className={`catalog-no-cover ${className}`}>
      <BookOpen size={32} />
      <span>Affiche indisponible</span>
    </div>
  );
}
function facts(item: CatalogItem) {
  const c = item.catalog;
  const rows: { label: string; value: string }[] = [];
  if (item.kind === 'anime' || item.kind === 'series')
    rows.push({
      label: 'Épisodes répertoriés',
      value: c.episodes === null ? 'Non renseigné' : String(c.episodes),
    });
  if (item.kind === 'manga')
    rows.push(
      { label: 'Chapitres', value: c.chapters === null ? 'Non renseigné' : String(c.chapters) },
      { label: 'Tomes', value: c.volumes === null ? 'Non renseigné' : String(c.volumes) },
    );
  if (item.kind === 'series')
    rows.push({ label: 'Saisons', value: c.seasons === null ? 'Non renseigné' : String(c.seasons) });
  if (item.kind !== 'manga')
    rows.push({
      label: item.kind === 'film' ? 'Durée' : 'Durée d’un épisode',
      value: c.durationKnown ? `${item.duration} min` : 'Non renseignée',
    });
  if (c.available !== null && item.kind !== 'film')
    rows.push({ label: 'Épisodes déjà diffusés', value: String(c.available) });
  if (c.releaseStatus)
    rows.push({
      label: 'Statut de sortie',
      value:
        (
          {
            'Finished Airing': 'Diffusion terminée',
            'Currently Airing': 'En cours de diffusion',
            'Not yet aired': 'À venir',
            Finished: 'Publication terminée',
            Publishing: 'En cours de publication',
            'On Hiatus': 'En pause',
            Discontinued: 'Interrompu',
            'Not yet published': 'À paraître',
            Running: 'En cours',
            Ended: 'Terminé',
            'To Be Determined': 'À confirmer',
          } as Record<string, string>
        )[c.releaseStatus] || c.releaseStatus,
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
  const [detail, setDetail] = useState(item);
  const [loading, setLoading] = useState(!!item.catalog.id);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [adding, setAdding] = useState(false);
  const [priority, setPriority] = useState(false);
  const current = collection.find((m) => sameTitle(m, detail));
  useEffect(() => {
    const controller = new AbortController();
    setLoading(!!item.catalog.id);
    setDetail(item);
    setError('');
    if (!item.catalog.id) return;
    loadCatalogDetail(item, controller.signal)
      .then(setDetail)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
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
          <SheetTitle>Fiche du titre</SheetTitle>
          <SheetDescription>Les informations du catalogue, avant de choisir.</SheetDescription>
        </SheetHeader>
        <div className="catalog-detail-scroll">
          <div className="catalog-detail-hero">
            <CatalogPoster item={detail} />
            <div>
              <p className="eyebrow">
                {categories.find((c) => c.key === detail.kind)?.name}{' '}
                {detail.catalog.year && `/ ${detail.catalog.year}`}
              </p>
              <h2>{detail.title}</h2>
              <div className="catalog-detail-tags">
                {detail.catalog.format && <span>{detail.catalog.format}</span>}
                {detail.catalog.score !== null && (
                  <span className="catalog-score">
                    <Star size={14} fill="currentColor" />
                    {detail.catalog.score.toFixed(1)} / 10
                  </span>
                )}
              </div>
              <p className="subdued">{countLabel(detail)}</p>
            </div>
          </div>
          {error && (
            <div className="notice danger" role="status">
              {error} {detail.catalog.synopsis ? 'Les informations déjà reçues restent affichées.' : ''}
              <button className="ghost-btn small-btn" onClick={() => setRetry((n) => n + 1)}>
                <RefreshCw size={14} />
                Réessayer
              </button>
            </div>
          )}
          <div className="catalog-facts" aria-busy={loading}>
            {facts(detail).map((f) => (
              <div key={f.label}>
                <span>{f.label}</span>
                {loading && f.value.startsWith('Non renseign') ? (
                  <Skeleton className="h-5 w-16" />
                ) : (
                  <strong>{f.value}</strong>
                )}
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
            <h3>Synopsis</h3>
            {loading && !detail.catalog.synopsis ? (
              <div className="loading-grid">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            ) : (
              <p>
                {detail.catalog.synopsis || 'Le catalogue ne fournit pas encore de synopsis pour ce titre.'}
              </p>
            )}
            <small>Texte fourni dans la langue du catalogue.</small>
          </section>
          <div className="catalog-attribution">
            <span>
              Source :{' '}
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
                Voir la source
              </a>
            )}
          </div>
          {detail.catalog.available !== null &&
            detail.catalog.episodes !== null &&
            detail.catalog.available < detail.catalog.episodes && (
              <p className="form-hint">
                Le total peut inclure des épisodes à venir. Seuls les épisodes déjà diffusés sont proposés
                dans le planning automatique.
              </p>
            )}
        </div>
        <div className="catalog-detail-footer">
          {current ? (
            <>
              <p className="inline-note">
                <Check size={17} />
                Déjà dans ta collection · {current.priority ? 'Prioritaire' : 'Non prioritaire'}
              </p>
              <button className="primary full" onClick={() => onEdit(current)}>
                Régler ma progression
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
                {priority ? 'Prioritaire dans mon rattrapage' : 'Rendre ce titre prioritaire'}
              </button>
              <button className="primary full" disabled={saving || loading || adding} onClick={add}>
                {adding ? <LoaderCircle size={17} className="loading-icon" /> : <Plus size={17} />}Ajouter à
                ma liste
              </button>
              <p className="form-hint">Tu pourras ensuite indiquer où tu t’es arrêté.</p>
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
  const [kind, setKind] = useState<Kind>('anime');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CatalogPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [busyId, setBusyId] = useState('');
  const cache = useRef(new Map<string, CatalogPage>());
  useEffect(() => {
    const c = new AbortController();
    const params = new URLSearchParams({ kind, page: String(page), q: search });
    const key = params.toString();
    const saved = cache.current.get(key);
    setError('');
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
        if (!c.signal.aborted) setError(e.message);
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
        <TabsList aria-label="Catégories du catalogue">
          {categories.map(({ key, name, icon: Icon }) => (
            <TabsTrigger value={key} key={key}>
              <Icon size={18} />
              {name}
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
          aria-label="Rechercher dans le catalogue"
          placeholder={`Rechercher ${kind === 'anime' ? 'un anime' : kind === 'manga' ? 'un manga' : kind === 'film' ? 'un film' : 'une série'}…`}
        />
        <button className="primary" disabled={loading && search === query.trim()} type="submit">
          Rechercher
        </button>
      </form>
      <div className="catalog-section-heading">
        <div>
          <h2>
            {search
              ? `Résultats pour « ${search} »`
              : kind === 'series'
                ? 'Séries à découvrir'
                : kind === 'film'
                  ? 'Le cinéma, à portée de liste'
                  : 'Les incontournables'}
          </h2>
          <p>
            {search
              ? 'Choisis une affiche pour consulter sa fiche.'
              : 'Explore le catalogue et garde les titres qui te donnent envie.'}
          </p>
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
            Effacer la recherche
          </button>
        )}
      </div>
      {loading ? (
        <div className="catalog-grid" aria-label="Chargement des couvertures">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i}>
              <Skeleton className="catalog-poster-skeleton" />
              <Skeleton className="h-5 w-4/5 mt-3" />
              <Skeleton className="h-4 w-3/5 mt-3" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="catalog-error" role="alert">
          <RefreshCw size={30} />
          <h3>Le catalogue prend une pause.</h3>
          <p>{error}</p>
          <button className="secondary" onClick={() => setRetry((n) => n + 1)}>
            <RefreshCw size={16} />
            Réessayer
          </button>
          <button className="ghost-btn" onClick={onManual}>
            Ajouter exceptionnellement un titre à la main
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
                    aria-label={`Voir la fiche de ${item.title}`}
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
                        Dans ma liste
                      </span>
                    )}
                  </button>
                  <div className="catalog-card-body">
                    <button className="catalog-title" onClick={() => onDetail(item)}>
                      {item.title}
                    </button>
                    <p>
                      {[item.catalog.year, item.catalog.format].filter(Boolean).join(' · ') ||
                        categories.find((c) => c.key === kind)?.name}
                    </p>
                    <span className="catalog-count">{countLabel(item)}</span>
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
                      {added ? 'Dans ma liste' : 'Ma liste'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="catalog-pagination-row">
            <span className="form-hint">
              {data.totalResults !== null
                ? `${data.totalResults.toLocaleString('fr-FR')} titres trouvés`
                : `Source : ${data.source}`}{' '}
              · page {page}
            </span>
            <Pagination aria-label="Pages du catalogue">
              <PaginationContent>
                <PaginationItem>
                  <button
                    className="secondary small-btn"
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft size={15} />
                    Précédente
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
                    Suivante
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
            <EmptyTitle>Aucun titre trouvé</EmptyTitle>
            <EmptyDescription>
              Essaie le titre original, une autre orthographe ou une autre catégorie.
            </EmptyDescription>
          </EmptyHeader>
          <button className="secondary" onClick={onManual}>
            Ajouter un titre manuellement
          </button>
        </Empty>
      )}
      <div className="catalog-bottom-note">
        <p>
          Sources :{' '}
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
          . Les fiches et compteurs dépendent des informations disponibles dans ces catalogues.
        </p>
        <button className="ghost-btn small-btn" onClick={onManual}>
          Titre introuvable ? Ajout manuel
        </button>
      </div>
    </section>
  );
}
