'use client';
import { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  CalendarX,
  Check,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import type { Op } from '@/lib/assistant/ops';
import type { LocalWhen, StatusCard } from '@/lib/assistant/cards';
import type { Media, Session, WatchState } from '@/lib/watch';
import { useI18n } from './i18n-provider';

type Message = {
  role: 'user' | 'model';
  text: string;
  ops?: Op[];
  cards?: StatusCard[];
  outcome?: 'applied' | 'dismissed';
};
const DAYS_SHOWN = 3;

/** Gemini sometimes answers in markdown: keep the words, drop the markup. */
const plain = (text: string) =>
  text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ');
const range = (from: number, to: number) => (to > from ? `${from}–${to}` : String(from));

/** The member reads the conversation again after switching screens, not after closing the tab. */
function useStoredMessages(userId: string) {
  const key = `aw_assistant_${userId}`;
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || '[]');
      return Array.isArray(saved) ? saved.slice(-30) : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(messages.slice(-30)));
    } catch {}
  }, [key, messages]);
  return [messages, setMessages] as const;
}

function Poster({ src, title, className }: { src: string; title: string; className: string }) {
  const [broken, setBroken] = useState(false);
  return src && !broken ? (
    <img
      className={className}
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  ) : (
    <span className={`${className} ai-poster-fallback`} aria-hidden>
      {title.slice(0, 2).toUpperCase()}
    </span>
  );
}

export default function AssistantView({
  userId,
  aiReady,
  state,
  canApply,
  onApply,
  onPlanning,
  onSignIn,
}: {
  userId: string | null;
  aiReady: boolean;
  state: WatchState;
  canApply: boolean;
  onApply: (ops: Op[]) => Promise<boolean>;
  onPlanning: () => void;
  onSignIn: () => void;
}) {
  const { t } = useI18n();
  if (!userId)
    return (
      <section className="panel ai-panel ai-blocked">
        <p>{t.assistant.signIn}</p>
        <button className="primary" onClick={onSignIn}>
          {t.nav.signIn}
        </button>
      </section>
    );
  if (!aiReady)
    return (
      <section className="panel ai-panel ai-blocked">
        <p>{t.assistant.off}</p>
        <p className="form-hint">{t.assistant.withoutAi}</p>
        <button className="secondary" onClick={onPlanning}>
          <CalendarDays size={16} />
          {t.assistant.autoPlanning}
        </button>
      </section>
    );
  return <Chat userId={userId} state={state} canApply={canApply} onApply={onApply} />;
}

