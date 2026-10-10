'use client';
// "Nouveau post": the work (and episode) it is about, text with emojis and #tags, up to 4 photos,
// a spoiler level, and optionally a recommendation with a score. Full screen on phones.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { itemFromMedia, type CatalogItem } from '@/lib/catalog';
import {
  PHOTOS_MAX,
  POST_MAX,
  RECO_MAX,
  refFromMedia,
  type Debrief,
  type FeedItem,
  type Spoiler,
  type Target,
  type TargetRef,
} from '@/lib/community';
import { discardPhotos, uploadPhotos } from '@/lib/photos';
import type { Media } from '@/lib/watch';
import { Avatar, Poster, ScoreBar, Switch, UsernameDialog, api, post, problem } from './community-ui';
import { CharRing, EmojiButton, LevelMenu, PhotoDraft, insertAtCursor, usePhotoDraft } from './post-ui';
import { useI18n } from './i18n-provider';

type Kind = TargetRef['kind'];
const KINDS: Kind[] = ['anime', 'series', 'film', 'manga'];
const workRef = (item: CatalogItem) => refFromMedia({ kind: item.kind, catalog: item.catalog });

export default function ComposeSheet({
  userId,
  collection,
  initialText = '',
  onClose,
  onPublished,
}: {
  userId: string;
  collection: Media[];
  initialText?: string;
  onClose: () => void;
  onPublished: (item: FeedItem) => void;
}) {
  const { t } = useI18n();
  const c = t.community;
  const m = c.compose;
  const [kind, setKind] = useState<Kind>('anime');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ key: string; items: CatalogItem[]; failed?: boolean }>({
    key: '',
    items: [],
  });
  const [work, setWork] = useState<CatalogItem | null>(null);
  const [episodeMode, setEpisodeMode] = useState(false);
  const [season, setSeason] = useState('1');
  const [episode, setEpisode] = useState('');
  const [body, setBody] = useState(initialText);
  const [level, setLevel] = useState<Spoiler>('none');
  const [recommend, setRecommend] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState<string | null | undefined>(undefined);
  const [askName, setAskName] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const photos = usePhotoDraft((message) => toast.error(message));
  const field = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
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

  // Before typing: titles from the member's own list, the ones being watched first.
  const fromList = useMemo(
    () =>
      collection
        .filter((x) => x.kind === kind && refFromMedia(x))
        .sort((a, b) => Number(b.status === 'watching') - Number(a.status === 'watching'))
        .slice(0, 6)
        .map(itemFromMedia),
    [collection, kind],
  );
  const choices = term.length >= 2 ? (found.key === key ? found.items : []) : fromList;
  const episodic = work && (work.kind === 'anime' || work.kind === 'series');
  const onEpisode = !!episodic && episodeMode;
  const isReco = recommend && !onEpisode;
  const max = isReco ? RECO_MAX : POST_MAX;
  const length = body.trim().length;
  const episodeNumber = Number(episode);
  const seasonNumber = Number(season);
  const episodeValid =
    !onEpisode ||
    (Number.isInteger(episodeNumber) &&
      episodeNumber >= 1 &&
      (work?.kind !== 'series' || (Number.isInteger(seasonNumber) && seasonNumber >= 0)));
  const ready = !!work && episodeValid && length <= max && (length > 0 || photos.items.length > 0);
  const levels: Spoiler[] = onEpisode ? ['none', 'episode', 'later'] : ['none', 'episode'];
  const what = onEpisode
    ? work?.kind === 'series'
      ? c.theSeriesEpisode(seasonNumber, episodeNumber || 0)
      : c.theEpisode(episodeNumber || 0)
    : c.theWork;
  const meta = (item: CatalogItem) => [t.kinds[item.kind], item.catalog.year].filter(Boolean).join(' · ');
  const dirty = length > 0 || photos.items.length > 0;
  const close = () => (dirty && !busy ? setConfirmClose(true) : !busy && onClose());

  const publish = async (named = false) => {
    const ref = work && workRef(work);
    if (!ref || !ready || busy) return;
    if (username === null && !named) {
      setAskName(true);
      return;
    }
    setBusy(true);
    let sent: string[] = [];
    try {
      const uploaded = photos.items.length ? await uploadPhotos(userId, photos.items) : [];
      sent = uploaded.map((p) => p.path);
      const target: TargetRef = {
        ...ref,
        season: onEpisode && work.kind === 'series' ? seasonNumber : null,
        episode: onEpisode ? episodeNumber : null,
      };
      const data = await post<{ post: Debrief; target: Target }>({
        op: 'publish',
        target: null,
        work: target,
        parent: null,
        kind: isReco ? 'reco' : 'debrief',
        body: body.trim(),
        spoiler: levels.includes(level) ? level : 'none',
        score: isReco ? score : null,
        photos: uploaded,
      });
      sent = [];
      const tg = data.target;
      onPublished({
        ...data.post,
        photoCount: data.post.photos.length,
        replyCount: 0,
        inList: collection.some((x) => x.catalog?.source === tg.source && x.catalog.id === tg.sourceId),
        target: {
          kind: tg.kind,
          source: tg.source,
          sourceId: tg.sourceId,
          season: tg.season,
          episode: tg.episode,
          title: tg.title,
          poster: tg.poster,
          backdrop: tg.backdrop,
          year: tg.year,
        },
      });
      photos.clear();
      toast.success(m.published);
    } catch (e) {
      // Photos sent for a post that failed are removed again; everything typed stays.
      await discardPhotos(sent);
      toast.error(
        e instanceof Error && e.message === 'upload' ? m.photoErrors.upload : problem(e, c.actionFailed),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="rx" showCloseButton={false}>
        <header className="rx-head">
          <button type="button" className="rx-cancel" onClick={close} disabled={busy}>
            {m.cancel}
          </button>
          <DialogTitle className="sr-only">{m.title}</DialogTitle>
          <DialogDescription className="sr-only">{m.pickWork}</DialogDescription>
          <button type="button" className="rx-post" disabled={!ready || busy} onClick={() => publish()}>
            {busy ? <LoaderCircle size={16} className="loading-icon" /> : null}
            {busy ? m.sending : m.publish}
          </button>
        </header>

        <div className="rx-body">
          <div className="rx-side">
            <Avatar name={username || null} round />
          </div>
          <div className="rx-main">
            {work ? (
              <div className="rx-about">
                <div className="rx-work-chip">
                  <Poster src={work.poster} className="rx-work-poster" />
                  <span>
                    <strong>{work.title}</strong>
                    <span>{meta(work)}</span>
                  </span>
                  <button
                    type="button"
                    className="dx-icon"
                    aria-label={m.removeWork}
                    onClick={() => {
                      setWork(null);
                      setEpisodeMode(false);
                      setRecommend(false);
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
                {episodic && (
                  <div className="rx-episode">
                    <div className="rx-seg" role="group" aria-label={m.about}>
                      <button
                        type="button"
                        aria-pressed={!episodeMode}
                        className={!episodeMode ? 'on' : ''}
                        onClick={() => setEpisodeMode(false)}
                      >
                        {m.wholeWork}
                      </button>
                      <button
                        type="button"
                        aria-pressed={episodeMode}
                        className={episodeMode ? 'on' : ''}
                        onClick={() => {
                          setEpisodeMode(true);
                          setRecommend(false);
                        }}
                      >
                        {m.episode}
                      </button>
                    </div>
                    {episodeMode && (
                      <div className="rx-numbers">
                        {work.kind === 'series' && (
                          <label>
                            <span>{m.season}</span>
                            <input
                              inputMode="numeric"
                              value={season}
                              onChange={(e) => setSeason(e.target.value.replace(/\D/g, '').slice(0, 3))}
                            />
                          </label>
                        )}
                        <label>
                          <span>{m.episodeNumber}</span>
                          <input
                            inputMode="numeric"
                            value={episode}
                            autoFocus
                            onChange={(e) => setEpisode(e.target.value.replace(/\D/g, '').slice(0, 5))}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <section className="rx-picker" aria-label={m.pickWork}>
                <h2>{m.pickWork}</h2>
                <div className="dx-strip rx-kinds" role="group" aria-label={m.kinds}>
                  {KINDS.map((k) => (
                    <button
                      key={k}
                      type="button"
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
                  <span className="sr-only">{m.search}</span>
                  <input
                    type="search"
                    value={query}
                    placeholder={m.search}
                    autoComplete="off"
                    maxLength={150}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {searching && <LoaderCircle size={16} className="loading-icon" aria-hidden />}
                </label>
                {term.length < 2 && choices.length > 0 && <p className="rx-note">{m.fromList}</p>}
                {found.key === key && found.failed ? (
                  <p className="rx-note">{m.searchFailed}</p>
                ) : term.length >= 2 && !searching && choices.length === 0 ? (
                  <p className="rx-note">{m.noResults}</p>
                ) : (
                  <div className="rx-results">
                    {choices.map((item) => (
                      <button
                        key={`${item.catalog.source}:${item.catalog.id}`}
                        type="button"
                        onClick={() => setWork(item)}
                      >
                        <Poster src={item.poster} className="rx-result-poster" />
                        <span>
                          <strong>{item.title}</strong>
                          <span>{meta(item)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}

            <textarea
              ref={field}
              className="rx-text"
              aria-label={m.placeholder}
              placeholder={m.placeholder}
              value={body}
              maxLength={POST_MAX + 200}
              onChange={(e) => {
                setBody(e.target.value);
                const el = e.target;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
              }}
            />
            <PhotoDraft items={photos.items} onRemove={photos.remove} />
            {photos.items.length > 0 && <p className="rx-note">{m.photoCount(photos.items.length)}</p>}

            {work && !onEpisode && (
              <div className="rx-reco">
                <div className="rx-switch-row">
                  <div>
                    <strong>{m.recommend}</strong>
                    <span>{m.recommendHint}</span>
                  </div>
                  <Switch on={recommend} onChange={setRecommend} label={m.recommend} />
                </div>
                {recommend && (
                  <>
                    <p className="rx-note">{m.score}</p>
                    <ScoreBar score={score} onScore={setScore} label={m.score} />
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <footer className="rx-tools">
          <input
            ref={files}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              photos.add(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="px-tool"
            aria-label={m.addPhoto}
            disabled={photos.busy || photos.items.length >= PHOTOS_MAX}
            onClick={() => files.current?.click()}
          >
            {photos.busy ? <LoaderCircle size={19} className="loading-icon" /> : <ImagePlus size={20} />}
          </button>
          <EmojiButton size={20} onPick={(emoji) => insertAtCursor(field.current, body, emoji, setBody)} />
          <span className="rx-spacer" />
          <LevelMenu
            level={levels.includes(level) ? level : 'none'}
            levels={levels}
            what={what}
            onChange={setLevel}
          />
          <CharRing used={length} max={max} />
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
        <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{m.discardTitle}</AlertDialogTitle>
              <AlertDialogDescription>{m.discardText}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{m.keep}</AlertDialogCancel>
              <button
                type="button"
                className="danger-solid"
                onClick={() => {
                  setConfirmClose(false);
                  photos.clear();
                  onClose();
                }}
              >
                {m.discard}
              </button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
