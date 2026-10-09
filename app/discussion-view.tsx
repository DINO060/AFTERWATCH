'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  Check,
  EyeOff,
  Flag,
  LoaderCircle,
  Lock,
  MoreHorizontal,
  PencilLine,
  Plus,
  Share2,
  Trash2,
  Tv,
  X,
} from 'lucide-react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  REACTIONS,
  refPath,
  spoilerHidden,
  usernameHue,
  viewerSeen,
  workOf,
  type Debrief,
  type EpisodeGuide,
  type Reaction,
  type Spoiler,
  type Summary,
  type Target,
  type TargetRef,
} from '@/lib/community';
import type { Media } from '@/lib/watch';
import { useI18n } from './i18n-provider';

type Thread = { comments: Debrief[]; total: number; hasMore: boolean };
type Activity = { season: number | null; episode: number; debriefs: number; verdicts: number }[];
type Draft = {
  mode: 'new' | 'reply' | 'edit';
  parent?: Debrief;
  comment?: Debrief;
  body: string;
  level: Spoiler | null;
  attach: boolean;
};
const MAX = 2000;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'failed');
  return data as T;
}
const post = <T,>(payload: object) =>
  api<T>('/api/community', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
const refQuery = (ref: TargetRef) =>
  new URLSearchParams({
    kind: ref.kind,
    source: ref.source,
    id: ref.sourceId,
    ...(ref.season !== null ? { season: String(ref.season) } : {}),
    ...(ref.episode !== null ? { episode: String(ref.episode) } : {}),
  }).toString();

export function useAgo() {
  const { locale } = useI18n();
  return (iso: string) => {
    const diff = (Date.parse(iso) - Date.now()) / 1000;
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    const abs = Math.abs(diff);
    if (abs < 60) return rtf.format(0, 'second');
    if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
    if (abs < 7 * 86400) return rtf.format(Math.round(diff / 86400), 'day');
    return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  };
}

export function Poster({ src, className }: { src: string; className: string }) {
  const [broken, setBroken] = useState(false);
  return src && !broken ? (
    <img
      className={className}
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  ) : (
    <span className={`${className} dx-poster-empty`} aria-hidden>
      <Tv size={20} />
    </span>
  );
}

export function Avatar({ name, small }: { name: string | null; small?: boolean }) {
  const hue = name ? usernameHue(name) : 0;
  return (
    <span
      className={`dx-avatar${small ? ' small' : ''}`}
      aria-hidden
      style={{ background: name ? `hsl(${hue} 38% 34%)` : 'var(--secondary)' }}
    >
      {name ? name[0].toUpperCase() : '?'}
    </span>
  );
}

export default function DiscussionView({
  refTarget,
  collection,
  signedIn,
  onOpen,
  onBack,
  onSignIn,
}: {
  refTarget: TargetRef;
  collection: Media[];
  signedIn: boolean;
  onOpen: (ref: TargetRef) => void;
  onBack: () => void;
  onSignIn: () => void;
}) {
  const { t } = useI18n();
  const c = t.community;
  const ago = useAgo();
  const [target, setTarget] = useState<Target | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [guide, setGuide] = useState<EpisodeGuide | null>(null);
  const [activity, setActivity] = useState<Activity>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [sort, setSort] = useState<'top' | 'recent'>('recent');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showAverage, setShowAverage] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [openReplies, setOpenReplies] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Debrief | null>(null);
  const [toReport, setToReport] = useState<Debrief | null>(null);
  const [username, setUsername] = useState<string | null | undefined>(undefined);
  const refKey = refPath(refTarget);
  const workKey = refPath(workOf(refTarget));

  // The discussion and its verdicts.
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    // Each discussion mounts its own view (see its key in watch-app), so there is nothing to reset here.
    api<{ target: Target; summary: Summary }>(`/api/community?op=target&${refQuery(refTarget)}`)
      .then((data) => {
        if (!live) return;
        setTarget(data.target);
        setSummary(data.summary);
      })
      .catch(
        (e) => live && setError(e instanceof Error && e.message !== 'failed' ? e.message : c.loadFailed),
      );
    return () => {
      live = false;
    };
    // refKey stands for refTarget; the texts only matter for the first error.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refKey, signedIn, retry]);

  // The episode picker, once per work.
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    api<{ guide: EpisodeGuide; activity: Activity }>(`/api/community?op=guide&${refQuery(workOf(refTarget))}`)
      .then((data) => {
        if (!live) return;
        setGuide(data.guide);
        setActivity(data.activity);
      })
      .catch(() => live && setGuide({ mode: 'single' }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workKey, signedIn]);

  const loadThread = useCallback(async (targetId: string, order: 'top' | 'recent', offset: number) => {
    const params = new URLSearchParams({
      op: 'thread',
      target: targetId,
      sort: order,
      offset: String(offset),
    });
    return api<Thread>(`/api/community?${params}`);
  }, []);
  useEffect(() => {
    if (!target) return;
    let live = true;
    loadThread(target.id, sort, 0)
      .then((data) => live && setThread(data))
      .catch(() => live && setError(c.loadFailed));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, sort, loadThread]);

  useEffect(() => {
    if (!signedIn) return;
    fetch('/api/profile', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setUsername(data.username ?? null))
      .catch(() => setUsername(null));
  }, [signedIn]);

  const seasons = guide?.mode === 'seasons' ? guide.seasons : undefined;
  const seen = useMemo(() => viewerSeen(refTarget, collection, seasons), [refTarget, collection, seasons]);
  const what =
    refTarget.episode === null
      ? c.theWork
      : refTarget.kind === 'series'
        ? c.theSeriesEpisode(refTarget.season ?? 0, refTarget.episode)
        : c.theEpisode(refTarget.episode);

  if (!signedIn)
    return (
      <section className="panel dx-blocked">
        <p>{c.signIn}</p>
        <button className="primary" onClick={onSignIn}>
          {t.nav.signIn}
        </button>
      </section>
    );

  const share = async () => {
    const url = window.location.origin + refPath(refTarget);
    try {
      if (navigator.share) await navigator.share({ title: target?.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success(c.linkCopied);
      }
    } catch {
      // Share sheet closed: nothing to do.
    }
  };

  const rate = async (score: number | null) => {
    if (!target || !summary) return;
    const previous = summary;
    setSummary({ ...summary, myScore: score });
    try {
      setSummary(await post<Summary>({ op: 'rate', target: target.id, score }));
    } catch (e) {
      setSummary(previous);
      toast.error(e instanceof Error && e.message !== 'failed' ? e.message : c.actionFailed);
    }
  };

  const patchComment = (id: string, change: (d: Debrief) => Debrief | null) =>
    setThread((current) => {
      if (!current) return current;
      const comments: Debrief[] = [];
      for (const d of current.comments) {
        if (d.id === id) {
          const next = change(d);
          if (next) comments.push(next);
          continue;
        }
        const replies = d.replies?.flatMap((r) => {
          if (r.id !== id) return [r];
          const next = change(r);
          return next ? [next] : [];
        });
        comments.push(replies ? { ...d, replies, replyCount: replies.length } : d);
      }
      return { ...current, comments };
    });

  const react = async (d: Debrief, reaction: Reaction) => {
    const before = { reactions: d.reactions, myReaction: d.myReaction };
    const counts = { ...d.reactions };
    let mine: Reaction | null = reaction;
    if (d.myReaction) counts[d.myReaction] = (counts[d.myReaction] || 1) - 1;
    if (d.myReaction === reaction) mine = null;
    else counts[reaction] = (counts[reaction] || 0) + 1;
    for (const key of Object.keys(counts) as Reaction[]) if (!counts[key]) delete counts[key];
    patchComment(d.id, (x) => ({ ...x, reactions: counts, myReaction: mine }));
    try {
      const result = await post<{ reactions: Debrief['reactions']; myReaction: Reaction | null }>({
        op: 'react',
        comment: d.id,
        reaction,
      });
      patchComment(d.id, (x) => ({ ...x, ...result }));
    } catch (e) {
      patchComment(d.id, (x) => ({ ...x, ...before }));
      toast.error(e instanceof Error && e.message !== 'failed' ? e.message : c.actionFailed);
    }
  };

  const openComposer = (next: Draft) => {
    setDraft(next);
    setComposerOpen(true);
  };
  const startNew = (prompt = '') =>
    openComposer(
      draft?.mode === 'new' && !prompt
        ? draft
        : { mode: 'new', body: prompt, level: null, attach: summary?.myScore != null },
    );

  const published = (d: Debrief, mode: Draft['mode'], parent?: Debrief) => {
    if (mode === 'edit')
      patchComment(d.id, (x) => ({ ...x, ...d, replies: x.replies, replyCount: x.replyCount }));
    else if (mode === 'reply' && parent) {
      patchComment(parent.id, (x) => ({
        ...x,
        replies: [...(x.replies || []).filter((r) => r.id !== d.id), d],
        replyCount: (x.replyCount || 0) + 1,
      }));
      setOpenReplies((o) => ({ ...o, [parent.id]: true }));
    } else {
      setThread((current) =>
        current
          ? {
              ...current,
              comments: [d, ...current.comments.filter((x) => x.id !== d.id)],
              total: current.total + 1,
            }
          : current,
      );
      setSummary((s) => (s ? { ...s, debriefs: s.debriefs + 1 } : s));
    }
  };

  const remove = async () => {
    const d = toDelete;
    if (!d) return;
    try {
      await post({ op: 'delete', comment: d.id });
      patchComment(d.id, (x) =>
        (x.replyCount || 0) > 0
          ? { ...x, deleted: true, body: '', rating: null, reactions: {}, myReaction: null }
          : null,
      );
      if (!d.parentId) setSummary((s) => (s ? { ...s, debriefs: Math.max(0, s.debriefs - 1) } : s));
      setToDelete(null);
    } catch (e) {
      toast.error(e instanceof Error && e.message !== 'failed' ? e.message : c.actionFailed);
    }
  };

  const loadMore = async () => {
    if (!target || !thread || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await loadThread(target.id, sort, thread.comments.length);
      setThread({
        ...next,
        comments: [
          ...thread.comments,
          ...next.comments.filter((n) => !thread.comments.some((x) => x.id === n.id)),
        ],
      });
    } catch {
      toast.error(c.actionFailed);
    } finally {
      setLoadingMore(false);
    }
  };

  const debriefCard = (d: Debrief, reply = false) => {
    const veiled = !d.deleted && spoilerHidden(d.spoiler, seen) && !revealed[d.id];
    const shown = !d.deleted && d.spoiler !== 'none' && !veiled;
    const label = d.spoiler === 'later' ? c.spoilerLater : c.spoilerOf(what);
    const used = REACTIONS.filter((r) => d.reactions[r.key] || d.myReaction === r.key);
    return (
      <article className={reply ? 'dx-reply' : 'dx-debrief'} key={d.id}>
        <header className="dx-debrief-head">
          <Avatar name={d.username} small={reply} />
          <div className="dx-who">
            <strong>{d.username ?? c.deletedAccount}</strong>
            <span>
              {ago(d.createdAt)}
              {d.edited && !d.deleted ? ` · ${c.edited}` : ''}
            </span>
          </div>
          {d.rating !== null && !reply && (
            <span
              className="dx-badge"
              title={c.authorVerdict(d.rating)}
              aria-label={c.authorVerdict(d.rating)}
            >
              {d.rating}
            </span>
          )}
          {!d.deleted && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="dx-icon" aria-label={c.actions}>
                  <MoreHorizontal size={18} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {d.mine ? (
                  <>
                    <DropdownMenuItem
                      onClick={() =>
                        openComposer({
                          mode: 'edit',
                          comment: d,
                          body: d.body,
                          level: d.spoiler,
                          attach: d.showRating,
                        })
                      }
                    >
                      <PencilLine />
                      {c.edit}
                    </DropdownMenuItem>
                    <DropdownMenuItem className="danger" onClick={() => setToDelete(d)}>
                      <Trash2 />
                      {c.remove}
                    </DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem onClick={() => setToReport(d)}>
                    <Flag />
                    {c.report}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </header>

        {d.deleted ? (
          <p className="dx-gone">{d.removed ? c.removed : c.deleted}</p>
        ) : veiled ? (
          <div className="dx-veil">
            <div className="dx-veil-lines" aria-hidden>
              <span />
              <span />
              <span />
            </div>
            <div className="dx-veil-label">
              <span className="dx-veil-icon" aria-hidden>
                <EyeOff size={18} />
              </span>
              <div>
                <strong>{label}</strong>
                <span>{d.spoiler === 'later' ? c.veiledLater : c.veiledEpisode}</span>
              </div>
            </div>
            <button className="dx-veil-btn" onClick={() => setRevealed((r) => ({ ...r, [d.id]: true }))}>
              {c.reveal}
            </button>
          </div>
        ) : (
          <>
            {shown && (
              <span className="dx-spoiler-tag">
                {label} · {revealed[d.id] ? c.shownManually : c.shownSeen}
              </span>
            )}
            <p className="dx-body">{d.body}</p>
            {revealed[d.id] && (
              <button className="dx-link small" onClick={() => setRevealed((r) => ({ ...r, [d.id]: false }))}>
                {c.veilAgain}
              </button>
            )}
          </>
        )}

        {!d.deleted && (
          <div className="dx-reactions" role="group" aria-label={c.addReaction}>
            {used.map((r) => {
              const n = d.reactions[r.key] || 0;
              const mine = d.myReaction === r.key;
              return (
                <button
                  key={r.key}
                  className={`dx-reaction${mine ? ' mine' : ''}`}
                  aria-pressed={mine}
                  aria-label={`${c.reactionNames[r.key]}, ${n}${mine ? `, ${c.yourReaction}` : ''}`}
                  onClick={() => react(d, r.key)}
                >
                  <span aria-hidden>{r.emoji}</span>
                  {n > 0 && n}
                </button>
              );
            })}
            <Popover>
              <PopoverTrigger asChild>
                <button className="dx-reaction add" aria-label={c.addReaction}>
                  <Plus size={15} />
                </button>
              </PopoverTrigger>
              <PopoverContent className="dx-reaction-picker" align="start" sideOffset={6}>
                {REACTIONS.map((r) => (
                  <button
                    key={r.key}
                    title={c.reactionNames[r.key]}
                    aria-label={c.reactionNames[r.key]}
                    aria-pressed={d.myReaction === r.key}
                    className={d.myReaction === r.key ? 'mine' : ''}
                    onClick={() => react(d, r.key)}
                  >
                    {r.emoji}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          </div>
        )}

        {!reply && (
          <div className="dx-thread-actions">
            {!d.deleted && (
              <button
                className="dx-link"
                onClick={() =>
                  openComposer({ mode: 'reply', parent: d, body: '', level: null, attach: false })
                }
              >
                {c.reply}
              </button>
            )}
            {(d.replyCount || 0) > 0 && (
              <button
                className="dx-link accent"
                aria-expanded={!!openReplies[d.id]}
                onClick={() => setOpenReplies((o) => ({ ...o, [d.id]: !o[d.id] }))}
              >
                {openReplies[d.id] ? c.hideReplies : c.replies(d.replyCount || 0)}
              </button>
            )}
          </div>
        )}
        {!reply && openReplies[d.id] && (d.replies?.length || 0) > 0 && (
          <div className="dx-replies">{d.replies!.map((r) => debriefCard(r, true))}</div>
        )}
      </article>
    );
  };

  return (
    <div className="dx">
      <Hero
        refTarget={refTarget}
        target={target}
        summary={summary}
        seen={seen === true}
        onBack={onBack}
        onShare={share}
      />
      {error ? (
        <div className="notice danger dx-error" role="alert">
          {error}
          <button
            className="ghost-btn small-btn"
            onClick={() => {
              setError('');
              setRetry((n) => n + 1);
            }}
          >
            {t.common.retry}
          </button>
        </div>
      ) : null}
      {guide && guide.mode !== 'single' && (
        <EpisodePicker refTarget={refTarget} guide={guide} activity={activity} onOpen={onOpen} />
      )}

      {target && summary ? (
        <>
          <VerdictCard summary={summary} onRate={rate} />
          <MembersCard summary={summary} showAnyway={showAverage} onShow={() => setShowAverage(true)} />
          <div className="dx-section-head">
            <h2>
              {c.debriefs} <span>{thread?.total ?? summary.debriefs}</span>
            </h2>
            <div className="dx-sort" role="group" hidden={!thread || thread.total === 0}>
              <button
                aria-pressed={sort === 'top'}
                className={sort === 'top' ? 'on' : ''}
                onClick={() => setSort('top')}
              >
                {c.sortTop}
              </button>
              <button
                aria-pressed={sort === 'recent'}
                className={sort === 'recent' ? 'on' : ''}
                onClick={() => setSort('recent')}
              >
                {c.sortRecent}
              </button>
            </div>
          </div>
          {!thread ? (
            <p className="inline-note dx-loading" role="status">
              <LoaderCircle size={16} className="loading-icon" />
            </p>
          ) : thread.comments.length === 0 ? (
            <section className="dx-empty">
              <span>{c.emptyCount}</span>
              <h3>{c.emptyTitle}</h3>
              <p>{c.emptyText}</p>
              <div className="dx-prompts">
                {c.prompts.map((p) => (
                  <button key={p} onClick={() => startNew(p.replace(/…$/, '').trimEnd() + ' ')}>
                    {p}
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <div className="dx-list">
              {thread.comments.map((d) => debriefCard(d))}
              {thread.hasMore && (
                <button className="dx-more" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? <LoaderCircle size={16} className="loading-icon" /> : c.loadMore}
                </button>
              )}
            </div>
          )}
          {!composerOpen && (
            <button className="dx-cta" onClick={() => startNew()}>
              <PencilLine size={18} />
              {thread && thread.comments.length === 0 ? c.writeFirst : c.write}
            </button>
          )}
        </>
      ) : (
        !error && (
          <p className="inline-note dx-loading" role="status">
            <LoaderCircle size={16} className="loading-icon" />
          </p>
        )
      )}

      {draft && target && (
        <Composer
          open={composerOpen}
          draft={draft}
          setDraft={setDraft}
          onClose={() => setComposerOpen(false)}
          target={target}
          what={what}
          myScore={summary?.myScore ?? null}
          username={username}
          setUsername={setUsername}
          onDone={(d) => {
            published(d, draft.mode, draft.parent);
            setComposerOpen(false);
            setDraft(null);
            toast.success(c.published);
          }}
        />
      )}
      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{c.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>{c.deleteText}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <button className="danger-solid" onClick={remove}>
              <Trash2 size={16} />
              {c.remove}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ReportDialog comment={toReport} onClose={() => setToReport(null)} />
    </div>
  );
}

function Hero({
  refTarget,
  target,
  summary,
  seen,
  onBack,
  onShare,
}: {
  refTarget: TargetRef;
  target: Target | null;
  summary: Summary | null;
  seen: boolean;
  onBack: () => void;
  onShare: () => void;
}) {
  const { t } = useI18n();
  const c = t.community;
  const poster = target?.poster || '';
  return (
    <section className="dx-hero">
      {poster && <img className="dx-hero-bg" src={poster} alt="" aria-hidden referrerPolicy="no-referrer" />}
      <div className="dx-hero-shade" aria-hidden />
      <div className="dx-hero-top">
        <button className="dx-round" aria-label={c.back} onClick={onBack}>
          <ArrowLeft size={20} />
        </button>
        <button className="dx-round" aria-label={c.share} onClick={onShare}>
          <Share2 size={18} />
        </button>
      </div>
      <div className="dx-hero-main">
        <Poster src={poster} className="dx-hero-poster" />
        <div className="dx-hero-text">
          <p className="dx-eyebrow">
            {refTarget.episode === null
              ? t.kinds[refTarget.kind]
              : `${target?.title ?? '…'} · ${t.kinds[refTarget.kind]}`}
          </p>
          {refTarget.episode === null ? (
            <h1 className="dx-work-title">{target?.title ?? '…'}</h1>
          ) : (
            <>
              <p className="dx-episode-label">
                {refTarget.kind === 'series' ? c.seasonEpisode(refTarget.season ?? 0) : c.episode}
              </p>
              <h1 className="dx-episode-number">{refTarget.episode}</h1>
            </>
          )}
        </div>
      </div>
      <div className="dx-hero-meta">
        {seen && (
          <span className="dx-seen">
            <Check size={14} aria-hidden />
            {c.seen}
          </span>
        )}
        {summary && <span>{c.counts(summary.debriefs, summary.verdicts)}</span>}
      </div>
    </section>
  );
}

function EpisodePicker({
  refTarget,
  guide,
  activity,
  onOpen,
}: {
  refTarget: TargetRef;
  guide: Exclude<EpisodeGuide, { mode: 'single' }>;
  activity: Activity;
  onOpen: (ref: TargetRef) => void;
}) {
  const { t } = useI18n();
  const c = t.community;
  const work = workOf(refTarget);
  const [other, setOther] = useState(false);
  const [season, setSeason] = useState<number | null>(
    refTarget.season ??
      (guide.mode === 'seasons' ? (guide.seasons.filter((s) => s.season > 0).at(-1)?.season ?? null) : null),
  );
  const [number, setNumber] = useState('');
  const [numberSeason, setNumberSeason] = useState('');
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = strip.current;
    const on = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (row && on) row.scrollLeft = on.offsetLeft - row.clientWidth / 2 + on.clientWidth / 2;
  }, [refTarget.episode, season]);
  const active = (s: number | null, e: number) => refTarget.season === s && refTarget.episode === e;
  const busy = (s: number | null, e: number) =>
    activity.some((a) => a.season === s && a.episode === e && (a.debriefs > 0 || a.verdicts > 0));
  const chip = (s: number | null, e: number) => (
    <button
      key={`${s}-${e}`}
      className={`dx-chip${active(s, e) ? ' on' : ''}`}
      aria-current={active(s, e) ? 'page' : undefined}
      onClick={() => onOpen({ ...work, season: s, episode: e })}
    >
      {c.episodeShort(e)}
      {busy(s, e) && <span className="dx-dot" aria-hidden />}
    </button>
  );

  let episodes: number[] = [];
  let max: number | null = null;
  if (guide.mode === 'absolute') {
    max = guide.released ?? guide.total ?? null;
    const focus = refTarget.episode ?? max ?? 1;
    const from = Math.max(1, focus - 3);
    const to = max ? Math.min(max, focus + 3) : focus + 3;
    for (let e = from; e <= to; e++) episodes.push(e);
  } else if (season !== null) {
    const info = guide.seasons.find((s) => s.season === season);
    episodes = info ? Array.from({ length: info.episodes }, (_, i) => i + 1) : [];
    max = info?.episodes ?? null;
  }

  const go = (event: FormEvent) => {
    event.preventDefault();
    const e = Number(number);
    const s = guide.mode === 'seasons' ? Number(numberSeason || season) : null;
    if (!Number.isInteger(e) || e < 1 || (max && guide.mode === 'absolute' && e > max)) return;
    if (guide.mode === 'seasons' && (!Number.isInteger(s) || (s as number) < 0)) return;
    setOther(false);
    onOpen({ ...work, season: guide.mode === 'seasons' ? (s as number) : null, episode: e });
  };

  return (
    <div className="dx-picker">
      {guide.mode === 'seasons' && guide.seasons.length > 0 && (
        <div className="dx-strip" role="group" aria-label={c.seasonNumber}>
          {guide.seasons.map((s) => (
            <button
              key={s.season}
              className={`dx-chip season${season === s.season ? ' on soft' : ''}`}
              onClick={() => setSeason(s.season)}
            >
              {c.seasonShort(s.season)}
            </button>
          ))}
        </div>
      )}
      <div className="dx-strip" role="group" aria-label={c.episodeNumber} ref={strip}>
        <button
          className={`dx-chip${refTarget.episode === null ? ' on' : ''}`}
          aria-current={refTarget.episode === null ? 'page' : undefined}
          onClick={() => onOpen(work)}
        >
          {c.wholeWork}
        </button>
        {episodes.map((e) => chip(guide.mode === 'seasons' ? season : null, e))}
        <button className="dx-chip ghost" aria-expanded={other} onClick={() => setOther(!other)}>
          {c.otherEpisode}
        </button>
      </div>
      {other && (
        <form className="dx-other" onSubmit={go}>
          {guide.mode === 'seasons' && (
            <label>
              <span>{c.seasonNumber}</span>
              <input
                inputMode="numeric"
                value={numberSeason}
                placeholder={season !== null ? String(season) : '1'}
                onChange={(e) => setNumberSeason(e.target.value.replace(/\D/g, '').slice(0, 3))}
              />
            </label>
          )}
          <label>
            <span>{c.episodeNumber}</span>
            <input
              inputMode="numeric"
              value={number}
              autoFocus
              onChange={(e) => setNumber(e.target.value.replace(/\D/g, '').slice(0, 5))}
            />
          </label>
          <button className="primary" type="submit" disabled={!number}>
            {c.open}
          </button>
          {max && guide.mode === 'absolute' && <span className="form-hint">{c.episodeRange(max)}</span>}
        </form>
      )}
    </div>
  );
}

function VerdictCard({ summary, onRate }: { summary: Summary; onRate: (score: number | null) => void }) {
  const { t } = useI18n();
  const c = t.community;
  const me = summary.myScore;
  return (
    <section className="dx-card" aria-label={c.yourVerdict}>
      <div className="dx-card-head">
        <span className="dx-kicker">{c.yourVerdict}</span>
        {me !== null && (
          <button className="dx-link small" onClick={() => onRate(null)}>
            {c.removeVerdict}
          </button>
        )}
      </div>
      <div className="dx-verdict">
        <span className="dx-verdict-score">{me ?? '?'}</span>
        <span className="dx-verdict-word">{me ? c.verdictWords[me - 1] : c.touchScore}</span>
      </div>
      <div className="dx-scale" role="group" aria-label={c.yourVerdict}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            className={me === n ? 'on' : ''}
            aria-pressed={me === n}
            aria-label={c.scoreAria(n, c.verdictWords[n - 1])}
            onClick={() => onRate(n)}
          >
            {n}
          </button>
        ))}
      </div>
    </section>
  );
}

function MembersCard({
  summary,
  showAnyway,
  onShow,
}: {
  summary: Summary;
  showAnyway: boolean;
  onShow: () => void;
}) {
  const { t, locale } = useI18n();
  const c = t.community;
  const enough = summary.average !== null && summary.histogram;
  const visible = enough && (summary.myScore !== null || showAnyway);
  const peak = Math.max(1, ...(summary.histogram || [1]));
  return (
    <section className="dx-card" aria-label={c.membersVerdict}>
      <span className="dx-kicker">{c.membersVerdict}</span>
      {!enough ? (
        <p className="dx-muted">{c.notEnough(summary.verdicts)}</p>
      ) : !visible ? (
        <div className="dx-hidden-average">
          <div className="dx-bars blurred" aria-hidden>
            {[10, 8, 14, 22, 30, 46, 70, 92, 80, 60].map((h, i) => (
              <span key={i} style={{ height: `${h}%` }} />
            ))}
          </div>
          <div className="dx-hidden-text">
            <p>{c.rateFirst(summary.verdicts)}</p>
            <button className="dx-link" onClick={onShow}>
              {c.seeWithout}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="dx-average">
            <strong>
              {Number(summary.average).toLocaleString(locale, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}
            </strong>
            <span>{c.verdictCount(summary.verdicts)}</span>
          </div>
          <div className="dx-bars" aria-hidden>
            {summary.histogram!.map((n, i) => (
              <span
                key={i}
                className={summary.myScore === i + 1 ? 'mine' : ''}
                style={{ height: `${Math.max(4, Math.round((n / peak) * 100))}%` }}
              >
                {summary.myScore === i + 1 && <em>{c.you}</em>}
              </span>
            ))}
          </div>
          <div className="dx-axis" aria-hidden>
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i}>{i + 1}</span>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Composer({
  open,
  draft,
  setDraft,
  onClose,
  target,
  what,
  myScore,
  username,
  setUsername,
  onDone,
}: {
  open: boolean;
  draft: Draft;
  setDraft: (d: Draft) => void;
  onClose: () => void;
  target: Target;
  what: string;
  myScore: number | null;
  username: string | null | undefined;
  setUsername: (u: string) => void;
  onDone: (d: Debrief) => void;
}) {
  const { t } = useI18n();
  const c = t.community;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const n = draft.body.trim().length;
  const tooLong = draft.body.trim().length > MAX;
  const levels: Spoiler[] = target.episode === null ? ['none', 'episode'] : ['none', 'episode', 'later'];
  const cant = busy || !draft.level || n === 0 || tooLong;
  const title = draft.mode === 'edit' ? c.editTitle : draft.mode === 'reply' ? c.replyTitle : c.composerTitle;
  const where =
    target.episode === null
      ? target.title
      : `${target.title} · ${target.season !== null ? `${c.seasonShort(target.season)} · ` : ''}${c.episodeShort(target.episode)}`;

  const chooseName = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api<{ username: string }>('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name }),
      });
      setUsername(data.username);
    } catch (e) {
      setError(e instanceof Error && e.message !== 'failed' ? e.message : c.actionFailed);
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (cant) return;
    setBusy(true);
    setError('');
    try {
      const d =
        draft.mode === 'edit'
          ? await post<Debrief>({
              op: 'edit',
              comment: draft.comment!.id,
              body: draft.body,
              spoiler: draft.level,
              showRating: draft.attach && myScore !== null,
            })
          : await post<Debrief>({
              op: 'comment',
              target: target.id,
              parent: draft.mode === 'reply' ? draft.parent!.id : null,
              body: draft.body,
              spoiler: draft.level,
              showRating: draft.mode === 'new' && draft.attach && myScore !== null,
            });
      onDone(d);
    } catch (e) {
      // The draft stays: nothing typed is lost.
      setError(e instanceof Error && e.message !== 'failed' ? e.message : c.actionFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="dx-composer" showCloseButton={false}>
        <header className="dx-composer-head">
          <button className="dx-round" aria-label={c.closeComposer} onClick={onClose} disabled={busy}>
            <X size={20} />
          </button>
          <div>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{where}</DialogDescription>
          </div>
          <span className="dx-round-spacer" />
        </header>

        {username === null ? (
          <form className="dx-username-gate" onSubmit={chooseName}>
            <p>{c.needUsername}</p>
            <label className="field">
              <span>{c.usernameLabel}</span>
              <span className="username-input">
                <span aria-hidden>@</span>
                <input
                  value={name}
                  maxLength={20}
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={(e) => setName(e.target.value.toLowerCase())}
                />
              </span>
            </label>
            <p className="form-hint">{t.account.usernameHint}</p>
            {error && (
              <p className="notice danger" role="alert">
                {error}
              </p>
            )}
            <button className="primary" type="submit" disabled={busy || name.trim().length < 3}>
              {busy ? <LoaderCircle size={16} className="loading-icon" /> : <Check size={16} />}
              {c.usernameSave}
            </button>
          </form>
        ) : (
          <div className="dx-composer-body">
            {draft.mode !== 'reply' && myScore !== null && (
              <div className="dx-attach">
                <span className="dx-badge" aria-hidden>
                  {myScore}
                </span>
                <div>
                  <strong>{c.attachVerdict}</strong>
                  <span>{c.attachHint(myScore, c.verdictWords[myScore - 1])}</span>
                </div>
                <button
                  role="switch"
                  aria-checked={draft.attach}
                  aria-label={c.attachVerdict}
                  className={`dx-switch${draft.attach ? ' on' : ''}`}
                  onClick={() => setDraft({ ...draft, attach: !draft.attach })}
                >
                  <span />
                </button>
              </div>
            )}
            <textarea
              ref={field}
              aria-label={title}
              value={draft.body}
              maxLength={MAX + 200}
              placeholder={draft.mode === 'reply' ? c.replyPlaceholder : c.placeholder}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
            <div className={`dx-count${tooLong ? ' over' : n > 1800 ? ' near' : ''}`}>{c.count(n)}</div>
            <p className="dx-kicker">{c.contains}</p>
            <div className={`dx-levels n${levels.length}`} role="group" aria-label={c.contains}>
              {levels.map((level) => {
                const on = draft.level === level;
                const [label, hint] =
                  level === 'none'
                    ? [c.levelNone, c.levelNoneHint]
                    : level === 'episode'
                      ? [c.levelEpisode(what), c.levelEpisodeHint]
                      : [c.levelLater, c.levelLaterHint];
                return (
                  <button
                    key={level}
                    className={on ? 'on' : ''}
                    aria-pressed={on}
                    onClick={() => setDraft({ ...draft, level })}
                  >
                    <span className="dx-level-icon" aria-hidden>
                      {level === 'none' ? (
                        <Check size={17} />
                      ) : level === 'episode' ? (
                        <EyeOff size={17} />
                      ) : (
                        <Lock size={17} />
                      )}
                    </span>
                    <strong>{label}</strong>
                    <span>{hint}</span>
                  </button>
                );
              })}
            </div>
            {error && (
              <p className="notice danger" role="alert">
                {error}
              </p>
            )}
            <button className="dx-publish" disabled={cant} onClick={publish}>
              {busy ? (
                <LoaderCircle size={18} className="loading-icon" />
              ) : draft.mode === 'edit' ? (
                c.saveEdit
              ) : !draft.level ? (
                c.pickLevel
              ) : tooLong ? (
                c.tooLong
              ) : (
                c.publish[draft.level]
              )}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReportDialog({ comment, onClose }: { comment: Debrief | null; onClose: () => void }) {
  const { t } = useI18n();
  const c = t.community;
  const [reason, setReason] = useState<keyof typeof c.reasons | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!comment || !reason || busy) return;
    setBusy(true);
    try {
      await post({ op: 'report', comment: comment.id, reason, details: details.trim() });
      toast.success(c.reportThanks);
      setReason(null);
      setDetails('');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error && e.message !== 'failed' ? e.message : c.actionFailed);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!comment} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="dx-report">
        <DialogTitle>{c.reportTitle}</DialogTitle>
        <DialogDescription>{c.reportIntro}</DialogDescription>
        <form onSubmit={send}>
          <fieldset className="dx-reasons">
            <legend className="sr-only">{c.reportTitle}</legend>
            {(Object.keys(c.reasons) as (keyof typeof c.reasons)[]).map((key) => (
              <label key={key} className={reason === key ? 'on' : ''}>
                <input type="radio" name="reason" checked={reason === key} onChange={() => setReason(key)} />
                {c.reasons[key]}
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span>{c.reportDetails}</span>
            <textarea value={details} maxLength={500} onChange={(e) => setDetails(e.target.value)} />
          </label>
          <button className="primary full" type="submit" disabled={!reason || busy}>
            {busy ? <LoaderCircle size={16} className="loading-icon" /> : <Flag size={16} />}
            {c.reportSend}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
