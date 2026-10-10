'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Flag,
  MessageCircle,
  MoreHorizontal,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { CatalogItem } from '@/lib/catalog';
import {
  inCollection,
  refFromMedia,
  topReactions,
  viewerSeen,
  type FeedItem,
  type Reaction,
  type TargetRef,
} from '@/lib/community';
import type { Media } from '@/lib/watch';
import {
  Avatar,
  Loading,
  Poster,
  ReportDialog,
  SpoilerVeil,
  Switch,
  api,
  post,
  problem,
  useAgo,
} from './community-ui';
import { useI18n } from './i18n-provider';
import RecommendSheet from './recommend-sheet';

type Kind = TargetRef['kind'];
type WorkKey = Pick<TargetRef, 'kind' | 'source' | 'sourceId'>;
type Activity = WorkKey & {
  debriefs: number;
  latestAt: string;
  latest: { season: number | null; episode: number | null };
  /** Set when the answer arrives: a message in the last 48 hours. */
  fresh?: boolean;
};
type Pick4 = { ref: TargetRef; title: string; image: string; item?: CatalogItem };
const FRESH = 48 * 3600 * 1000;
const FILTERS: (Kind | null)[] = [null, 'anime', 'series', 'film', 'manga'];
const keyOf = (r: WorkKey) => `${r.kind}:${r.source}:${r.sourceId}`;
const workOnly = (r: WorkKey): TargetRef => ({ ...r, season: null, episode: null });

