'use client';
import { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  CalendarPlus,
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
import type { Media, WatchState } from '@/lib/watch';
import { useI18n } from './i18n-provider';

type Message = { role: 'user' | 'model'; text: string; ops?: Op[]; outcome?: 'applied' | 'dismissed' };
type Line = { icon: 'add' | 'edit' | 'remove' | 'session' | 'unsession'; text: string };
const icons = { add: Plus, edit: Pencil, remove: Trash2, session: CalendarPlus, unsession: CalendarX };
const MAX_SESSION_LINES = 8;

/** Gemini sometimes answers in markdown: keep the words, drop the markup. */
const plain = (text: string) =>
  text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ');

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
  const chatEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
        { role: 'model', text: plain(String(data.text || '')), ops: data.ops?.length ? data.ops : undefined },
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
      <div className="ai-head">
        <span className="chat-label">{t.assistant.label}</span>
        <div className="ai-head-actions">
          {remaining !== null && <span className="form-hint">{t.assistant.remaining(remaining)}</span>}
          {messages.length > 0 && (
            <button className="ghost-btn small-btn" disabled={busy} onClick={() => setMessages([])}>
              <RotateCcw size={14} />
              {t.assistant.newChat}
            </button>
          )}
        </div>
      </div>
      {!messages.length ? (
        <div className="ai-intro">
          <h2>{t.assistant.introTitle}</h2>
          <p>{t.assistant.intro(state.settings.budget)}</p>
          <div className="suggested-prompts">
            {t.assistant.prompts.map((prompt) => (
              <button key={prompt.label} disabled={busy} onClick={() => ask(prompt.text)}>
                {prompt.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="chat-list" aria-live="polite">
          {messages.map((m, i) => (
            <div className={`chat-message ${m.role}`} key={i}>
              {m.text}
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
          ))}
          <div ref={chatEnd} />
        </div>
      )}
      {busy && (
        <p className="inline-note" role="status">
          <LoaderCircle size={16} className="loading-icon" />
          {t.assistant.thinking}
        </p>
      )}
      {err && (
        <div className="notice danger" role="alert">
          {err}
          {failed && (
            <button className="ghost-btn small-btn" disabled={busy} onClick={() => ask(failed)}>
              {t.common.retry}
            </button>
          )}
        </div>
      )}
      <form
        className="chat-input"
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
          rows={2}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask(question);
            }
          }}
        />
        <button className="primary" aria-label={t.assistant.sendAria} disabled={busy || !question.trim()}>
          <Send size={18} />
        </button>
      </form>
      <p className="form-hint ai-foot">
        {t.assistant.disclaimer} {t.assistant.data}
      </p>
    </section>
  );
}

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
  const known = new Map<string, Media>(state.media.map((m) => [m.id, m]));
  for (const op of ops) if (op.op === 'add') known.set(op.media.id, op.media);
  const lines: Line[] = [];
  let hidden = 0;
  for (const op of ops) {
    if (op.op === 'add') lines.push({ icon: 'add', text: t.assistant.addTitle(op.media.title) });
    else if (op.op === 'remove') lines.push({ icon: 'remove', text: t.assistant.removeTitle(op.title) });
    else if (op.op === 'update') {
      const { progress, status, priority } = op.patch;
      const details = [
        progress !== undefined ? t.assistant.progressTo(progress) : '',
        status ? t.statuses[status] : '',
        priority !== undefined ? (priority ? t.assistant.priorityOn : t.assistant.priorityOff) : '',
      ].filter(Boolean);
      lines.push({ icon: 'edit', text: t.assistant.updateTitle(op.title, details.join(', ')) });
    } else if (op.op === 'removeSessions') {
      lines.push({ icon: 'unsession', text: t.assistant.removeSessions(op.ids.length) });
    } else if (op.op === 'addSessions') {
      for (const s of op.sessions) {
        const m = known.get(s.mediaId);
        if (!m) continue;
        if (lines.filter((l) => l.icon === 'session').length >= MAX_SESSION_LINES) {
          hidden++;
          continue;
        }
        const when = `${new Date(s.date + 'T12:00:00').toLocaleDateString(locale, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        })} ${s.time}`;
        const detail =
          m.kind === 'film'
            ? `${s.duration} min`
            : `${t.units[m.kind]} ${s.from}${s.to > s.from ? `–${s.to}` : ''} · ${s.duration} min`;
        lines.push({ icon: 'session', text: t.assistant.sessionLine(when, m.title, detail) });
      }
    }
  }
  return (
    <div className={`ai-proposal ${outcome || ''}`}>
      <p className="ai-proposal-title">{t.assistant.proposalTitle}</p>
      <ul>
        {lines.map((line, i) => {
          const Icon = icons[line.icon];
          return (
            <li key={i} className={line.icon}>
              <Icon size={15} aria-hidden />
              <span>{line.text}</span>
            </li>
          );
        })}
        {hidden > 0 && <li className="more">{t.assistant.moreSessions(hidden)}</li>}
      </ul>
      {outcome ? (
        <p className="ai-proposal-outcome">
          {outcome === 'applied' ? <Check size={15} /> : <X size={15} />}
          {outcome === 'applied' ? t.assistant.applied : t.assistant.dismissed}
        </p>
      ) : (
        <div className="ai-proposal-actions">
          <button className="primary" disabled={disabled} onClick={onApply}>
            {busy ? <LoaderCircle size={16} className="loading-icon" /> : <Check size={16} />}
            {t.assistant.apply}
          </button>
          <button className="ghost-btn" disabled={disabled} onClick={onDismiss}>
            {t.assistant.dismiss}
          </button>
        </div>
      )}
    </div>
  );
}
