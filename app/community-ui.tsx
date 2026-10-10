'use client';
// Pieces shared by the Communauté feed, a discussion and the "Recommander" sheet.
import { useState, type FormEvent, type ReactNode } from 'react';
import { Check, EyeOff, Flag, LoaderCircle, Tv } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { AVATAR_BUCKET, photoUrl, usernameHue, type TargetRef } from '@/lib/community';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { useI18n } from './i18n-provider';

export const avatarSrc = (path: string) => photoUrl(getSupabaseConfig()?.url ?? '', path, AVATAR_BUCKET);

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'failed');
  return data as T;
}
export const post = <T,>(payload: object) =>
  api<T>('/api/community', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
/** The server's explanation when there is one, otherwise a general message. */
export const problem = (e: unknown, fallback: string) =>
  e instanceof Error && e.message !== 'failed' ? e.message : fallback;
export const refQuery = (ref: TargetRef) =>
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
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  ) : (
    <span className={`${className} dx-poster-empty`} aria-hidden>
      <Tv size={20} />
    </span>
  );
}

/** A member's profile photo, or the first letter of their username on a colour of its own. */
export function Avatar({
  name,
  avatar,
  size = 'md',
  round,
}: {
  name: string | null;
  avatar?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  round?: boolean;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  const className = `dx-avatar ${size}${round ? ' round' : ''}`;
  if (avatar && broken !== avatar)
    return (
      <img
        className={`${className} photo`}
        src={avatarSrc(avatar)}
        alt=""
        aria-hidden
        loading="lazy"
        onError={() => setBroken(avatar)}
      />
    );
  return (
    <span
      className={className}
      aria-hidden
      style={{ background: name ? `hsl(${usernameHue(name)} 38% 34%)` : 'var(--secondary)' }}
    >
      {name ? name[0].toUpperCase() : '?'}
    </span>
  );
}

/** "9/10" and a bar of ten segments to tap. */
export function ScoreBar({
  score,
  onScore,
  label,
}: {
  score: number | null;
  onScore: (score: number | null) => void;
  label: string;
}) {
  const { t } = useI18n();
  const c = t.community;
  return (
    <div className="dx-score">
      <strong className="dx-score-value" aria-hidden>
        {score ?? '–'}
        <span>/10</span>
      </strong>
      <div className="dx-score-bar" role="group" aria-label={label}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            className={score !== null && n <= score ? 'on' : ''}
            aria-pressed={score === n}
            aria-label={c.scoreAria(n)}
            onClick={() => onScore(score === n ? null : n)}
          >
            <span className="dx-score-seg" aria-hidden />
            <span className="dx-score-num" aria-hidden>
              {n}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Switch({
  on,
  onChange,
  label,
  tone = 'primary',
  disabled,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  tone?: 'primary' | 'green';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`dx-switch ${tone}${on ? ' on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <span />
    </button>
  );
}

/** A hidden spoiler: what it spoils, why it is hidden, and a button to show it anyway. */
export function SpoilerVeil({
  title,
  reason,
  action,
  onShow,
  busy,
}: {
  title: string;
  reason: string;
  action: string;
  onShow: () => void;
  busy?: boolean;
}) {
  return (
    <div className="dx-veil">
      <EyeOff size={18} aria-hidden className="dx-veil-icon" />
      <div className="dx-veil-text">
        <strong>{title}</strong>
        <span>{reason}</span>
      </div>
      <button type="button" className="dx-veil-btn" onClick={onShow} disabled={busy}>
        {busy ? <LoaderCircle size={14} className="loading-icon" /> : action}
      </button>
    </div>
  );
}

/** The public username, asked for the first time a member posts. */
export function UsernameDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (username: string) => void;
}) {
  const { t } = useI18n();
  const c = t.community;
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api<{ username: string }>('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name }),
      });
      onDone(data.username);
    } catch (e) {
      setError(problem(e, c.actionFailed));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="dx-dialog">
        <DialogTitle>{c.usernameTitle}</DialogTitle>
        <DialogDescription>{c.needUsername}</DialogDescription>
        <form className="dx-username-gate" onSubmit={save}>
          <label className="field">
            <span>{c.usernameLabel}</span>
            <span className="username-input">
              <span aria-hidden>@</span>
              <input
                value={name}
                maxLength={20}
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
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
      </DialogContent>
    </Dialog>
  );
}

export function ReportDialog({ comment, onClose }: { comment: string | null; onClose: () => void }) {
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
      await post({ op: 'report', comment, reason, details: details.trim() });
      toast.success(c.reportThanks);
      setReason(null);
      setDetails('');
      onClose();
    } catch (e) {
      toast.error(problem(e, c.actionFailed));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!comment} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="dx-dialog">
        <DialogTitle>{c.reportTitle}</DialogTitle>
        <DialogDescription>{c.reportIntro}</DialogDescription>
        <form className="dx-report" onSubmit={send}>
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

/** A loading line, centered. */
export const Loading = ({ children }: { children?: ReactNode }) => (
  <p className="inline-note dx-loading" role="status">
    <LoaderCircle size={16} className="loading-icon" />
    {children}
  </p>
);
