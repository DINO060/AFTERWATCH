'use client';
import { useEffect, useState } from 'react';
import { Ban, Check, LoaderCircle, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Photo, Spoiler, TargetRef } from '@/lib/community';
import { useI18n } from './i18n-provider';
import { PhotoGrid } from './post-ui';

type Item = {
  commentId: string;
  body: string;
  photos?: Photo[];
  spoiler: Spoiler;
  createdAt: string;
  author: string | null;
  authorBanned: boolean;
  target: {
    kind: TargetRef['kind'];
    source: TargetRef['source'];
    sourceId: string;
    season: number | null;
    episode: number | null;
    title: string;
    poster: string;
  };
  reports: number;
  reasons: Record<string, number>;
  details: string[];
};

/** Reported débriefs, oldest first: remove, dismiss, or remove and block the author. */
export default function ModerationView({ onOpen }: { onOpen: (ref: TargetRef) => void }) {
  const { t, locale } = useI18n();
  const c = t.community;
  const [queue, setQueue] = useState<Item[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/community?op=moderation', { cache: 'no-store' })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(r.status === 403 ? c.notModerator : data.error || c.loadFailed);
        return data.queue as Item[];
      })
      .then((items) => live && setQueue(items))
      .catch((e) => live && setError(e instanceof Error ? e.message : c.loadFailed));
    return () => {
      live = false;
    };
    // The texts only matter for the first error message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolve = async (item: Item, action: 'remove' | 'dismiss', ban: boolean) => {
    if (busy) return;
    setBusy(item.commentId);
    try {
      const r = await fetch('/api/community', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'resolve', comment: item.commentId, action, ban }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || c.actionFailed);
      setQueue((q) => (q ? q.filter((x) => x.commentId !== item.commentId) : q));
      toast.success(c.moderationDone);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : c.actionFailed);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="dx-moderation">
      <header className="dx-moderation-head">
        <h1>
          <ShieldCheck size={22} />
          {c.moderation}
        </h1>
        <p>{c.moderationIntro}</p>
      </header>
      {error ? (
        <p className="notice danger" role="alert">
          {error}
        </p>
      ) : !queue ? (
        <p className="inline-note" role="status">
          <LoaderCircle size={16} className="loading-icon" />
        </p>
      ) : queue.length === 0 ? (
        <p className="dx-empty-queue">
          <Check size={18} />
          {c.queueEmpty}
        </p>
      ) : (
        <div className="dx-queue">
          {queue.map((item) => {
            const ref: TargetRef = {
              kind: item.target.kind,
              source: item.target.source,
              sourceId: item.target.sourceId,
              season: item.target.season,
              episode: item.target.episode,
            };
            const where =
              item.target.episode === null
                ? item.target.title
                : `${item.target.title} · ${item.target.season !== null ? `${c.seasonShort(item.target.season)} · ` : ''}${c.episodeShort(item.target.episode)}`;
            return (
              <article key={item.commentId} className="dx-card dx-case">
                <div className="dx-case-head">
                  <div>
                    <strong>{where}</strong>
                    <span>
                      @{item.author ?? c.deletedAccount} ·{' '}
                      {new Date(item.createdAt).toLocaleString(locale, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                      {item.authorBanned ? ` · ${c.authorBanned}` : ''}
                    </span>
                  </div>
                  <span className="dx-case-count">{c.reportsCount(item.reports)}</span>
                </div>
                <div className="dx-case-reasons">
                  {Object.entries(item.reasons).map(([reason, n]) => (
                    <span key={reason}>
                      {c.reasons[reason as keyof typeof c.reasons] ?? reason} · {n}
                    </span>
                  ))}
                </div>
                {item.spoiler !== 'none' && (
                  <span className="dx-spoiler-tag">
                    {item.spoiler === 'later'
                      ? c.spoilerLater
                      : c.spoilerOf(
                          item.target.episode === null
                            ? c.theWork
                            : item.target.season !== null
                              ? c.theSeriesEpisode(item.target.season, item.target.episode)
                              : c.theEpisode(item.target.episode),
                        )}
                  </span>
                )}
                <p className="dx-body">{item.body || (item.photos?.length ? '' : c.deleted)}</p>
                <PhotoGrid photos={item.photos ?? []} />
                {item.details.length > 0 && (
                  <ul className="dx-case-details">
                    {item.details.map((d, i) => (
                      <li key={i}>« {d} »</li>
                    ))}
                  </ul>
                )}
                <div className="dx-case-actions">
                  <button
                    className="danger-solid"
                    disabled={busy === item.commentId}
                    onClick={() => resolve(item, 'remove', false)}
                  >
                    <Trash2 size={16} />
                    {c.moderationRemove}
                  </button>
                  <button
                    className="secondary danger-btn"
                    disabled={busy === item.commentId || item.authorBanned || !item.author}
                    onClick={() => resolve(item, 'remove', true)}
                  >
                    <Ban size={16} />
                    {c.moderationBan}
                  </button>
                  <button
                    className="secondary"
                    disabled={busy === item.commentId}
                    onClick={() => resolve(item, 'dismiss', false)}
                  >
                    {c.moderationDismiss}
                  </button>
                  <button className="dx-link" onClick={() => onOpen(ref)}>
                    {c.viewDiscussion}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
