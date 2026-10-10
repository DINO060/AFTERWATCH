'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AtSign,
  Camera,
  Check,
  ChevronRight,
  Download,
  LoaderCircle,
  LogOut,
  Share,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
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
import { signOut } from '@/lib/auth-actions';
import type { AccountUser } from './auth-panel';
import { PhotoFailure, discardAvatar, prepareAvatar, uploadAvatar } from '@/lib/photos';
import { Avatar } from './community-ui';
import { useI18n } from './i18n-provider';

type Availability = { state: 'idle' | 'checking' | 'available' | 'unavailable'; text?: string };

/**
 * The top of "Mon compte": the member's profile (photo, name, @username, counts), then the public
 * profile other members see (photo and username).
 */
export function UsernameSettings({
  userId,
  user,
  titles,
  onChange,
}: {
  userId: string;
  user: AccountUser;
  /** How many titles are in the member's list. */
  titles: number;
  onChange?: () => void;
}) {
  const { t } = useI18n();
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [stats, setStats] = useState<{ posts: number; recos: number } | null>(null);
  const usernameField = useRef<HTMLInputElement>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
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
        setAvatar(data.avatar ?? null);
        setStats(data.stats ?? null);
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

  // The photo is cropped and sent from the browser, then recorded; the previous one is deleted.
  const saveAvatar = async (path: string | null) => {
    const r = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar: path }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || t.account.avatarFailed);
    setAvatar(data.avatar ?? null);
    onChange?.();
  };
  const pickAvatar = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || avatarBusy) return;
    setAvatarBusy(true);
    setMessage('');
    setError('');
    let sent: string | null = null;
    try {
      const photo = await prepareAvatar(file);
      URL.revokeObjectURL(photo.preview);
      sent = await uploadAvatar(userId, photo);
      await saveAvatar(sent);
      sent = null;
      setMessage(t.account.avatarSaved);
    } catch (e) {
      if (sent) await discardAvatar(sent);
      setError(
        e instanceof PhotoFailure
          ? e.key === 'upload'
            ? t.account.avatarFailed
            : t.community.compose.photoErrors[e.key]
          : e instanceof Error
            ? e.message
            : t.account.avatarFailed,
      );
    } finally {
      setAvatarBusy(false);
    }
  };
  const removeAvatar = async () => {
    if (avatarBusy) return;
    setAvatarBusy(true);
    setMessage('');
    setError('');
    try {
      await saveAvatar(null);
      setMessage(t.account.avatarRemoved);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.account.avatarFailed);
    } finally {
      setAvatarBusy(false);
    }
  };
  // "Modifier le profil": the public profile, with the username ready to type.
  const edit = () => {
    document.getElementById('public-profile')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => usernameField.current?.focus({ preventScroll: true }), 400);
  };
  const share = async () => {
    const text = saved ? t.account.profileShareText(saved) : 'Afterwatch';
    const url = window.location.origin;
    try {
      if (navigator.share) await navigator.share({ text, url });
      else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        setMessage(t.account.profileLinkCopied);
      }
    } catch {
      // Share sheet closed.
    }
  };
  const stat = (n: number, word: (n: number) => string) => (
    <span>
      <strong>{n.toLocaleString()}</strong> {word(n)}
    </span>
  );
  return (
    <>
      <section className="profile-hero" aria-label={t.account.usernameTitle}>
        <button
          type="button"
          className="profile-hero-photo"
          aria-label={avatar ? t.account.avatarChange : t.account.avatarAdd}
          disabled={!saved || avatarBusy}
          onClick={() => picker.current?.click()}
        >
          <Avatar name={saved || user.displayName} avatar={avatar} size="xl" round />
          <span className="avatar-setting-badge" aria-hidden>
            {avatarBusy ? <LoaderCircle size={15} className="loading-icon" /> : <Camera size={15} />}
          </span>
        </button>
        <h1>{user.displayName}</h1>
        <span className={`profile-hero-handle${saved ? '' : ' none'}`}>
          {saved ? `@${saved}` : saved === null ? t.account.profileNoUsername : '…'}
        </span>
        {user.email && (
          <span className="profile-hero-email">
            {user.email} · {t.account.profileEmailPrivate}
          </span>
        )}
        <div className="profile-hero-stats">
          {stat(stats?.posts ?? 0, t.account.statPosts)}
          {stat(titles, t.account.statTitles)}
          {stat(stats?.recos ?? 0, t.account.statRecos)}
        </div>
        <div className="profile-hero-actions">
          <button type="button" className="profile-hero-edit" onClick={edit}>
            {t.account.profileEdit}
          </button>
          <button type="button" className="profile-hero-share" onClick={share} disabled={!saved}>
            <Share size={15} aria-hidden />
            {t.account.profileShare}
          </button>
        </div>
      </section>
      <section id="public-profile" className="panel account-section" aria-label={t.account.usernameTitle}>
        <div className="section-heading">
          <h2>
            <AtSign size={19} />
            {t.account.usernameTitle}
          </h2>
        </div>
        <p className="subdued account-public-hint">{t.account.publicHint}</p>
        <div className="avatar-setting">
          <Avatar name={saved || user.displayName} avatar={avatar} size="md" round />
          <div className="avatar-setting-text">
            <strong>{t.account.avatarTitle}</strong>
            <span>{saved ? t.account.avatarHint : t.account.avatarNeedUsername}</span>
            <div className="avatar-setting-actions">
              <button
                type="button"
                className="secondary small-btn"
                disabled={!saved || avatarBusy}
                onClick={() => picker.current?.click()}
              >
                {avatar ? t.account.avatarChange : t.account.avatarAdd}
              </button>
              {avatar && (
                <button
                  type="button"
                  className="ghost-btn small-btn"
                  disabled={avatarBusy}
                  onClick={removeAvatar}
                >
                  {t.account.avatarRemove}
                </button>
              )}
            </div>
          </div>
          <input
            ref={picker}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              pickAvatar(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        <p className="subdued mt-24">{saved === null ? t.account.usernameNone : t.account.usernameRules}</p>
        <form className="name-form mt-24" onSubmit={save}>
          <label className="field">
            <span>{t.account.usernameLabel}</span>
            <span className="name-row">
              <span className="username-input">
                <span aria-hidden>@</span>
                <input
                  ref={usernameField}
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
            {check.state === 'idle' && saved === null && t.account.usernameRules}
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
    </>
  );
}

