'use client';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, EyeOff, LoaderCircle, MessageCircle } from 'lucide-react';
import { REACTIONS, refFromMedia, type Debrief, type TargetRef } from '@/lib/community';
import type { Media } from '@/lib/watch';
import { Avatar, Poster, useAgo } from './discussion-view';
import { useI18n } from './i18n-provider';

type Activity = {
  kind: TargetRef['kind'];
  source: TargetRef['source'];
  sourceId: string;
  debriefs: number;
  latestAt: string;
  /** Set when the answer arrives: a débrief in the last 48 hours. */
  fresh?: boolean;
};
type RecentItem = Omit<Debrief, 'body' | 'mine' | 'myReaction' | 'parentId'> & {
  body: string | null;
  replyCount: number;
  target: TargetRef & { title: string; poster: string };
};
type Kind = TargetRef['kind'];
const FRESH = 48 * 3600 * 1000;
const keyOf = (r: Pick<TargetRef, 'kind' | 'source' | 'sourceId'>) => `${r.kind}:${r.source}:${r.sourceId}`;

/** "Communauté": the discussions of the titles in your list, and what members are saying right now. */
export default function CommunityView({
  collection,
  signedIn,
  onOpen,
  onSignIn,
  onBrowse,
}: {
  collection: Media[];
  signedIn: boolean;
  onOpen: (ref: TargetRef) => void;
  onSignIn: () => void;
  onBrowse: () => void;
}) {
  const { t } = useI18n();
  const h = t.community.hub;
  const mine = useMemo(() => collection.filter((m) => refFromMedia(m)), [collection]);
  const [tab, setTab] = useState<'mine' | 'recent'>(mine.length ? 'mine' : 'recent');
  if (!signedIn)
    return (
      <section className="panel dx-blocked">
        <p>{h.signIn}</p>
        <button className="primary" onClick={onSignIn}>
          {t.nav.signIn}
        </button>
      </section>
    );
  return (
    <div className="cx">
      <div className="cx-tabs" role="tablist" aria-label={t.shell.community}>
        {(['mine', 'recent'] as const).map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'on' : ''}
            onClick={() => setTab(id)}
          >
            {id === 'mine' ? h.tabMine : h.tabRecent}
          </button>
        ))}
      </div>
      {tab === 'mine' ? (
        <MyDiscussions works={mine} onOpen={onOpen} onBrowse={onBrowse} />
      ) : (
        <RightNow onOpen={onOpen} />
      )}
    </div>
  );
}