/** "Communauté": recommendations and reactions from members, with spoilers kept hidden. */
export default function CommunityView({
  collection,
  signedIn,
  canAdd,
  onOpen,
  onSignIn,
  onBrowse,
  onAdd,
}: {
  collection: Media[];
  signedIn: boolean;
  canAdd: boolean;
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
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [revealing, setRevealing] = useState<Record<string, boolean>>({});
  const [recommending, setRecommending] = useState(false);
  const [adding, setAdding] = useState<Record<string, boolean>>({});
  const [toReport, setToReport] = useState<string | null>(null);

  const seenOf = (item: FeedItem) => viewerSeen(item.target, collection);
  // Spoilers the member has already seen are shown without asking.
  const fetchSeen = (list: FeedItem[]) => {
    const ids = list
      .filter((i) => i.body === null && i.spoiler === 'episode' && seenOf(i) === true)
      .map((i) => i.id)
      .slice(0, 50);
    if (!ids.length) return;
    post<Record<string, string>>({ op: 'bodies', ids })
      .then((found) => setBodies((b) => ({ ...b, ...found })))
      .catch(() => {});
  };
  const load = (offset: number) =>
    post<{ items: FeedItem[]; hasMore: boolean; spoilerProtection: boolean }>({
      op: 'feed',
      kind,
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
        fetchSeen(data.items);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // listKey stands for works.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, listKey, reload, signedIn]);

  if (!signedIn)
    return (
      <div className="cv">
        <div className="cv-main">
          <PageHead />
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
      fetchSeen(data.items);
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
      setReload((n) => n + 1);
    } catch (e) {
      setProtection(!on);
      toast.error(problem(e, t.community.actionFailed));
    }
  };

  const reveal = async (id: string) => {
    setRevealing((r) => ({ ...r, [id]: true }));
    try {
      const found = await post<Record<string, string>>({ op: 'bodies', ids: [id] });
      setBodies((b) => ({ ...b, ...found }));
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

  return (
    <div className="cv">
      <div className="cv-main">
        <PageHead onRecommend={() => setRecommending(true)} />
        <div className="dx-strip cv-chips" role="group" aria-label={h.filters}>
          {FILTERS.map((k) => (
            <button
              key={k ?? 'all'}
              className={`dx-chip${kind === k ? ' on' : ''}`}
              aria-pressed={kind === k}
              onClick={() => {
                if (kind === k) return;
                setItems(null);
                setKind(k);
              }}
            >
              {k ? t.kindsPlural[k] : h.forYou}
            </button>
          ))}
        </div>
        <div className="cv-protect">
          <ShieldCheck size={18} aria-hidden />
          <span>
            <strong>{h.protection}</strong> <span>· {protection ? h.protectionHint : h.protectionOff}</span>
          </span>
          <Switch on={protection} onChange={toggleProtection} label={h.protection} tone="green" />
        </div>
        <button className="cv-share" onClick={() => setRecommending(true)}>
          <span className="cv-share-text">{h.shareReco}</span>
          <span className="cv-share-plus" aria-hidden>
            <Plus size={20} strokeWidth={2.4} />
          </span>
        </button>

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
            <p>{kind ? h.emptyKind : h.empty}</p>
          </section>
        ) : (
          <div className="cv-feed">
            {items.map((item) => (
              <FeedCard
                key={item.id}
                item={item}
                body={item.body ?? bodies[item.id] ?? null}
                seen={seenOf(item)}
                inList={inCollection(item.target, collection)}
                adding={!!adding[keyOf(item.target)]}
                revealing={!!revealing[item.id]}
                onOpen={onOpen}
                onReveal={() => reveal(item.id)}
                onLike={() => like(item)}
                onAdd={() => add(item.target)}
                onReport={() => setToReport(item.id)}
              />
            ))}
            {hasMore && (
              <button className="dx-more" onClick={more} disabled={busy}>
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
            <ShieldCheck size={24} aria-hidden />
            <h2>{h.atYourPace}</h2>
          </div>
          <p>{protection ? h.atYourPaceText : h.atYourPaceOff}</p>
          <div className="cv-pace-row">
            <span>{h.protection}</span>
            <Switch on={protection} onChange={toggleProtection} label={h.protection} tone="green" />
          </div>
        </section>
        <Discover
          collection={collection}
          works={works}
          listKey={listKey}
          adding={adding}
          onOpen={onOpen}
          onAdd={(p) => add(p.ref, p.item)}
        />
      </aside>

      {recommending && (
        <RecommendSheet
          collection={collection}
          onClose={() => setRecommending(false)}
          onPublished={(item) => {
            setRecommending(false);
            setItems((list) => (list ? [item, ...list.filter((x) => x.id !== item.id)] : [item]));
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      )}
      <ReportDialog comment={toReport} onClose={() => setToReport(null)} />
    </div>
  );
}

function PageHead({ onRecommend }: { onRecommend?: () => void }) {
  const { t } = useI18n();
  const h = t.community.hub;
  return (
    <header className="cv-head">
      <div>
        <h1>{h.title}</h1>
        <p>{h.subtitle}</p>
      </div>
      {onRecommend && (
        <button className="primary cv-reco-btn" onClick={onRecommend}>
          <Plus size={18} />
          {h.recommend}
        </button>
      )}
    </header>
  );
}

function FeedCard({
  item,
  body,
  seen,
  inList,
  adding,
  revealing,
  onOpen,
  onReveal,
  onLike,
  onAdd,
  onReport,
}: {
  item: FeedItem;
  body: string | null;
  seen: boolean | null;
  inList: boolean;
  adding: boolean;
  revealing: boolean;
  onOpen: (ref: TargetRef) => void;
  onReveal: () => void;
  onLike: () => void;
  onAdd: () => void;
  onReport: () => void;
}) {
  const { t } = useI18n();
  const c = t.community;
  const h = c.hub;
  const ago = useAgo();
  const target = item.target;
  const ref: TargetRef = {
    kind: target.kind,
    source: target.source,
    sourceId: target.sourceId,
    season: target.season,
    episode: target.episode,
  };
  const work = workOnly(target);
  const reco = item.kind === 'reco';
  const where = [
    target.title,
    target.season !== null ? c.seasonTiny(target.season) : null,
    target.episode !== null ? c.episodeShort(target.episode) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const meta = [t.kinds[target.kind], target.year].filter(Boolean).join(' · ');
  const { emojis, total } = topReactions(item.reactions);
  const veil =
    body === null ? (
      <SpoilerVeil
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
        action={h.show}
        busy={revealing}
        onShow={onReveal}
      />
    ) : null;
  const text =
    body !== null ? (
      <>
        {item.spoiler !== 'none' && <span className="dx-spoiler-tag">{h.spoilerTag}</span>}
        <p className={`cv-text${reco ? ' quote' : ''}`}>{reco ? `« ${body} »` : body}</p>
      </>
    ) : null;

  return (
    <article className={`cv-card${reco ? ' reco' : ''}`}>
      <header className="cv-card-head">
        <Avatar name={item.username} />
        <div className="cv-who">
          <span>
            <strong>{item.username ?? c.deletedAccount}</strong>
            {!reco && (
              <span className="cv-did"> · {target.episode !== null ? h.justWatched : h.talksAbout}</span>
            )}
          </span>
          <span className="cv-time">{ago(item.createdAt)}</span>
        </div>
        {reco ? (
          <span className="cv-tag">{h.recommends}</span>
        ) : (
          item.rating !== null && (
            <span
              className="dx-badge"
              title={c.authorVerdict(item.rating)}
              aria-label={c.authorVerdict(item.rating)}
            >
              {item.rating}
            </span>
          )
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="dx-icon" aria-label={c.actions}>
              <MoreHorizontal size={18} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onOpen(ref)}>
              <MessageCircle />
              {h.seeDiscussion}
            </DropdownMenuItem>
            {!item.mine && (
              <DropdownMenuItem onClick={onReport}>
                <Flag />
                {c.report}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {reco ? (
        <div className="cv-reco">
          <button
            className="cv-reco-media"
            onClick={() => onOpen(work)}
            aria-label={`${target.title} · ${c.discussion}`}
          >
            <Poster
              src={target.backdrop || target.poster}
              className={`cv-reco-img${target.backdrop ? '' : ' tall'}`}
            />
          </button>
          <div className="cv-reco-text">
            <div className="cv-reco-title">
              <button className="cv-title-link" onClick={() => onOpen(work)}>
                {target.title}
              </button>
              {item.rating !== null && <span className="cv-stars">★ {item.rating}/10</span>}
            </div>
            {meta && <span className="cv-meta">{meta}</span>}
            {veil ?? text}
            {inList ? (
              <span className="cv-add done">
                <Check size={16} aria-hidden />
                {h.inList}
              </span>
            ) : (
              <button className="cv-add" onClick={onAdd} disabled={adding}>
                <Plus size={16} aria-hidden />
                <span className="cv-add-short">{h.addToList}</span>
                <span className="cv-add-long">{h.addToListLong}</span>
              </button>
            )}
          </div>
        </div>
      ) : body === null ? (
        <div className={`cv-ep${target.backdrop ? ' has-wide' : ''}`}>
          <button className="cv-ep-media" onClick={() => onOpen(ref)} aria-label={where}>
            <Poster src={target.poster} className="cv-ep-tall" />
            {target.backdrop && <Poster src={target.backdrop} className="cv-ep-wide" />}
          </button>
          <div className="cv-ep-text">
            <button className="cv-where" onClick={() => onOpen(ref)}>
              {where}
            </button>
            {veil}
          </div>
        </div>
      ) : (
        <div className="cv-plain">
          <button className="cv-where" onClick={() => onOpen(ref)}>
            {where}
          </button>
          {text}
        </div>
      )}

      <footer className="cv-foot">
        <button
          className={`dx-like${item.myReaction ? ' mine' : ''}`}
          aria-pressed={item.myReaction === 'heart'}
          aria-label={`${h.like}, ${h.reactionsAria(total)}`}
          onClick={onLike}
        >
          <span aria-hidden>{emojis.length ? emojis.join('') : '❤️'}</span>
          {total > 0 && total}
        </button>
        <button
          className="dx-foot-btn"
          onClick={() => onOpen(ref)}
          aria-label={h.repliesAria(item.replyCount)}
        >
          <span aria-hidden>💬</span>
          {item.replyCount}
        </button>
        {!reco && (
          <button className="cv-open" onClick={() => onOpen(ref)}>
            {h.seeDiscussion}
            <ArrowRight size={15} aria-hidden />
          </button>
        )}
      </footer>
    </article>
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