/** One row of "Compte": its title and a short summary; tapping it opens the settings below. */
function AccountRow({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <details className="account-row">
      <summary>
        <span className="account-row-title">{title}</span>
        <span className="account-row-hint">{hint}</span>
        <ChevronRight size={18} className="account-row-chevron" aria-hidden />
      </summary>
      <div className="account-row-body">{children}</div>
    </details>
  );
}

/** "Compte": the private settings, each folded into a row, and signing out. */
export function AccountGroup({
  displayName,
  account,
  notifications,
  data,
}: {
  displayName: string;
  account: ReactNode;
  notifications: ReactNode;
  data: ReactNode;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const leave = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await signOut();
    } finally {
      window.location.reload();
    }
  };
  return (
    <section className="panel account-group" aria-label={t.account.groupTitle}>
      <div className="section-heading">
        <h2>{t.account.groupTitle}</h2>
      </div>
      <p className="subdued">{t.account.groupHint}</p>
      <div className="account-rows">
        <AccountRow title={t.account.rowName} hint={displayName}>
          {account}
        </AccountRow>
        <AccountRow title={t.account.rowNotifications} hint={t.account.rowNotificationsHint}>
          {notifications}
        </AccountRow>
        <AccountRow title={t.account.rowData} hint={t.account.rowDataHint}>
          {data}
        </AccountRow>
      </div>
      <button type="button" className="secondary account-signout" onClick={leave} disabled={busy}>
        {busy ? <LoaderCircle size={16} className="loading-icon" /> : <LogOut size={16} />}
        {t.auth.signOut}
      </button>
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
