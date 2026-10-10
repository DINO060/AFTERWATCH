'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronRight,
  Hash,
  ImagePlus,
  MessageCircle,
  PencilLine,
  Plus,
  ShieldCheck,
  Smile,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import type { CatalogItem } from '@/lib/catalog';
import {
  inCollection,
  refFromMedia,
  refPath,
  viewerSeen,
  type FeedItem,
  type Photo,
  type Video,
  type Reaction,
  type TargetRef,
} from '@/lib/community';
import type { Media } from '@/lib/watch';
import { Avatar, Loading, Poster, ReportDialog, Switch, api, post, problem } from './community-ui';
import { useI18n } from './i18n-provider';
import { PhotoGrid, PostRow, RichText, SpoilerCover, VideoPlayer } from './post-ui';
import ComposeSheet from './compose-sheet';

type Kind = TargetRef['kind'];
type WorkKey = Pick<TargetRef, 'kind' | 'source' | 'sourceId'>;
type Activity = WorkKey & {
  debriefs: number;
  latestAt: string;
  latest: { season: number | null; episode: number | null };
  /** Set when the answer arrives: a message in the last 48 hours. */
  fresh?: boolean;
};
type Trend = { tag: string; posts: number; members: number };
type Pick4 = { ref: TargetRef; title: string; image: string; item?: CatalogItem };
type Shown = { body: string; photos: Photo[]; video?: Video | null };
type Revealed = Record<string, Shown>;
const FRESH = 48 * 3600 * 1000;
const FILTERS: (Kind | null)[] = [null, 'anime', 'series', 'film', 'manga'];
const keyOf = (r: WorkKey) => `${r.kind}:${r.source}:${r.sourceId}`;
const workOnly = (r: WorkKey): TargetRef => ({ ...r, season: null, episode: null });
const refOf = (t: FeedItem['target']): TargetRef => ({
  kind: t.kind,
  source: t.source,
  sourceId: t.sourceId,
  season: t.season,
  episode: t.episode,
});