function Chat({
  userId,
  state,
  canApply,
  onApply,
}: {
  userId: string;
  state: WatchState;
  canApply: boolean;
  onApply: (ops: Op[]) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [messages, setMessages] = useStoredMessages(userId);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [failed, setFailed] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const threadEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    threadEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  const ask = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr('');
    setFailed('');
    // The model also learns what became of its earlier proposals.
    const history = messages.slice(-10).map((m) => ({
      role: m.role,
      text: (m.ops?.length
        ? `${m.text}\n[${
            m.outcome === 'applied'
              ? 'The member applied these changes.'
              : m.outcome === 'dismissed'
                ? 'The member dismissed these changes.'
                : 'These changes are still waiting for the member.'
          }]`
        : m.text
      ).slice(0, 6000),
    }));
    try {
      const r = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history, expectedUserId: userId }),
      });
      const data: any = await r.json();
      if (!r.ok) throw new Error(data.error || t.assistant.unavailable);
      setMessages((m) => [
        ...m,
        { role: 'user', text },
        {
          role: 'model',
          text: plain(String(data.text || '')),
          ops: data.ops?.length ? data.ops : undefined,
          cards: data.cards?.length ? data.cards : undefined,
        },
      ]);
      if (typeof data.remaining === 'number') setRemaining(data.remaining);
      setQuestion('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.assistant.unavailable);
      setFailed(text);
    } finally {
      setBusy(false);
    }
  };
  const settle = async (index: number, apply: boolean) => {
    const ops = messages[index]?.ops;
    if (!ops) return;
    if (apply) {
      setApplying(index);
      const ok = await onApply(ops);
      setApplying(null);
      if (!ok) return;
    }
    setMessages((all) =>
      all.map((m, i) => (i === index ? { ...m, outcome: apply ? 'applied' : 'dismissed' } : m)),
    );
  };

  return (
    <section className="panel ai-panel">
      <header className="ai-head">
        <div className="ai-id">
          <span className="ai-logo" aria-hidden>
            A
          </span>
          <div>
            <h2>{t.assistant.label}</h2>
            {remaining !== null && <p>{t.assistant.remaining(remaining)}</p>}
          </div>
        </div>
        {messages.length > 0 && (
          <button
            className="ai-icon-btn"
            aria-label={t.assistant.newChat}
            title={t.assistant.newChat}
            disabled={busy}
            onClick={() => setMessages([])}
          >
            <RotateCcw size={18} />
          </button>
        )}
      </header>

      <div className="ai-thread" aria-live="polite">
        {!messages.length && (
          <div className="ai-intro">
            <h2>{t.assistant.introTitle}</h2>
            <p>{t.assistant.intro(state.settings.budget)}</p>
            <p className="form-hint">
              {t.assistant.disclaimer} {t.assistant.data}
            </p>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div className="ai-user" key={i}>
              {m.text}
            </div>
          ) : (
            <div className="ai-reply" key={i}>
              <span className="ai-avatar" aria-hidden>
                A
              </span>
              <div className="ai-reply-body">
                {m.cards && <StatusCards cards={m.cards} />}
                {m.text && <div className="ai-text">{m.text}</div>}
                {m.ops && (
                  <Proposal
                    ops={m.ops}
                    state={state}
                    outcome={m.outcome}
                    busy={applying === i}
                    disabled={!canApply || applying !== null}
                    onApply={() => settle(i, true)}
                    onDismiss={() => settle(i, false)}
                  />
                )}
              </div>
            </div>
          ),
        )}
        {busy && (
          <div className="ai-reply" role="status">
            <span className="ai-avatar" aria-hidden>
              A
            </span>
            <p className="ai-thinking">
              <LoaderCircle size={16} className="loading-icon" />
              {t.assistant.thinking}
            </p>
          </div>
        )}
        <div ref={threadEnd} />
      </div>

      {err && (
        <div className="notice danger ai-error" role="alert">
          {err}
          {failed && (
            <button className="ghost-btn small-btn" disabled={busy} onClick={() => ask(failed)}>
              {t.common.retry}
            </button>
          )}
        </div>
      )}
      <div className="ai-prompts">
        {t.assistant.prompts.map((prompt) => (
          <button key={prompt.label} disabled={busy} onClick={() => ask(prompt.text)}>
            {prompt.label}
          </button>
        ))}
      </div>
      <form
        className="ai-input"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t.assistant.placeholder}
          aria-label={t.assistant.messageAria}
          maxLength={2500}
          rows={1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask(question);
            }
          }}
        />
        <button className="ai-send" aria-label={t.assistant.sendAria} disabled={busy || !question.trim()}>
          <Send size={19} />
        </button>
      </form>
    </section>
  );
}

