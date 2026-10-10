'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  Check,
  Clapperboard,
  ImagePlus,
  LoaderCircle,
  Send,
  Share,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
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
  PHOTOS_MAX,
  POST_MAX,
  TARGET_REACTIONS,
  refPath,
  spoilerHidden,
  viewerSeen,
  workOf,
  type Debrief,
  type EpisodeGuide,
  type Reaction,
  type Spoiler,
  type Summary,
  type Target,
  type TargetReaction,
  type TargetRef,
  type Video,
} from '@/lib/community';
import { discardPhotos, uploadPhotos } from '@/lib/photos';
import { VideoFailure, discardVideo, uploadVideo } from '@/lib/videos';
import type { Media } from '@/lib/watch';
import {
  Avatar,
  Loading,
  Poster,
  ReportDialog,
  UsernameDialog,
  api,
  post,
  problem,
  refQuery,
} from './community-ui';
import { useI18n } from './i18n-provider';
import {
  EmojiButton,
  LevelMenu,
  PhotoDraft,
  VideoDraft,
  VideoPlayer,
  PhotoGrid,
  PostRow,
  RichText,
  SpoilerCover,
  insertAtCursor,
  usePhotoDraft,
  useVideoDraft,
} from './post-ui';

type Thread = { comments: Debrief[]; total: number; hasMore: boolean };
type Activity = { season: number | null; episode: number; debriefs: number; verdicts: number }[];
type Draft = {
  mode: 'new' | 'reply' | 'edit';
  parent?: Debrief;
  comment?: Debrief;
  body: string;
  level: Spoiler;
};
const POLL = 15000;
const blank: Draft = { mode: 'new', body: '', level: 'none' };

