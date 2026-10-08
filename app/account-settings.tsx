'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AtSign, Check, Download, LoaderCircle, ShieldCheck, Trash2, X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { confirmsDeletion } from '@/lib/account';
import { USERNAME_MAX, normalizeUsername, usernameProblem } from '@/lib/username';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { useI18n } from './i18n-provider';

type Availability = { state: 'idle' | 'checking' | 'available' | 'unavailable'; text?: string };

/** The public username other members will see. */
export function UsernameSettings() {
  const { t } = useI18n();
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const asked = useRef(0);

  useEffect(() => {
    let live = true;
    fetch('/api/profile', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (!live) return;
        setSaved(data.username);
        setValue(data.username || '');
      })
      .catch(() => {
        if (!live) return;
        setSaved(null);
        setError(t.account.loadFailed);
      });
    return () => {
      live = false;
    };
    // The texts only matter for the first error message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rules are checked as you type; availability once you pause.
  const name = normalizeUsername(value);
  const changed = !!name && name !== saved;
  const problem = changed ? usernameProblem(name) : null;
  const [answer, setAnswer] = useState<{ name: string; available: boolean; text?: string } | null>(null);
  useEffect(() => {
    if (!changed || problem) return;
    const id = ++asked.current;
    const timer = window.setTimeout(async () => {
      try {
        const r = await fetch(`/api/profile/available?u=${encodeURIComponent(name)}`, { cache: 'no-store' });
        const data = await r.json();
        if (id === asked.current) setAnswer({ name, available: data.available === true, text: data.problem });
      } catch {
        // Unknown for now: saving still checks it.
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [name, changed, problem]);
  const check: Availability = !changed
    ? { state: 'idle' }
    : problem
      ? { state: 'unavailable', text: t.account.usernameProblems[problem] }
      : answer?.name !== name
        ? { state: 'checking' }
        : answer.available
          ? { state: 'available' }
          : { state: 'unavailable', text: answer.text || t.account.usernameTaken };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const r = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: value }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || t.account.usernameFailed);
      setSaved(data.username);
      setValue(data.username);
      setMessage(t.account.usernameSaved);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.account.usernameFailed);
    } finally {
      setBusy(false);
    }
  };

  const canSave = !busy && saved !== undefined && changed && check.state === 'available';
  return (
    <section className="panel account-section" aria-label={t.account.usernameTitle}>
      <div className="section-heading">
        <h2>
          <AtSign size={19} />
          {t.account.usernameTitle}
        </h2>
      </div>
      <p className="subdued">{saved === null ? t.account.usernameNone : t.account.usernameHint}</p>
      <form className="name-form mt-24" onSubmit={save}>
        <label className="field">
          <span>{t.account.usernameLabel}</span>
          <span className="name-row">
            <span className="username-input">
              <span aria-hidden>@</span>
              <input
                value={value}
                maxLength={USERNAME_MAX}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                disabled={busy || saved === undefined}
                aria-describedby="username-status"
                onChange={(event) => setValue(event.target.value.toLowerCase())}
              />
            </span>
            <button className="primary" type="submit" disabled={!canSave}>
              {busy ? <LoaderCircle className="loading-icon" size={16} /> : <Check size={16} />}
              {t.common.save}
            </button>
          </span>
        </label>
        <p id="username-status" className={`form-hint username-status ${check.state}`} aria-live="polite">
          {check.state === 'checking' && t.account.usernameChecking}
          {check.state === 'available' && (
            <>
              <Check size={14} aria-hidden /> {t.account.usernameAvailable}
            </>
          )}
          {check.state === 'unavailable' && (
            <>
              <X size={14} aria-hidden /> {check.text}
            </>
          )}
          {check.state === 'idle' && saved === null && t.account.usernameHint}
        </p>
      </form>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="notice danger" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** "Mes données": download a copy, or delete the account. */
export function DataSettings({ userId }: { userId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const remove = async () => {
    if (busy) return;
    if (!confirmsDeletion(word)) {
      setError(t.account.deleteWordMissing);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedUserId: userId, confirm: word }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || t.account.deleteFailed);
      // Nothing of this account stays in the browser.
      await createSupabaseBrowserClient()
        ?.auth.signOut({ scope: 'local' })
        .catch(() => {});
      try {
        sessionStorage.removeItem(`aw_assistant_${userId}`);
      } catch {}
      window.location.replace('/?account=deleted');
    } catch (e) {
      setError(e instanceof Error ? e.message : t.account.deleteFailed);
      setBusy(false);
    }
  };

  return (
    <section className="panel account-section" aria-label={t.account.dataTitle}>
      <div className="section-heading">
        <h2>
          <ShieldCheck size={19} />
          {t.account.dataTitle}
        </h2>
      </div>
      <p className="subdued">{t.account.dataIntro}</p>
      <div className="row flex-wrap mt-24">
        <button
          className="secondary danger-btn"
          type="button"
          onClick={() => {
            setWord('');
            setError('');
            setOpen(true);
          }}
        >
          <Trash2 size={16} />
          {t.account.deleteButton}
        </button>
      </div>
      <a className="account-export-link" href="/api/account/export" download>
        <Download size={14} aria-hidden />
        {t.account.export}
      </a>
      <AlertDialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.account.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.account.deleteText}</AlertDialogDescription>
          </AlertDialogHeader>
          <form
            className="delete-confirm"
            onSubmit={(event) => {
              event.preventDefault();
              remove();
            }}
          >
            <label className="field">
              <span>{t.account.deleteConfirmLabel(t.account.deleteWord)}</span>
              <input
                value={word}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={40}
                disabled={busy}
                onChange={(event) => setWord(event.target.value)}
              />
            </label>
            {error && (
              <p className="notice danger" role="alert">
                {error}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>{t.common.cancel}</AlertDialogCancel>
              <button className="danger-solid" type="submit" disabled={busy || !confirmsDeletion(word)}>
                {busy ? <LoaderCircle className="loading-icon" size={16} /> : <Trash2 size={16} />}
                {t.account.deleteConfirm}
              </button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
