'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Info, LoaderCircle, Pause, Play, Plus } from 'lucide-react';
import type { CatalogItem } from '@/lib/catalog';
import type { Feed } from '@/lib/catalog-gateway';
import { useI18n } from './i18n-provider';

const AUTOPLAY_MS = 7000;
const SWIPE_PX = 50;

export function HeroCarousel({
  items,
  feed,
  isAdded,
  saving,
  onAdd,
  onDetail,
}: {
  items: CatalogItem[];
  feed: Feed;
  isAdded: (item: CatalogItem) => boolean;
  saving: boolean;
  onAdd: (item: CatalogItem) => Promise<unknown>;
  onDetail: (item: CatalogItem) => void;
}) {
  const { t, locale } = useI18n();
  const [index, setIndex] = useState(0);
  // Rendered only in the browser (after the list loads), so the system motion setting can seed the state.
  const [paused, setPaused] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [holding, setHolding] = useState(false);
  const [adding, setAdding] = useState('');
  // Wide images that failed to load (some sources list ones that do not exist): use the cover instead.
  const [brokenBackdrops, setBrokenBackdrops] = useState<Set<string>>(() => new Set());
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const count = items.length;
  const current = Math.min(index, Math.max(count - 1, 0));

  useEffect(() => {
    if (paused || holding || count < 2) return;
    const timer = window.setTimeout(() => setIndex((i) => (i + 1) % count), AUTOPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [current, paused, holding, count]);

  if (!count) return null;
  const go = (n: number) => setIndex(((n % count) + count) % count);
  const day = (date: string) =>
    new Date(date + 'T12:00:00').toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
      ...(date.slice(0, 4) === String(new Date().getFullYear()) ? {} : { year: 'numeric' }),
    });
  const tagFor = (item: CatalogItem) =>
    feed === 'upcoming'
      ? item.startDate
        ? `${t.home.tagUpcoming} · ${day(item.startDate)}`
        : t.home.tagUpcoming
      : feed === 'airing'
        ? t.home.tagAiring
        : feed === 'new'
          ? t.home.tagNew
          : t.home.tagPopular;
  const add = async (item: CatalogItem) => {
    const key = `${item.catalog.source}:${item.catalog.id}`;
    setAdding(key);
    try {
      await onAdd(item);
    } finally {
      setAdding('');
    }
  };

  return (
    <section
      className="hero"
      aria-roledescription="carousel"
      aria-label={t.home.carouselAria}
      onPointerEnter={() => setHolding(true)}
      onPointerLeave={() => setHolding(false)}
      onFocus={() => setHolding(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHolding(false);
      }}
      onPointerDown={(event) => {
        swipe.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        const start = swipe.current;
        swipe.current = null;
        if (!start) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) go(current + (dx < 0 ? 1 : -1));
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') go(current - 1);
        if (event.key === 'ArrowRight') go(current + 1);
      }}
    >
      <div className="hero-track" aria-live={paused ? 'polite' : 'off'}>
        {items.map((item, i) => {
          const key = `${item.catalog.source}:${item.catalog.id}`;
          const added = isAdded(item);
          const active = i === current;
          const useBackdrop = Boolean(item.backdrop) && !brokenBackdrops.has(key);
          return (
            <article
              key={key}
              className={`hero-slide ${active ? 'active' : ''}`}
              aria-roledescription={t.home.slide}
              aria-label={t.home.slideOf(i + 1, count)}
              aria-hidden={!active}
              inert={!active}
            >
              {(useBackdrop || item.poster) && (
                <img
                  className={`hero-bg ${useBackdrop ? '' : 'from-poster'}`}
                  src={useBackdrop ? item.backdrop : item.poster}
                  onError={() => {
                    if (useBackdrop) setBrokenBackdrops((old) => new Set(old).add(key));
                  }}
                  alt=""
                  referrerPolicy="no-referrer"
                  loading={i === 0 ? 'eager' : 'lazy'}
                  draggable={false}
                />
              )}
              <div className="hero-scrim" />
              <div className="hero-content">
                <span className="hero-tag">{tagFor(item)}</span>
                <h2>{item.title}</h2>
                {item.catalog.genres.length > 0 && (
                  <ul className="hero-genres">
                    {item.catalog.genres.slice(0, 5).map((genre) => (
                      <li key={genre}>{genre}</li>
                    ))}
                  </ul>
                )}
                {item.catalog.synopsis && <p className="hero-synopsis">{item.catalog.synopsis}</p>}
                <div className="hero-actions">
                  {added ? (
                    <button className="primary" disabled>
                      <Check size={18} />
                      {t.catalog.inMyList}
                    </button>
                  ) : (
                    <button className="primary" disabled={saving || adding === key} onClick={() => add(item)}>
                      {adding === key ? (
                        <LoaderCircle size={18} className="loading-icon" />
                      ) : (
                        <Plus size={18} />
                      )}
                      {t.catalog.addToList}
                    </button>
                  )}
                  <button className="secondary" onClick={() => onDetail(item)}>
                    <Info size={18} />
                    {t.media.viewDetails}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {count > 1 && (
        <>
          <button
            className="hero-arrow prev"
            aria-label={t.home.previousSlide}
            onClick={() => go(current - 1)}
          >
            <ChevronLeft size={22} />
          </button>
          <button className="hero-arrow next" aria-label={t.home.nextSlide} onClick={() => go(current + 1)}>
            <ChevronRight size={22} />
          </button>
          <div className="hero-controls">
            <button
              className="hero-pause"
              aria-label={paused ? t.home.play : t.home.pause}
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? <Play size={14} /> : <Pause size={14} />}
            </button>
            <div className="hero-dots">
              {items.map((item, i) => (
                <button
                  key={`${item.catalog.source}:${item.catalog.id}`}
                  className={i === current ? 'on' : ''}
                  aria-label={t.home.goToSlide(i + 1)}
                  aria-current={i === current ? 'true' : undefined}
                  onClick={() => go(i)}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