/** "Communauté": posts about works and episodes, X / Threads style, with spoilers kept hidden. */
export default function CommunityView({
  userId,
  collection,
  signedIn,
  canAdd,
  tag,
  onTag,
  onOpen,
  onSignIn,
  onBrowse,
  onAdd,
}: {
  userId: string | null;
  collection: Media[];
  signedIn: boolean;
  canAdd: boolean;
  tag: string | null;
  onTag: (tag: string | null) => void;
  onOpen: (ref: TargetRef) => void;
  onSignIn: () => void;
  onBrowse: () => void;
  onAdd: (item: CatalogItem) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const h = t.community.hub;
  const works = useMemo(
    () =>
      collection
        .map((m) => refFromMedia(m))
        .filter((r): r is TargetRef => !!r)
        .slice(0, 300)
        .map(({ kind, source, sourceId }) => ({ kind, source, sourceId })),
    [collection],
  );
  const listKey = works.map(keyOf).join('|');
  const [kind, setKind] = useState<Kind | null>(null);
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [protection, setProtection] = useState(true);
  const [revealed, setRevealed] = useState<Revealed>({});
  const [revealing, setRevealing] = useState<Record<string, boolean>>({});
  const [composing, setComposing] = useState(false);
  const [adding, setAdding] = useState<Record<string, boolean>>({});
  const [toReport, setToReport] = useState<string | null>(null);
  const [trends, setTrends] = useState<Trend[]>([]);
  const [username, setUsername] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);

  const seenOf = (item: FeedItem) => viewerSeen(item.target, collection);
  // Spoilers the member has already seen are shown without asking.
  const revealSeen = (list: FeedItem[]) => {
    const ids = list
      .filter((i) => i.body === null && i.spoiler === 'episode' && seenOf(i) === true)
      .map((i) => i.id)
      .slice(0, 50);
    if (!ids.length) return;
    post<Revealed>({ op: 'reveal', ids })
      .then((found) => setRevealed((r) => ({ ...r, ...found })))
      .catch(() => {});
  };
  const load = (offset: number) =>
    post<{ items: FeedItem[]; hasMore: boolean; spoilerProtection: boolean }>({
      op: 'timeline',
      kind,
      tag,
      works,
      offset,
    });

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    load(0)
      .then((data) => {
        if (!live) return;
        setItems(data.items);
        setHasMore(data.hasMore);
        setProtection(data.spoilerProtection);
        setFailed(false);
        revealSeen(data.items);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // listKey stands for works.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, tag, listKey, reload, signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    api<Trend[]>('/api/community?op=trending')
      .then((list) => live && setTrends(list))
      .catch(() => {});
    api<{ username: string | null; avatar: string | null }>('/api/profile')
      .then((data) => {
        if (!live) return;
        setUsername(data.username ?? null);
        setAvatar(data.avatar ?? null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [signedIn]);

  if (!signedIn)
    return (
      <div className="cv">
        <div className="cv-main">
          <h1 className="cv-title">{h.title}</h1>
          <section className="panel dx-blocked">
            <p>{h.signIn}</p>
            <button className="primary" onClick={onSignIn}>
              {t.nav.signIn}
            </button>
          </section>
        </div>
      </div>
    );

  const more = async () => {
    if (!items || busy) return;
    setBusy(true);
    try {
      const data = await load(items.length);
      setItems([...items, ...data.items.filter((n) => !items.some((x) => x.id === n.id))]);
      setHasMore(data.hasMore);
      revealSeen(data.items);
    } catch {
      toast.error(h.loadFailed);
    } finally {
      setBusy(false);
    }
  };

  const toggleProtection = async (on: boolean) => {
    setProtection(on);
    try {
      await post({ op: 'prefs', spoilerProtection: on });
      setRevealed({});
      setReload((n) => n + 1);
    } catch (e) {
      setProtection(!on);
      toast.error(problem(e, t.community.actionFailed));
    }
  };

  const reveal = async (id: string) => {
    setRevealing((r) => ({ ...r, [id]: true }));
    try {
      const found = await post<Revealed>({ op: 'reveal', ids: [id] });
      setRevealed((r) => ({ ...r, ...found }));
    } catch (e) {
      toast.error(problem(e, t.community.actionFailed));
    } finally {
      setRevealing((r) => ({ ...r, [id]: false }));
    }
  };

  const like = async (item: FeedItem) => {
    const patch = (change: Pick<FeedItem, 'reactions' | 'myReaction'>) =>
      setItems((list) => list && list.map((x) => (x.id === item.id ? { ...x, ...change } : x)));
    const before = { reactions: item.reactions, myReaction: item.myReaction };
    const counts = { ...item.reactions };
    if (item.myReaction) counts[item.myReaction] = (counts[item.myReaction] || 1) - 1;
    const mine: Reaction | null = item.myReaction === 'heart' ? null : 'heart';
    if (mine) counts[mine] = (counts[mine] || 0) + 1;
    for (const key of Object.keys(counts) as Reaction[]) if (!counts[key]) delete counts[key];
    patch({ reactions: counts, myReaction: mine });
    try {
      patch(await post({ op: 'react', comment: item.id, reaction: 'heart' }));
    } catch (e) {
      patch(before);
      toast.error(problem(e, t.community.actionFailed));
    }
  };

  const share = async (ref: TargetRef, title: string) => {
    const url = window.location.origin + refPath(ref);
    try {
      if (navigator.share) await navigator.share({ title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success(h.linkCopied);
      }
    } catch {
      // Share sheet closed.
    }
  };

  // "+ Ma liste": the catalog's own entry, added like from the catalog page.
  const add = async (ref: WorkKey, item?: CatalogItem) => {
    const key = keyOf(ref);
    if (adding[key]) return;
    if (!canAdd) return onSignIn();
    setAdding((a) => ({ ...a, [key]: true }));
    try {
      const entry =
        item ??
        (
          await api<{ item: CatalogItem }>(
            `/api/catalog/detail?${new URLSearchParams({ kind: ref.kind, source: ref.source, id: ref.sourceId })}`,
          )
        ).item;
      await onAdd(entry);
    } catch (e) {
      toast.error(problem(e, t.community.actionFailed));
    } finally {
      setAdding((a) => ({ ...a, [key]: false }));
    }
  };

  const write = () => (userId ? setComposing(true) : onSignIn());
  const showTrends = trends.length > 0 && !tag;

  return (
    <div className="cv">
      <div className="cv-main">
        <h1 className="cv-title">{h.title}</h1>
        {tag ? (
          <div className="cv-tagbar">
            <Hash size={20} aria-hidden />
            <strong>{tag}</strong>
            <button type="button" className="dx-icon" aria-label={h.clearTag} onClick={() => onTag(null)}>
              <X size={18} />
            </button>
          </div>
        ) : null}
        <div className="cv-tabs" role="tablist" aria-label={h.filters}>
          {FILTERS.map((k) => (
            <button
              key={k ?? 'all'}
              type="button"
              role="tab"
              aria-selected={kind === k}
              className={kind === k ? 'on' : ''}
              onClick={() => {
                if (kind === k) return;
                setItems(null);
                setKind(k);
              }}
            >
              <span>{k ? t.kindsPlural[k] : h.forYou}</span>
            </button>
          ))}
        </div>

        <button type="button" className="cv-compose" onClick={write}>
          <Avatar name={username} avatar={avatar} round />
          <span className="cv-compose-text">{h.whatsNew}</span>
          <span className="cv-compose-tools" aria-hidden>
            <ImagePlus size={19} />
            <Smile size={19} />
          </span>
          <span className="cv-compose-post">{h.publish}</span>
        </button>

        <div className="cv-protect">
          <ShieldCheck size={16} aria-hidden />
          <span>{protection ? h.protectionShortOn : h.protectionShortOff}</span>
          <Switch on={protection} onChange={toggleProtection} label={h.protection} tone="green" />
        </div>

        {showTrends && (
          <div className="dx-strip cv-trend-strip" role="group" aria-label={h.trends}>
            {trends.map((tr) => (
              <button key={tr.tag} type="button" className="cv-trend-chip" onClick={() => onTag(tr.tag)}>
                #{tr.tag}
              </button>
            ))}
          </div>
        )}

        {failed && !items ? (
          <div className="notice danger dx-error" role="alert">
            {h.loadFailed}
            <button className="ghost-btn small-btn" onClick={() => setReload((n) => n + 1)}>
              {t.common.retry}
            </button>
          </div>
        ) : !items ? (
          <Loading />
        ) : items.length === 0 ? (
          <section className="cx-empty">
            <MessageCircle size={28} aria-hidden />
            <p>{tag ? h.tagEmpty : kind ? h.emptyKind : h.empty}</p>
          </section>
        ) : (
          <div className="cv-feed">
            {items.map((item) => (
              <FeedPost
                key={item.id}
                item={item}
                shown={
                  item.body !== null
                    ? { body: item.body, photos: item.photos, video: item.video }
                    : (revealed[item.id] ?? null)
                }
                seen={seenOf(item)}
                inList={inCollection(item.target, collection)}
                adding={!!adding[keyOf(item.target)]}
                revealing={!!revealing[item.id]}
                onOpen={onOpen}
                onTag={onTag}
                onReveal={() => reveal(item.id)}
                onLike={() => like(item)}
                onShare={() => share(refOf(item.target), item.target.title)}
                onAdd={() => add(item.target)}
                onReport={() => setToReport(item.id)}
              />
            ))}
            {hasMore && (
              <button className="dx-more cv-more" onClick={more} disabled={busy}>
                {busy ? <Loading /> : h.loadMore}
              </button>
            )}
          </div>
        )}
      </div>

      <aside className="cv-side">
        <YourDiscussions
          collection={collection}
          works={works}
          listKey={listKey}
          onOpen={onOpen}
          onBrowse={onBrowse}
        />
        <section className="cv-panel cv-pace">
          <div className="cv-pace-head">
            <ShieldCheck size={22} aria-hidden />
            <h2>{h.atYourPace}</h2>
            <Switch on={protection} onChange={toggleProtection} label={h.protection} tone="green" />
          </div>
          <p>{protection ? h.atYourPaceText : h.atYourPaceOff}</p>
        </section>
        {trends.length > 0 && (
          <section className="cv-panel">
            <h2>{h.trends}</h2>
            <p className="cv-panel-hint">{h.trendsHint}</p>
            <div className="cv-trends">
              {trends.map((tr) => (
                <button key={tr.tag} type="button" className="cv-trend" onClick={() => onTag(tr.tag)}>
                  <strong>#{tr.tag}</strong>
                  <span>{h.trendMembers(tr.members)}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        <Discover
          collection={collection}
          works={works}
          listKey={listKey}
          adding={adding}
          onOpen={onOpen}
          onAdd={(p) => add(p.ref, p.item)}
        />
      </aside>

      <button type="button" className="cv-fab" aria-label={h.write} onClick={write}>
        <PencilLine size={22} />
      </button>

      {composing && userId && (
        <ComposeSheet
          userId={userId}
          collection={collection}
          initialText={tag ? `#${tag} ` : ''}
          onClose={() => setComposing(false)}
          onPublished={(item) => {
            setComposing(false);
            setItems((list) => (list ? [item, ...list.filter((x) => x.id !== item.id)] : [item]));
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      )}
      <ReportDialog comment={toReport} onClose={() => setToReport(null)} />
    </div>
  );
}

function FeedPost({
  item,
  shown,
  seen,
  inList,
  adding,
  revealing,
  onOpen,
  onTag,
  onReveal,
  onLike,
  onShare,
  onAdd,
  onReport,
}: {
  item: FeedItem;
  shown: Shown | null;
  seen: boolean | null;
  inList: boolean;
  adding: boolean;
  revealing: boolean;
  onOpen: (ref: TargetRef) => void;
  onTag: (tag: string) => void;
  onReveal: () => void;
  onLike: () => void;
  onShare: () => void;
  onAdd: () => void;
  onReport: () => void;
}) {
  const { t } = useI18n();
  const c = t.community;
  const h = c.hub;
  const target = item.target;
  const ref = refOf(target);
  const reco = item.kind === 'reco';
  const where = [
    target.season !== null ? c.seasonTiny(target.season) : null,
    target.episode !== null ? c.episodeShort(target.episode) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const meta = [t.kinds[target.kind], target.year].filter(Boolean).join(' · ');

  const chip = !reco && (
    <button type="button" className="px-work" onClick={() => onOpen(ref)}>
      <Poster src={target.poster} className="px-work-poster" />
      <span>
        <strong>{target.title}</strong>
        {where && <span> · {where}</span>}
      </span>
    </button>
  );
  const embed = reco && (
    <div className="px-embed">
      <button
        type="button"
        className="px-embed-media"
        onClick={() => onOpen(workOnly(target))}
        aria-label={target.title}
      >
        <Poster
          src={target.backdrop || target.poster}
          className={`px-embed-img${target.backdrop ? '' : ' tall'}`}
        />
      </button>
      <div className="px-embed-body">
        <div className="px-embed-text">
          <button type="button" className="px-embed-title" onClick={() => onOpen(workOnly(target))}>
            {target.title}
          </button>
          <span className="px-embed-meta">
            {meta}
            {item.rating !== null && <span className="px-embed-score"> · ★ {item.rating}/10</span>}
          </span>
        </div>
        {inList ? (
          <span className="px-embed-add done">
            <Check size={15} aria-hidden />
            {h.inList}
          </span>
        ) : (
          <button type="button" className="px-embed-add" onClick={onAdd} disabled={adding}>
            <Plus size={15} aria-hidden />
            {h.addToList}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <PostRow
      post={item}
      context={chip}
      replyCount={item.replyCount}
      onReplies={() => onOpen(ref)}
      onLike={onLike}
      onShare={onShare}
      onReport={onReport}
      menuExtra={
        <DropdownMenuItem onClick={() => onOpen(ref)}>
          <MessageCircle />
          {h.seeDiscussion}
        </DropdownMenuItem>
      }
    >
      {shown === null ? (
        <SpoilerCover
          title={item.spoiler === 'later' ? c.spoilerLater : h.spoilerMasked}
          reason={
            item.spoiler === 'later'
              ? c.veiledLater
              : seen === false
                ? target.episode === null
                  ? h.notFinished
                  : h.notSeenEpisode
                : h.maybeNotSeen
          }
          photoCount={item.photoCount}
          hasVideo={item.hasVideo}
          backdrop={target.backdrop || target.poster}
          busy={revealing}
          onShow={onReveal}
        />
      ) : (
        <>
          {item.spoiler !== 'none' && <span className="dx-spoiler-tag">{h.spoilerTag}</span>}
          {shown.body && <RichText text={shown.body} onTag={onTag} />}
          <PhotoGrid photos={shown.photos} />
          {shown.video && <VideoPlayer video={shown.video} />}
        </>
      )}
      {embed}
    </PostRow>
  );
}

function YourDiscussions({
  collection,
  works,
  listKey,
  onOpen,
  onBrowse,
}: {
  collection: Media[];
  works: WorkKey[];
  listKey: string;
  onOpen: (ref: TargetRef) => void;
  onBrowse: () => void;
}) {
  const { t } = useI18n();
  const c = t.community;
  const h = c.hub;
  const [activity, setActivity] = useState<Map<string, Activity> | null>(null);
  useEffect(() => {
    if (!works.length) return;
    let live = true;
    post<Activity[]>({ op: 'works', works })
      .then((list) => {
        if (!live) return;
        const now = Date.now();
        setActivity(
          new Map(list.map((a) => [keyOf(a), { ...a, fresh: now - Date.parse(a.latestAt) < FRESH }])),
        );
      })
      .catch(() => live && setActivity(new Map()));
    return () => {
      live = false;
    };
    // listKey stands for works.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey]);

  const rows = collection
    .map((m) => ({ m, ref: refFromMedia(m) }))
    .filter((x): x is { m: Media; ref: TargetRef } => !!x.ref)
    .map((x) => ({ ...x, a: activity?.get(keyOf(x.ref)) }));
  const talked = rows
    .filter((x) => x.a)
    .sort((x, y) => Date.parse(y.a!.latestAt) - Date.parse(x.a!.latestAt))
    .slice(0, 5);
  // Nothing said yet about the list: the titles being watched, to start a discussion.
  const shown = talked.length
    ? talked
    : rows
        .filter((x) => x.m.status === 'watching')
        .concat(rows.filter((x) => x.m.status !== 'watching'))
        .slice(0, 3);

  return (
    <section className="cv-panel">
      <h2>{h.yourDiscussions}</h2>
      <p className="cv-panel-hint">{h.yourDiscussionsHint}</p>
      {!rows.length ? (
        <div className="cv-panel-empty">
          <p>{h.mineEmpty}</p>
          <button className="secondary small-btn" onClick={onBrowse}>
            {h.browse}
          </button>
        </div>
      ) : activity === null ? (
        <Loading />
      ) : (
        <div className="cv-rows">
          {shown.map(({ m, ref, a }) => {
            const latest = a?.latest;
            const open: TargetRef =
              latest && latest.episode !== null
                ? { ...ref, season: latest.season, episode: latest.episode }
                : m.kind === 'anime' && m.progress > 0
                  ? { ...ref, episode: m.progress }
                  : ref;
            const where =
              open.episode !== null
                ? [open.season !== null ? c.seasonTiny(open.season) : null, c.episodeShort(open.episode)]
                    .filter(Boolean)
                    .join(' · ')
                : t.kinds[m.kind];
            return (
              <button key={m.id} className="cv-row" onClick={() => onOpen(open)}>
                <Poster src={m.poster} className="cv-row-poster" />
                <span className="cv-row-text">
                  <strong>{m.title}</strong>
                  <span>{a ? `${where} · ${h.messages(a.debriefs)}` : h.startDiscussion}</span>
                </span>
                {a?.fresh ? (
                  <span className="cx-fresh">{h.fresh}</span>
                ) : (
                  <ChevronRight size={18} className="cv-row-arrow" aria-hidden />
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Discover({
  collection,
  works,
  listKey,
  adding,
  onOpen,
  onAdd,
}: {
  collection: Media[];
  works: WorkKey[];
  listKey: string;
  adding: Record<string, boolean>;
  onOpen: (ref: TargetRef) => void;
  onAdd: (p: Pick4) => void;
}) {
  const { t } = useI18n();
  const h = t.community.hub;
  const [picks, setPicks] = useState<Pick4[] | null>(null);
  useEffect(() => {
    let live = true;
    post<(WorkKey & { title: string; poster: string; backdrop: string })[]>({ op: 'discover', works })
      .then(async (list) => {
        if (list.length)
          return list.map((w) => ({ ref: workOnly(w), title: w.title, image: w.backdrop || w.poster }));
        // No recommendations yet: what is airing now, from the catalog.
        const page = await api<{ results: CatalogItem[] }>('/api/catalog?kind=anime&feed=airing');
        return page.results
          .map((item) => ({ item, ref: refFromMedia({ kind: item.kind, catalog: item.catalog }) }))
          .filter(
            (x): x is { item: CatalogItem; ref: TargetRef } => !!x.ref && !inCollection(x.ref, collection),
          )
          .slice(0, 4)
          .map(({ item, ref }) => ({ ref, title: item.title, image: item.backdrop || item.poster, item }));
      })
      .then((list) => live && setPicks(list))
      .catch(() => live && setPicks([]));
    return () => {
      live = false;
    };
    // listKey stands for works and the collection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey]);
  const visible = (picks || []).filter((p) => !inCollection(p.ref, collection));
  if (picks !== null && !visible.length) return null;
  return (
    <section className="cv-panel">
      <h2>{h.discover}</h2>
      {picks === null ? (
        <Loading />
      ) : (
        <div className="cv-discover">
          {visible.map((p) => (
            <div key={keyOf(p.ref)} className="cv-pick">
              <button className="cv-pick-media" onClick={() => onOpen(p.ref)} aria-label={p.title}>
                <Poster src={p.image} className="cv-pick-img" />
              </button>
              <strong>{p.title}</strong>
              <button className="cv-pick-add" onClick={() => onAdd(p)} disabled={!!adding[keyOf(p.ref)]}>
                <Plus size={14} aria-hidden />
                {h.addToList}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