function MyDiscussions({
  works,
  onOpen,
  onBrowse,
}: {
  works: Media[];
  onOpen: (ref: TargetRef) => void;
  onBrowse: () => void;
}) {
  const { t } = useI18n();
  const h = t.community.hub;
  const ago = useAgo();
  const [activity, setActivity] = useState<Map<string, Activity> | null>(null);
  const [failed, setFailed] = useState(false);
  const refs = useMemo(() => works.map((m) => refFromMedia(m)!), [works]);
  const listKey = refs.map(keyOf).join('|');

  useEffect(() => {
    if (!refs.length) return;
    let live = true;
    fetch('/api/community', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        op: 'works',
        works: refs.slice(0, 300).map(({ kind, source, sourceId }) => ({ kind, source, sourceId })),
      }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((list: Activity[]) => {
        if (!live) return;
        const now = Date.now();
        setActivity(
          new Map(list.map((a) => [keyOf(a), { ...a, fresh: now - Date.parse(a.latestAt) < FRESH }])),
        );
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // listKey stands for refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey]);

  if (!works.length)
    return (
      <section className="cx-empty">
        <MessageCircle size={28} aria-hidden />
        <p>{h.mineEmpty}</p>
        <button className="primary" onClick={onBrowse}>
          {h.browse}
        </button>
      </section>
    );

  const rows = works
    .map((m) => ({ m, ref: refFromMedia(m)!, a: activity?.get(keyOf(refFromMedia(m)!)) }))
    .sort(
      (x, y) =>
        (y.a ? Date.parse(y.a.latestAt) : 0) - (x.a ? Date.parse(x.a.latestAt) : 0) ||
        Number(y.m.status === 'watching') - Number(x.m.status === 'watching') ||
        Number(y.m.priority) - Number(x.m.priority) ||
        x.m.title.localeCompare(y.m.title),
    );
  return (
    <div className="cx-list">
      {failed && <p className="notice danger">{h.loadFailed}</p>}
      {rows.map(({ m, ref, a }) => {
        // Anime open on the last watched episode; everything else on the whole work.
        const target = m.kind === 'anime' && m.progress > 0 ? { ...ref, episode: m.progress } : ref;
        const fresh = a?.fresh;
        return (
          <button key={m.id} className="cx-work" onClick={() => onOpen(target)}>
            <Poster src={m.poster} className="cx-work-poster" />
            <span className="cx-work-text">
              <strong>{m.title}</strong>
              <span className="cx-work-meta">
                {t.kinds[m.kind]}
                {target.episode !== null ? ` · ${t.community.episodeShort(target.episode)}` : ''}
              </span>
              <span className={`cx-work-activity${a ? '' : ' quiet'}`}>
                {activity === null && !failed ? (
                  <LoaderCircle size={13} className="loading-icon" />
                ) : a ? (
                  h.activity(a.debriefs, ago(a.latestAt))
                ) : (
                  h.noActivity
                )}
              </span>
            </span>
            {fresh && <span className="cx-fresh">{h.fresh}</span>}
            <ArrowRight size={18} className="cx-work-arrow" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

function RightNow({ onOpen }: { onOpen: (ref: TargetRef) => void }) {
  const { t } = useI18n();
  const h = t.community.hub;
  const c = t.community;
  const ago = useAgo();
  const [kind, setKind] = useState<Kind | null>(null);
  const [items, setItems] = useState<RecentItem[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = async (offset: number) => {
    const params = new URLSearchParams({ op: 'recent', offset: String(offset), ...(kind ? { kind } : {}) });
    const r = await fetch(`/api/community?${params}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('failed');
    return (await r.json()) as { items: RecentItem[]; hasMore: boolean };
  };
  useEffect(() => {
    let live = true;
    load(0)
      .then((data) => {
        if (!live) return;
        setItems(data.items);
        setHasMore(data.hasMore);
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  const more = async () => {
    if (!items || busy) return;
    setBusy(true);
    try {
      const data = await load(items.length);
      setItems([...items, ...data.items.filter((n) => !items.some((x) => x.id === n.id))]);
      setHasMore(data.hasMore);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const filters: (Kind | null)[] = [null, 'anime', 'series', 'film', 'manga'];
  const where = (r: RecentItem['target']) =>
    r.episode === null
      ? r.title
      : `${r.title} · ${r.season !== null ? `${c.seasonShort(r.season)} · ` : ''}${c.episodeShort(r.episode)}`;

  return (
    <>
      <div className="dx-strip cx-filters" role="group">
        {filters.map((k) => (
          <button
            key={k ?? 'all'}
            className={`dx-chip${kind === k ? ' on' : ''}`}
            aria-pressed={kind === k}
            onClick={() => {
              setItems(null);
              setKind(k);
            }}
          >
            {k ? t.kindsPlural[k] : h.all}
          </button>
        ))}
      </div>
      {failed && !items ? (
        <p className="notice danger">{h.loadFailed}</p>
      ) : !items ? (
        <p className="inline-note dx-loading" role="status">
          <LoaderCircle size={16} className="loading-icon" />
        </p>
      ) : items.length === 0 ? (
        <section className="cx-empty">
          <MessageCircle size={28} aria-hidden />
          <p>{h.recentEmpty}</p>
        </section>
      ) : (
        <div className="cx-list">
          {items.map((d) => {
            const ref: TargetRef = {
              kind: d.target.kind,
              source: d.target.source,
              sourceId: d.target.sourceId,
              season: d.target.season,
              episode: d.target.episode,
            };
            const top = REACTIONS.filter((r) => d.reactions[r.key])
              .sort((a, b) => (d.reactions[b.key] || 0) - (d.reactions[a.key] || 0))
              .slice(0, 3);
            return (
              <article key={d.id} className="dx-debrief cx-item">
                <button className="cx-item-where" onClick={() => onOpen(ref)}>
                  <Poster src={d.target.poster} className="cx-item-poster" />
                  <span>{where(d.target)}</span>
                </button>
                <header className="dx-debrief-head">
                  <Avatar name={d.username} small />
                  <div className="dx-who">
                    <strong>{d.username ?? c.deletedAccount}</strong>
                    <span>{ago(d.createdAt)}</span>
                  </div>
                  {d.rating !== null && (
                    <span
                      className="dx-badge"
                      aria-label={c.authorVerdict(d.rating)}
                      title={c.authorVerdict(d.rating)}
                    >
                      {d.rating}
                    </span>
                  )}
                </header>
                {d.body === null ? (
                  <p className="cx-spoiler">
                    <EyeOff size={16} aria-hidden />
                    {d.spoiler === 'later' ? c.spoilerLater : h.spoilerHidden}
                  </p>
                ) : (
                  <p className="dx-body cx-clamp">{d.body}</p>
                )}
                <footer className="cx-item-foot">
                  {top.map((r) => (
                    <span key={r.key} className="cx-count">
                      <span aria-hidden>{r.emoji}</span> {d.reactions[r.key]}
                    </span>
                  ))}
                  {d.replyCount > 0 && <span className="cx-count">{c.replies(d.replyCount)}</span>}
                  <button className="dx-link accent cx-open" onClick={() => onOpen(ref)}>
                    {h.open}
                    <ArrowRight size={15} aria-hidden />
                  </button>
                </footer>
              </article>
            );
          })}
          {hasMore && (
            <button className="dx-more" onClick={more} disabled={busy}>
              {busy ? <LoaderCircle size={16} className="loading-icon" /> : h.loadMore}
            </button>
          )}
        </div>
      )}
    </>
  );
}
