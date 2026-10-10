'use client';
import { useState, type FormEvent } from 'react';
import {
  CalendarDays,
  Check,
  ChevronDown,
  Compass,
  House,
  KeyRound,
  Layers3,
  LoaderCircle,
  LogOut,
  MessageCircle,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { saveDisplayName, signOut } from '@/lib/auth-actions';
import { DISPLAY_NAME_MAX } from '@/lib/display-name';
import type { AccountUser, AuthMode } from './auth-panel';
import InstallApp from './install-app';
import { useI18n } from './i18n-provider';

export type View =
  | 'home'
  | 'catalog'
  | 'collection'
  | 'planning'
  | 'assistant'
  | 'account'
  | 'discussion'
  | 'moderation'
  | 'community';

export function initials(name: string) {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => Array.from(part)[0])
      .join('')
      .toUpperCase() || 'A'
  );
}

export function SiteHeader({
  view,
  onNavigate,
  user,
  authChecked,
  saving,
  onSearch,
  onProfileChange,
  onSignedOut,
  onAuth,
  moderator = false,
}: {
  view: View;
  onNavigate: (view: View) => void;
  user: AccountUser | null;
  authChecked: boolean;
  saving: boolean;
  onSearch: (query: string) => void;
  onProfileChange: () => void;
  onSignedOut: () => void;
  onAuth: (mode: AuthMode) => void;
  moderator?: boolean;
}) {
  const { t, lang, setLang } = useI18n();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const links: { id: View; label: string }[] = [
    { id: 'home', label: t.shell.home },
    { id: 'catalog', label: t.nav.catalog },
    { id: 'collection', label: t.shell.myList },
    { id: 'planning', label: t.nav.planning },
    { id: 'community', label: t.shell.community },
  ];
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
    onSearch(q);
    setSearchOpen(false);
  };
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <button className="brand-link" onClick={() => onNavigate('home')}>
          afterwatch<span>.</span>
        </button>
        <nav className="header-nav" aria-label={t.shell.mainNav}>
          {links.map((link) => (
            <button
              key={link.id}
              className={`${view === link.id || (link.id === 'community' && view === 'discussion') ? 'active' : ''}${link.id === 'home' ? ' nav-home' : ''}`}
              aria-current={view === link.id ? 'page' : undefined}
              onClick={() => onNavigate(link.id)}
            >
              {link.label}
            </button>
          ))}
        </nav>
        <div className="header-spacer" />
        <form className={`header-search ${searchOpen ? 'open' : ''}`} role="search" onSubmit={submit}>
          <Search size={16} aria-hidden="true" />
          <input
            aria-label={t.shell.searchAria}
            placeholder={t.shell.searchPlaceholder}
            value={query}
            maxLength={150}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            className="icon-btn search-close"
            aria-label={t.shell.closeSearch}
            onClick={() => setSearchOpen(false)}
          >
            <X size={16} />
          </button>
        </form>
        <button
          className="icon-btn search-toggle"
          aria-label={t.shell.openSearch}
          onClick={() => setSearchOpen(true)}
        >
          <Search size={18} />
        </button>
        <button
          className={`pill-btn ai-btn${view === 'assistant' ? ' active' : ''}${user ? '' : ' guest'}`}
          aria-current={view === 'assistant' ? 'page' : undefined}
          aria-label={t.shell.assistant}
          onClick={() => onNavigate('assistant')}
        >
          <Sparkles size={16} />
          <span>{t.shell.assistant}</span>
        </button>
        <div className="lang-toggle" role="group" aria-label={t.shell.language}>
          {(['fr', 'en'] as const).map((code) => (
            <button
              key={code}
              lang={code}
              aria-pressed={lang === code}
              className={lang === code ? 'on' : ''}
              onClick={() => setLang(code)}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
        {saving && (
          <span className="saving-status" role="status">
            <LoaderCircle size={14} className="loading-icon" />
            <span>{t.topbar.saving}</span>
          </span>
        )}
        {user ? (
          <AccountMenu
            user={user}
            moderator={moderator}
            onNavigate={onNavigate}
            onProfileChange={onProfileChange}
            onSignedOut={onSignedOut}
          />
        ) : authChecked ? (
          <div className="auth-buttons">
            <button className="secondary login-btn" onClick={() => onAuth('login')}>
              {t.auth.tabLogin}
            </button>
            <button className="primary sign-in-btn" onClick={() => onAuth('signup')}>
              {t.auth.headerSignup}
            </button>
          </div>
        ) : (
          <span className="account-placeholder" aria-hidden="true" />
        )}
      </div>
    </header>
  );
}

type MenuNote = '' | 'nameSaved' | 'nameInvalid' | 'nameFailed' | 'signoutFailed';

function AccountMenu({
  user,
  moderator,
  onNavigate,
  onProfileChange,
  onSignedOut,
}: {
  user: AccountUser;
  moderator: boolean;
  onNavigate: (view: View) => void;
  onProfileChange: () => void;
  onSignedOut: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(user.displayName);
  const [busy, setBusy] = useState<'name' | 'signout' | null>(null);
  const [note, setNote] = useState<MenuNote>('');
  const go = (view: View) => {
    setOpen(false);
    onNavigate(view);
  };
  const saveName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy('name');
    setNote('');
    try {
      setName(await saveDisplayName(name));
      setNote('nameSaved');
      onProfileChange();
    } catch (cause) {
      setNote(cause instanceof RangeError ? 'nameInvalid' : 'nameFailed');
    } finally {
      setBusy(null);
    }
  };
  const leave = async () => {
    if (busy) return;
    setBusy('signout');
    setNote('');
    try {
      await signOut();
      onSignedOut();
    } catch {
      setNote('signoutFailed');
      setBusy(null);
    }
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName(user.displayName);
          setNote('');
        }
      }}
    >
      <PopoverTrigger asChild>
        <button className="account-trigger" aria-label={t.shell.accountMenu}>
          <span className="avatar-badge">{initials(user.displayName)}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} className="account-menu">
        <div className="account-id">
          <span className="avatar-badge large">{initials(user.displayName)}</span>
          <div>
            <strong>{user.displayName}</strong>
            {user.email && <small>{user.email}</small>}
          </div>
        </div>
        <form className="account-name-form" onSubmit={saveName}>
          <label className="field">
            <span>{t.auth.nameLabel}</span>
            <span className="name-row">
              <input
                value={name}
                maxLength={DISPLAY_NAME_MAX}
                autoComplete="nickname"
                required
                disabled={Boolean(busy)}
                onChange={(event) => setName(event.target.value)}
              />
              <button
                className="primary"
                type="submit"
                disabled={Boolean(busy) || name.trim() === user.displayName}
              >
                {busy === 'name' ? <LoaderCircle className="loading-icon" size={16} /> : <Check size={16} />}
                {t.common.save}
              </button>
            </span>
          </label>
        </form>
        {note && (
          <p className={`form-hint ${note === 'nameSaved' ? '' : 'danger'}`} role="status">
            {t.auth[note]}
          </p>
        )}
        <div className="menu-separator" />
        <button className="menu-item" onClick={() => go('account')}>
          <KeyRound size={16} />
          {t.auth.myAccount}
        </button>
        <button className="menu-item" onClick={() => go('collection')}>
          <Layers3 size={16} />
          {t.shell.myList}
        </button>
        {moderator && (
          <button className="menu-item" onClick={() => go('moderation')}>
            <ShieldCheck size={16} />
            {t.community.moderation}
          </button>
        )}
        <div className="menu-install">
          <InstallApp />
        </div>
        <button className="menu-item danger" onClick={leave} disabled={busy === 'signout'}>
          {busy === 'signout' ? <LoaderCircle className="loading-icon" size={16} /> : <LogOut size={16} />}
          {t.auth.signOut}
        </button>
      </PopoverContent>
    </Popover>
  );
}

export function BottomNav({ view, onNavigate }: { view: View; onNavigate: (view: View) => void }) {
  const { t } = useI18n();
  const items = [
    { id: 'home' as const, icon: House, label: t.shell.home },
    { id: 'catalog' as const, icon: Compass, label: t.nav.catalog },
    { id: 'community' as const, icon: MessageCircle, label: t.shell.community },
    { id: 'collection' as const, icon: Layers3, label: t.shell.myList },
    { id: 'planning' as const, icon: CalendarDays, label: t.shell.planning },
  ];
  return (
    <nav className="bottom-nav" aria-label={t.shell.mainNav}>
      {items.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          className={view === id ? 'active' : ''}
          aria-current={view === id ? 'page' : undefined}
          onClick={() => onNavigate(id)}
        >
          <Icon size={20} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
