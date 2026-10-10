'use client';
// "Recommander": pick a work from the catalog, say why, give a score, and post it to the community.
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, LoaderCircle, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { itemFromMedia, type CatalogItem } from '@/lib/catalog';
import {
  RECO_MAX,
  refFromMedia,
  type FeedItem,
  type Debrief,
  type Target,
  type TargetRef,
} from '@/lib/community';
import type { Media } from '@/lib/watch';
import { Poster, ScoreBar, Switch, UsernameDialog, api, post, problem } from './community-ui';
import { useI18n } from './i18n-provider';

type Kind = TargetRef['kind'];
const KINDS: Kind[] = ['anime', 'series', 'film', 'manga'];
const workRef = (item: CatalogItem) => refFromMedia({ kind: item.kind, catalog: item.catalog });

export default function RecommendSheet({
  collection,
  onClose,
  onPublished,
}: {
  collection: Media[];
  onClose: () => void;
  onPublished: (item: FeedItem) => void;
}) {
  const { t } = useI18n();
  const c = t.community;
  const r = c.reco;
  const [kind, setKind] = useState<Kind>('anime');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ key: string; items: CatalogItem[]; failed?: boolean }>({
    key: '',
    items: [],
  });
  const [work, setWork] = useState<CatalogItem | null>(null);
  const [body, setBody] = useState('');
  const [score, setScore] = useState<number | null>(null);
  const [spoilers, setSpoilers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState<string | null | undefined>(undefined);
  const [askName, setAskName] = useState(false);
  const term = query.trim();
  const key = `${kind}:${term}`;
  const searching = term.length >= 2 && found.key !== key;

  useEffect(() => {
    fetch('/api/profile', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => setUsername(data.username ?? null))
      .catch(() => setUsername(null));
  }, []);

  // Searches the catalog a moment after typing stops.
  useEffect(() => {
    if (term.length < 2) return;
    let live = true;
    const timer = window.setTimeout(() => {
      api<{ results: CatalogItem[] }>(`/api/catalog?kind=${kind}&q=${encodeURIComponent(term)}`)
        .then((data) => live && setFound({ key, items: data.results.filter((i) => workRef(i)).slice(0, 6) }))
        .catch(() => live && setFound({ key, items: [], failed: true }));
    }, 350);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [kind, term, key]);

  // Before typing: titles from the member's own list.
  const fromList = useMemo(
    () =>
      collection
        .filter((m) => m.kind === kind && refFromMedia(m))
        .sort(
          (a, b) =>
            Number(b.status === 'completed') - Number(a.status === 'completed') ||
            Number(b.status === 'watching') - Number(a.status === 'watching'),
        )
        .slice(0, 6)
        .map(itemFromMedia),
    [collection, kind],
  );
  const choices = term.length >= 2 ? (found.key === key ? found.items : []) : fromList;
  const length = body.trim().length;
  const ready = !!work && length > 0 && length <= RECO_MAX;
  const meta = (item: CatalogItem) => [t.kinds[item.kind], item.catalog.year].filter(Boolean).join(' · ');

  const publish = async (named = false) => {
    const ref = work && workRef(work);
    if (!ref || !ready || busy) return;
    if (username === null && !named) {
      setAskName(true);
      return;
    }
    setBusy(true);
    try {
      const data = await post<{ post: Debrief; target: Target }>({
        op: 'recommend',
        work: { kind: ref.kind, source: ref.source, sourceId: ref.sourceId, season: null, episode: null },
        body: body.trim(),
        spoiler: spoilers ? 'episode' : 'none',
        score,
      });
      const { target } = data;
      onPublished({
        ...data.post,
        replyCount: 0,
        inList: collection.some((m) => m.catalog?.source === ref.source && m.catalog.id === ref.sourceId),
        target: {
          kind: target.kind,
          source: target.source,
          sourceId: target.sourceId,
          season: null,
          episode: null,
          title: target.title,
          poster: target.poster,
          backdrop: target.backdrop,
          year: target.year,
        },
      });
      toast.success(r.published);
    } catch (e) {
      // Everything typed stays.
      toast.error(problem(e, c.actionFailed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="rx" showCloseButton={false}>
        <header className="rx-head">
          <button className="dx-round" aria-label={r.close} onClick={onClose} disabled={busy}>
            <ArrowLeft size={20} />
          </button>
          <DialogTitle>{r.title}</DialogTitle>
          <span className="dx-round-spacer" />
        </header>
        <DialogDescription className="sr-only">{r.pickWork}</DialogDescription>

        <div className="rx-body">
          <h2>{r.pickWork}</h2>
          {work ? (
            <div className="rx-picked" aria-label={r.selected}>
              <Poster src={work.poster} className="rx-picked-poster" />
              <div>
                <strong>{work.title}</strong>
                <span>{meta(work)}</span>
              </div>
              <button className="dx-link small" onClick={() => setWork(null)}>
                {r.change}
              </button>
              <span className="rx-check" aria-hidden>
                <Check size={16} strokeWidth={3} />
              </span>
            </div>
          ) : (
            <>
              <div className="dx-strip rx-kinds" role="group" aria-label={r.kinds}>
                {KINDS.map((k) => (
                  <button
                    key={k}
                    className={`dx-chip${kind === k ? ' on' : ''}`}
                    aria-pressed={kind === k}
                    onClick={() => setKind(k)}
                  >
                    {t.kindsPlural[k]}
                  </button>
                ))}
              </div>
              <label className="rx-search">
                <Search size={18} aria-hidden />
                <span className="sr-only">{r.search}</span>
                <input
                  type="search"
                  value={query}
                  placeholder={r.search}
                  autoComplete="off"
                  maxLength={150}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {searching && <LoaderCircle size={16} className="loading-icon" aria-hidden />}
              </label>
              {found.key === key && found.failed ? (
                <p className="rx-note">{r.searchFailed}</p>
              ) : term.length >= 2 && !searching && choices.length === 0 ? (
                <p className="rx-note">{r.noResults}</p>
              ) : (
                <div className="rx-results">
                  {choices.map((item) => (
                    <button key={`${item.catalog.source}:${item.catalog.id}`} onClick={() => setWork(item)}>
                      <Poster src={item.poster} className="rx-result-poster" />
                      <span>
                        <strong>{item.title}</strong>
                        <span>{meta(item)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <h2>{r.why}</h2>
          <div className="rx-text">
            <textarea
              aria-label={r.why}
              value={body}
              maxLength={RECO_MAX + 100}
              placeholder={r.whyPlaceholder}
              onChange={(e) => setBody(e.target.value)}
            />
            <span className={length > RECO_MAX ? 'over' : ''}>{r.count(length)}</span>
          </div>

          <h2>{r.score}</h2>
          <ScoreBar score={score} onScore={setScore} label={r.score} />
          <p className="rx-hint">{r.scoreHint}</p>

          <div className="rx-switch-row">
            <div>
              <strong>{r.spoilers}</strong>
              <span>{r.spoilersHint}</span>
            </div>
            <Switch on={spoilers} onChange={setSpoilers} label={r.spoilers} />
          </div>

          {work && (
            <>
              <h2>{r.preview}</h2>
              <article className="rx-preview">
                <Poster src={work.backdrop || work.poster} className="rx-preview-img" />
                <div>
                  <div className="rx-preview-title">
                    <strong>{work.title}</strong>
                    {score !== null && <span>★ {score}/10</span>}
                  </div>
                  <span className="rx-preview-meta">{meta(work)}</span>
                  <p>{length ? `« ${body.trim()} »` : r.previewEmpty}</p>
                </div>
              </article>
            </>
          )}
        </div>

        <footer className="rx-foot">
          <button className="rx-publish" disabled={!ready || busy} onClick={() => publish()}>
            {busy ? (
              <LoaderCircle size={18} className="loading-icon" />
            ) : !work ? (
              r.pickFirst
            ) : length === 0 ? (
              r.writeFirst
            ) : length > RECO_MAX ? (
              r.tooLong
            ) : (
              r.publish
            )}
          </button>
        </footer>
        <UsernameDialog
          open={askName}
          onClose={() => setAskName(false)}
          onDone={(name) => {
            setUsername(name);
            setAskName(false);
            publish(true);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