export default function DiscussionView({
  refTarget,
  collection,
  signedIn,
  userId,
  onOpen,
  onBack,
  onSignIn,
  onTag,
}: {
  refTarget: TargetRef;
  collection: Media[];
  signedIn: boolean;
  userId: string | null;
  onOpen: (ref: TargetRef) => void;
  onBack: () => void;
  onSignIn: () => void;
  onTag: (tag: string) => void;
}) {
  const { t, locale } = useI18n();
  const c = t.community;
  const [target, setTarget] = useState<Target | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [protection, setProtection] = useState(true);
  const [guide, setGuide] = useState<EpisodeGuide | null>(null);
  const [activity, setActivity] = useState<Activity>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [sort, setSort] = useState<'top' | 'recent'>('top');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [openReplies, setOpenReplies] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Draft>(blank);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [askName, setAskName] = useState(false);
  const [toDelete, setToDelete] = useState<Debrief | null>(null);
  const [toReport, setToReport] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null | undefined>(undefined);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [fresh, setFresh] = useState(0);
  const photos = usePhotoDraft((message) => toast.error(message));
  const clip = useVideoDraft((message) => toast.error(message, { duration: 9000 }));
  // Messages counted when the list was last loaded: the difference is "N nouveaux messages".
  const baseline = useRef(0);
  const field = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const videoFile = useRef<HTMLInputElement>(null);
  const listHead = useRef<HTMLDivElement>(null);
  const refKey = refPath(refTarget);
  const workKey = refPath(workOf(refTarget));

  // The discussion, its scores, and the member's spoiler setting.
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    // Each discussion mounts its own view (see its key in watch-app), so there is nothing to reset here.
    api<{ target: Target; summary: Summary; prefs: { spoilerProtection: boolean } }>(
      `/api/community?op=target&${refQuery(refTarget)}`,
    )
      .then((data) => {
        if (!live) return;
        setTarget(data.target);
        setSummary(data.summary);
        setProtection(data.prefs.spoilerProtection);
        baseline.current = data.summary.debriefs;
      })
      .catch((e) => live && setError(problem(e, c.loadFailed)));
    return () => {
      live = false;
    };
    // refKey stands for refTarget; the texts only matter for the first error.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refKey, signedIn, retry]);

  // The episode strip, once per work.
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

  // New messages from others, every 15 seconds while the page is on screen.
  useEffect(() => {
    if (!target) return;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const next = await api<Summary>(`/api/community?op=summary&target=${target.id}`);
        setSummary(next);
        setFresh(Math.max(0, next.debriefs - baseline.current));
      } catch {
        // Offline for a moment: the next round tries again.
      }
    }, POLL);
    return () => window.clearInterval(timer);
  }, [target]);

  useEffect(() => {
    if (!signedIn) return;
    fetch('/api/profile', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        setUsername(data.username ?? null);
        setAvatar(data.avatar ?? null);
      })
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
  const count = thread?.total ?? summary?.debriefs ?? 0;

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

  const bar = (
    <header className="dx-bar">
      <button className="dx-bar-btn" aria-label={c.back} onClick={onBack}>
        <ArrowLeft size={20} />
      </button>
      <div className="dx-bar-title">
        <strong>{c.discussion}</strong>
        {signedIn && summary && <span>{c.messagesCount(count)}</span>}
      </div>
      {signedIn ? (
        <button className="dx-bar-btn" aria-label={c.share} onClick={() => share()}>
          <Share size={18} />
        </button>
      ) : (
        <span className="dx-round-spacer" />
      )}
    </header>
  );

  if (!signedIn)
    return (
      <div className="dx">
        {bar}
        <section className="panel dx-blocked">
          <p>{c.signIn}</p>
          <button className="primary" onClick={onSignIn}>
            {t.nav.signIn}
          </button>
        </section>
      </div>
    );

  const rate = async (score: number | null) => {
    if (!target || !summary) return;
    const previous = summary;
    setSummary({ ...summary, myScore: score });
    try {
      setSummary(await post<Summary>({ op: 'rate', target: target.id, score }));
    } catch (e) {
      setSummary(previous);
      toast.error(problem(e, c.actionFailed));
    }
  };

  const reactTarget = async (reaction: TargetReaction) => {
    if (!target || !summary) return;
    const previous = summary;
    const counts = { ...summary.targetReactions };
    const mine = summary.myTargetReaction === reaction ? null : reaction;
    if (summary.myTargetReaction)
      counts[summary.myTargetReaction] = (counts[summary.myTargetReaction] || 1) - 1;
    if (mine) counts[mine] = (counts[mine] || 0) + 1;
    setSummary({ ...summary, targetReactions: counts, myTargetReaction: mine });
    try {
      const result = await post<Pick<Summary, 'targetReactions' | 'myTargetReaction'>>({
        op: 'reactTarget',
        target: target.id,
        reaction,
      });
      setSummary((s) => (s ? { ...s, ...result } : s));
    } catch (e) {
      setSummary(previous);
      toast.error(problem(e, c.actionFailed));
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

  // The heart: tapping again removes it; it replaces any other reaction given before.
  const like = async (d: Debrief) => {
    const before = { reactions: d.reactions, myReaction: d.myReaction };
    const reaction: Reaction = 'heart';
    const counts = { ...d.reactions };
    if (d.myReaction) counts[d.myReaction] = (counts[d.myReaction] || 1) - 1;
    const mine = d.myReaction === reaction ? null : reaction;
    if (mine) counts[mine] = (counts[mine] || 0) + 1;
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
      toast.error(problem(e, c.actionFailed));
    }
  };

  const focusComposer = () => window.setTimeout(() => field.current?.focus(), 30);
  const resizeField = () => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  };

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
      baseline.current += 1;
      listHead.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const send = async (named = false) => {
    if (!target || !userId || sending) return;
    const text = draft.body.trim();
    const withPhotos = draft.mode !== 'edit' ? photos.items : [];
    const withVideo = draft.mode !== 'edit' ? clip.item : null;
    if ((!text && !withPhotos.length && !withVideo) || text.length > POST_MAX) return;
    if (username === null && !named) {
      setAskName(true);
      return;
    }
    setSending(true);
    let sent: string[] = [];
    let sentVideo: Video | null = null;
    try {
      let d: Debrief;
      if (draft.mode === 'edit') {
        d = await post<Debrief>({
          op: 'editPost',
          comment: draft.comment!.id,
          body: text,
          spoiler: draft.level,
        });
      } else {
        const uploaded = withPhotos.length ? await uploadPhotos(userId, withPhotos) : [];
        sent = uploaded.map((p) => p.path);
        sentVideo = withVideo
          ? await uploadVideo(userId, withVideo, (share) => setProgress(Math.round(share * 100)))
          : null;
        d = (
          await post<{ post: Debrief }>({
            op: 'publish',
            target: target.id,
            work: null,
            parent: draft.mode === 'reply' ? draft.parent!.id : null,
            kind: 'debrief',
            body: text,
            spoiler: draft.level,
            score: null,
            photos: uploaded,
            video: sentVideo,
          })
        ).post;
        sent = [];
        sentVideo = null;
        photos.clear();
        clip.clear();
      }
      published(d, draft.mode, draft.parent);
      setDraft(blank);
      if (field.current) field.current.style.height = '';
      if (draft.mode === 'edit') toast.success(c.published);
    } catch (e) {
      // Files sent for a message that failed are removed again; the text stays.
      await Promise.all([discardPhotos(sent), discardVideo(sentVideo)]);
      toast.error(
        e instanceof VideoFailure
          ? c.compose.videoErrors.upload
          : e instanceof Error && e.message === 'upload'
            ? c.compose.photoErrors.upload
            : problem(e, c.actionFailed),
      );
    } finally {
      setSending(false);
      setProgress(null);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    send();
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends on a computer; on a phone it adds a line, and the button sends.
    if (event.key === 'Enter' && !event.shiftKey && window.matchMedia('(pointer: fine)').matches) {
      event.preventDefault();
      send();
    }
  };

  const remove = async () => {
    const d = toDelete;
    if (!d) return;
    try {
      await post({ op: 'delete', comment: d.id });
      patchComment(d.id, (x) =>
        (x.replyCount || 0) > 0
          ? { ...x, deleted: true, body: '', photos: [], rating: null, reactions: {}, myReaction: null }
          : null,
      );
      if (!d.parentId) {
        setSummary((s) => (s ? { ...s, debriefs: Math.max(0, s.debriefs - 1) } : s));
        baseline.current = Math.max(0, baseline.current - 1);
      }
      setToDelete(null);
    } catch (e) {
      toast.error(problem(e, c.actionFailed));
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

  // "↑ N nouveaux messages": the newest first, from the top of the discussion.
  const showFresh = async () => {
    if (!target) return;
    try {
      const [latest, next] = await Promise.all([
        loadThread(target.id, 'recent', 0),
        api<Summary>(`/api/community?op=summary&target=${target.id}`),
      ]);
      if (sort !== 'recent') setSort('recent');
      setThread(latest);
      setSummary(next);
      baseline.current = next.debriefs;
      setFresh(0);
      listHead.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      toast.error(c.actionFailed);
    }
  };

  const veilReason = (d: Debrief) =>
    d.spoiler === 'later'
      ? c.veiledLater
      : seen === false
        ? refTarget.episode === null
          ? c.hub.notFinished
          : c.hub.notSeenEpisode
        : c.hub.maybeNotSeen;

  const content = (d: Debrief) => {
    const hidden = spoilerHidden(d.spoiler, seen, protection) && !revealed[d.id];
    const label = d.spoiler === 'later' ? c.spoilerLater : c.spoilerOf(what);
    if (hidden)
      return (
        <SpoilerCover
          title={label}
          reason={veilReason(d)}
          photoCount={d.photos.length}
          hasVideo={!!d.video}
          backdrop={target?.backdrop || target?.poster}
          onShow={() => setRevealed((r) => ({ ...r, [d.id]: true }))}
        />
      );
    return (
      <>
        {d.spoiler !== 'none' && (
          <span className="dx-spoiler-tag">
            {label}
            {revealed[d.id] && (
              <button className="dx-link small" onClick={() => setRevealed((r) => ({ ...r, [d.id]: false }))}>
                {c.veilAgain}
              </button>
            )}
          </span>
        )}
        {d.body && <RichText text={d.body} onTag={onTag} />}
        <PhotoGrid photos={d.photos} />
        {d.video && <VideoPlayer video={d.video} />}
      </>
    );
  };

  const postRow = (d: Debrief, reply = false, threadLine = false) => (
    <PostRow
      key={d.id}
      post={d}
      reply={reply}
      thread={threadLine}
      replyCount={reply ? undefined : d.replyCount || 0}
      onReplies={
        reply
          ? undefined
          : (d.replyCount || 0) > 0
            ? () => setOpenReplies((o) => ({ ...o, [d.id]: !o[d.id] }))
            : undefined
      }
      onReply={
        reply
          ? undefined
          : () => {
              setDraft({ mode: 'reply', parent: d, body: '', level: 'none' });
              focusComposer();
            }
      }
      onLike={() => like(d)}
      onEdit={() => {
        setDraft({ mode: 'edit', comment: d, body: d.body, level: d.spoiler });
        focusComposer();
      }}
      onDelete={() => setToDelete(d)}
      onReport={() => setToReport(d.id)}
    >
      {content(d)}
    </PostRow>
  );

  const subtitle =
    refTarget.episode === null
      ? [t.kinds[refTarget.kind], target?.year].filter(Boolean).join(' · ')
      : refTarget.kind === 'series'
        ? c.seasonEpisodeTitle(refTarget.season ?? 0, refTarget.episode)
        : c.episodeTitle(refTarget.episode);
  const levels: Spoiler[] = refTarget.episode === null ? ['none', 'episode'] : ['none', 'episode', 'later'];
  const length = draft.body.trim().length;
  const canSend =
    !sending &&
    length <= POST_MAX &&
    (length > 0 || (draft.mode !== 'edit' && (photos.items.length > 0 || !!clip.item)));

  return (
    <div className="dx">
      {bar}
      <section className="dx-work">
        <Poster src={target?.poster || ''} className="dx-work-poster" />
        <div className="dx-work-text">
          <h1>{target?.title ?? '…'}</h1>
          {subtitle && <p>{subtitle}</p>}
          {seen === true && (
            <span className="dx-seen">
              <Check size={13} strokeWidth={3} aria-hidden />
              {refTarget.episode === null ? c.seen : c.episodeSeen}
            </span>
          )}
        </div>
      </section>

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
          <section className="dx-rate" aria-label={`${c.yourScore} · ${c.yourReaction}`}>
            <div className="dx-rate-row">
              <span className="dx-rate-label">{c.yourScoreShort}</span>
              <div className="dx-mini-score" role="group" aria-label={c.yourScore}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={summary.myScore !== null && n <= summary.myScore ? 'on' : ''}
                    aria-pressed={summary.myScore === n}
                    aria-label={c.scoreAria(n)}
                    onClick={() => rate(summary.myScore === n ? null : n)}
                  >
                    <span aria-hidden />
                  </button>
                ))}
              </div>
              <strong className="dx-rate-value">{summary.myScore ?? '–'}</strong>
            </div>
            <div className="dx-rate-row">
              <span className="dx-rate-label">{c.reactionShort}</span>
              <div className="dx-react-row" role="group" aria-label={c.yourReaction}>
                {TARGET_REACTIONS.map((r) => {
                  const n = summary.targetReactions[r.key] || 0;
                  const mine = summary.myTargetReaction === r.key;
                  return (
                    <button
                      key={r.key}
                      type="button"
                      className={mine ? 'on' : ''}
                      aria-pressed={mine}
                      aria-label={`${c.reactionNames[r.key]}, ${n}`}
                      onClick={() => reactTarget(r.key)}
                    >
                      <span aria-hidden>{r.emoji}</span>
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>
            <p className="dx-average">
              {summary.average !== null
                ? c
                    .communityAverage(
                      Number(summary.average).toLocaleString(locale, {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      }),
                      summary.verdicts,
                    )
                    .split(/(\d+[.,]\d)/)
                    .map((part, i) => (i === 1 ? <strong key={i}>{part}</strong> : part))
                : c.fewScores(summary.verdicts)}
            </p>
          </section>

          <div className="dx-tabs" role="tablist" aria-label={c.sortBy} ref={listHead}>
            {(['top', 'recent'] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={sort === s}
                className={sort === s ? 'on' : ''}
                onClick={() => setSort(s)}
              >
                <span>{s === 'top' ? c.sortTop : c.sortRecent}</span>
              </button>
            ))}
          </div>
          {fresh > 0 && (
            <button className="dx-fresh" onClick={showFresh}>
              <ArrowUp size={15} aria-hidden />
              {c.newMessages(fresh)}
            </button>
          )}
          {!thread ? (
            <Loading />
          ) : thread.comments.length === 0 ? (
            <section className="dx-empty">
              <h3>{c.emptyTitle}</h3>
              <p>{c.emptyText}</p>
              <div className="dx-prompts">
                {c.prompts.map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setDraft({ ...blank, body: p.replace(/…$/, '').trimEnd() + ' ' });
                      focusComposer();
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <div className="dx-list">
              {thread.comments.map((d) => {
                const replies = openReplies[d.id] ? d.replies || [] : [];
                return (
                  <div key={d.id} className="dx-group">
                    {postRow(d, false, replies.length > 0)}
                    {replies.map((r, i) => postRow(r, true, i < replies.length - 1))}
                    {!openReplies[d.id] && (d.replyCount || 0) > 0 && (
                      <button
                        className="dx-see-replies"
                        onClick={() => setOpenReplies((o) => ({ ...o, [d.id]: true }))}
                      >
                        {c.hub.seeReplies(d.replyCount || 0)}
                      </button>
                    )}
                  </div>
                );
              })}
              {thread.hasMore && (
                <button className="dx-more" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? <Loading /> : c.loadMore}
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        !error && <Loading />
      )}

      {target && (
        <form className="dx-composer" onSubmit={submit}>
          {(draft.mode !== 'new' || length > POST_MAX - 200 || progress !== null) && (
            <div className="dx-composer-context">
              <span>
                {progress !== null && (
                  <strong className="dx-progress">{c.compose.sendingVideo(progress)} </strong>
                )}
                {draft.mode === 'reply'
                  ? c.replyingTo(draft.parent?.username ?? c.deletedAccount)
                  : draft.mode === 'edit'
                    ? c.editing
                    : ''}
                {length > POST_MAX - 200 && (
                  <em className={length > POST_MAX ? 'over' : ''}>
                    {' '}
                    {length.toLocaleString(locale)} / {POST_MAX.toLocaleString(locale)}
                  </em>
                )}
              </span>
              {draft.mode !== 'new' && (
                <button
                  type="button"
                  className="dx-icon"
                  aria-label={c.cancelReply}
                  onClick={() => setDraft(blank)}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          )}
          {draft.mode !== 'edit' && <PhotoDraft items={photos.items} onRemove={photos.remove} />}
          {draft.mode !== 'edit' && <VideoDraft item={clip.item} onRemove={clip.clear} />}
          <div className="dx-composer-row">
            <span className="dx-composer-avatar">
              <Avatar name={username || null} avatar={avatar} round size="sm" />
            </span>
            <textarea
              ref={field}
              rows={1}
              value={draft.body}
              maxLength={POST_MAX + 200}
              aria-label={draft.mode === 'reply' ? c.replyPlaceholder : c.placeholder}
              placeholder={draft.mode === 'reply' ? c.replyPlaceholder : c.placeholder}
              onChange={(e) => {
                setDraft({ ...draft, body: e.target.value });
                resizeField();
              }}
              onKeyDown={onKey}
            />
            <button
              type="submit"
              className="dx-send"
              aria-label={draft.mode === 'edit' ? c.saveEdit : c.send}
              disabled={!canSend}
            >
              {sending ? (
                <LoaderCircle size={17} className="loading-icon" />
              ) : draft.mode === 'edit' ? (
                <Check size={18} />
              ) : (
                <Send size={17} />
              )}
            </button>
          </div>
          <div className="dx-composer-tools">
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
            <input
              ref={videoFile}
              type="file"
              accept="video/mp4,video/webm,video/quicktime,.mp4,.m4v,.mov,.webm"
              hidden
              onChange={(e) => {
                clip.pick(e.target.files);
                e.target.value = '';
              }}
            />
            {draft.mode !== 'edit' && (
              <>
                <button
                  type="button"
                  className="px-tool"
                  aria-label={c.compose.addPhoto}
                  title={clip.item ? c.compose.photosOrVideo : c.compose.addPhoto}
                  disabled={photos.busy || photos.items.length >= PHOTOS_MAX || !!clip.item}
                  onClick={() => files.current?.click()}
                >
                  {photos.busy ? (
                    <LoaderCircle size={18} className="loading-icon" />
                  ) : (
                    <ImagePlus size={19} />
                  )}
                </button>
                <button
                  type="button"
                  className="px-tool"
                  aria-label={c.compose.addVideo}
                  title={photos.items.length ? c.compose.photosOrVideo : c.compose.addVideo}
                  disabled={clip.busy || !!clip.item || photos.items.length > 0}
                  onClick={() => videoFile.current?.click()}
                >
                  {clip.busy ? (
                    <LoaderCircle size={18} className="loading-icon" />
                  ) : (
                    <Clapperboard size={19} />
                  )}
                </button>
              </>
            )}
            <EmojiButton
              onPick={(emoji) =>
                insertAtCursor(field.current, draft.body, emoji, (body) => setDraft((d) => ({ ...d, body })))
              }
            />
            <span className="rx-spacer" />
            <LevelMenu
              level={draft.level}
              levels={levels}
              what={what}
              onChange={(level) => setDraft({ ...draft, level })}
            />
          </div>
        </form>
      )}

      <UsernameDialog
        open={askName}
        onClose={() => setAskName(false)}
        onDone={(name) => {
          setUsername(name);
          setAskName(false);
          send(true);
        }}
      />
      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{c.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>{c.deleteText}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <button className="danger-solid" onClick={remove}>
              {c.remove}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ReportDialog comment={toReport} onClose={() => setToReport(null)} />
    </div>
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
      {guide.mode === 'seasons' && guide.seasons.length > 1 && (
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