function useWhen() {
  const { locale } = useI18n();
  return (when: LocalWhen) =>
    new Date(when.date + 'T12:00:00').toLocaleDateString(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
}

function StatusCards({ cards }: { cards: StatusCard[] }) {
  const { t } = useI18n();
  const when = useWhen();
  const words = t.assistant.releaseStatus as Record<string, string>;
  // A long list scrolls inside the card instead of stretching the conversation.
  const long = cards.length > 4;
  return (
    <section className="ai-card" aria-label={t.assistant.whereYouAre}>
      <div className="ai-card-head">
        <h3>{t.assistant.whereYouAre}</h3>
        {long && <span>{t.assistant.titleCount(cards.length)}</span>}
      </div>
      <ul
        className={`ai-status-list${long ? ' ai-scroll' : ''}`}
        tabIndex={long ? 0 : undefined}
        aria-label={long ? t.assistant.whereYouAre : undefined}
      >
        {cards.map((c) => {
          const unit = t.units[c.kind];
          const base = c.total ?? c.released;
          const done = c.progress !== undefined && base ? Math.min(100, (c.progress / base) * 100) : null;
          const status = c.status === 'between seasons' ? 'between' : c.status;
          const parts = [
            c.left !== undefined
              ? c.left > 0
                ? t.assistant.left(c.left, unit)
                : t.assistant.upToDate
              : c.released
                ? t.assistant.out(c.released, unit)
                : '',
            c.next ? t.assistant.nextOn(when(c.next)) : status !== 'unknown' ? words[status] || status : '',
            c.finale && status !== 'finished' ? t.assistant.endsOn(when(c.finale), c.finale.estimated) : '',
          ].filter(Boolean);
          return (
            <li key={c.key}>
              <Poster src={c.poster} title={c.title} className="ai-poster" />
              <div className="ai-status-body">
                <div className="ai-status-top">
                  <strong>{c.title}</strong>
                  {done !== null && (
                    <span>
                      {c.progress} / {base}
                    </span>
                  )}
                </div>
                {done !== null && (
                  <div className="ai-bar" aria-hidden>
                    <span style={{ width: `${done}%` }} />
                  </div>
                )}
                <p>{parts.join(' · ')}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type Line = { icon: typeof Plus; text: string; poster?: Media; tone?: 'add' | 'remove' };

function Proposal({
  ops,
  state,
  outcome,
  busy,
  disabled,
  onApply,
  onDismiss,
}: {
  ops: Op[];
  state: WatchState;
  outcome?: 'applied' | 'dismissed';
  busy: boolean;
  disabled: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const { t, locale } = useI18n();
  const [allDays, setAllDays] = useState(false);
  const known = new Map<string, Media>(state.media.map((m) => [m.id, m]));
  for (const op of ops) if (op.op === 'add') known.set(op.media.id, op.media);

  const sessions: Session[] = ops
    .flatMap((op) => (op.op === 'addSessions' ? op.sessions : []))
    .filter((s) => known.has(s.mediaId))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const days = [...new Set(sessions.map((s) => s.date))];
  const shownDays = allDays ? days : days.slice(0, DAYS_SHOWN);

  const lines: Line[] = [];
  const updates = new Map<string, string[]>();
  for (const op of ops) {
    if (op.op === 'add')
      lines.push({ icon: Plus, text: t.assistant.addTitle(op.media.title), poster: op.media, tone: 'add' });
    else if (op.op === 'remove')
      lines.push({ icon: Trash2, text: t.assistant.removeTitle(op.title), tone: 'remove' });
    else if (op.op === 'removeSessions')
      lines.push({ icon: CalendarX, text: t.assistant.removeSessions(op.ids.length), tone: 'remove' });
    else if (op.op === 'update') {
      const { progress, status, priority } = op.patch;
      const details = [
        progress !== undefined ? t.assistant.progressTo(progress) : '',
        status ? t.statuses[status] : '',
        priority !== undefined ? (priority ? t.assistant.priorityOn : t.assistant.priorityOff) : '',
      ]
        .filter(Boolean)
        .join(', ');
      // Titles getting the same change share one line.
      updates.set(details, [...(updates.get(details) || []), op.title]);
    }
  }
  for (const [details, titles] of updates)
    lines.push({ icon: Pencil, text: t.assistant.updateTitle(titles.join(', '), details) });
  const count = sessions.length
    ? t.assistant.sessionCount(sessions.length)
    : t.assistant.changeCount(lines.length);

  return (
    <section className={`ai-card ai-proposal ${outcome || ''}`} aria-label={t.assistant.proposalTitle}>
      <div className="ai-card-head">
        <h3>{sessions.length ? t.assistant.weekToConfirm : t.assistant.toConfirm}</h3>
        <span>{count}</span>
      </div>
      {shownDays.length > 0 && (
        <div className="ai-week">
          <div
            className={`ai-week-days${allDays && days.length > 7 ? ' ai-scroll' : ''}`}
            tabIndex={allDays && days.length > 7 ? 0 : undefined}
          >
            {shownDays.map((date) => (
              <div className="ai-day" key={date}>
                <span className="ai-day-label">
                  {`${new Date(date + 'T12:00:00').toLocaleDateString(locale, { weekday: 'short' })} ${Number(date.slice(8))}`}
                </span>
                <div className="ai-day-chips">
                  {sessions
                    .filter((s) => s.date === date)
                    .map((s) => {
                      const m = known.get(s.mediaId)!;
                      return (
                        <span className="ai-chip" key={s.id} title={m.title}>
                          <Poster src={m.poster} title={m.title} className="ai-chip-poster" />
                          <span className="sr-only">{m.title}</span>
                          {s.time} · {m.kind === 'film' ? t.units.film : range(s.from, s.to)}
                        </span>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
          {days.length > DAYS_SHOWN && (
            <button className="ai-link" onClick={() => setAllDays(!allDays)}>
              {allDays ? t.assistant.fewerDays : t.assistant.allDays(days.length)}
            </button>
          )}
        </div>
      )}
      {lines.length > 0 && (
        <ul className="ai-changes">
          {lines.map((line, i) => (
            <li key={i} className={line.tone}>
              {line.poster ? (
                <Poster src={line.poster.poster} title={line.poster.title} className="ai-chip-poster" />
              ) : (
                <line.icon size={15} aria-hidden />
              )}
              <span>{line.text}</span>
            </li>
          ))}
        </ul>
      )}
      {outcome ? (
        <p className="ai-outcome">
          {outcome === 'applied' ? <Check size={15} /> : <X size={15} />}
          {outcome === 'applied' ? t.assistant.applied : t.assistant.dismissed}
        </p>
      ) : (
        <div className="ai-actions">
          <button className="primary" disabled={disabled} onClick={onApply}>
            {busy ? <LoaderCircle size={16} className="loading-icon" /> : <Check size={16} />}
            {t.assistant.apply}
          </button>
          <button className="ai-ghost" disabled={disabled} onClick={onDismiss}>
            {t.assistant.dismiss}
          </button>
        </div>
      )}
    </section>
  );
}
