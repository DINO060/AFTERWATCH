'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  Plus,
  CalendarDays,
  Layers3,
  Sparkles,
  Bell,
  Moon,
  LockKeyhole,
  Clock3,
  Flame,
  BookOpen,
  Search,
  Check,
  MoreHorizontal,
  Trash2,
  Pencil,
  ChevronLeft,
  ChevronRight,
  Settings2,
  Send,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Film,
  CalendarPlus,
  X,
  Compass,
  Info,
  Languages,
} from 'lucide-react';
import {
  Sidebar,
  SidebarProvider,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import {
  defaults,
  kindKeys,
  dayPlus,
  planWeek,
  completeSession,
  type Media,
  type Session,
  type WatchState,
  type Kind,
  type Settings,
} from '@/lib/watch';
import InstallApp from './install-app';
import CatalogBrowser, { CatalogDetail } from './catalog-browser';
import { type CatalogItem, mediaFromCatalog, sameTitle, itemFromMedia } from '@/lib/catalog';
import AuthPanel, { type AccountUser, type AuthStatus } from './auth-panel';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { useI18n } from './i18n-provider';
type View = 'catalog' | 'today' | 'collection' | 'planning' | 'assistant' | 'reminders' | 'account';
const nav: { id: View; icon: typeof Play }[] = [
  { id: 'catalog', icon: Compass },
  { id: 'today', icon: Play },
  { id: 'collection', icon: Layers3 },
  { id: 'planning', icon: CalendarDays },
  { id: 'assistant', icon: Sparkles },
  { id: 'reminders', icon: Bell },
  { id: 'account', icon: KeyRound },
];
const formatDate = (
  locale: string,
  date: string,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' },
) => new Date(date + 'T12:00:00').toLocaleDateString(locale, options);
function zonedNow(zone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}
function Choice({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Record<string, string>;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(options).map(([v, t]) => (
          <SelectItem key={v} value={v}>
            {t}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function AppNavigation({
  view,
  setView,
  priority,
  user,
}: {
  view: View;
  setView: (v: View) => void;
  priority: number;
  user: AccountUser | null;
}) {
  const { setOpenMobile } = useSidebar();
  const { t } = useI18n();
  return (
    <Sidebar>
      <SidebarHeader>
        <div className="brand">
          <span className="brand-icon">
            <Play fill="currentColor" size={18} />
          </span>
          afterwatch<span className="brand-dot">.</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <p className="nav-caption">{t.nav.caption}</p>
        <SidebarMenu>
          {nav.map(({ id, icon: Icon }) => (
            <SidebarMenuItem key={id}>
              <SidebarMenuButton
                onClick={() => {
                  setView(id);
                  setOpenMobile(false);
                }}
                isActive={view === id}
                className="nav-link"
              >
                <Icon />
                <span>{t.nav[id]}</span>
                {id === 'collection' && priority > 0 && <span className="nav-count">{priority}</span>}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
        <div className="sidebar-note">
          <Moon size={21} />
          <strong>{t.nav.noteTitle}</strong>
          <p>
            {t.nav.noteLine1}
            <br />
            {t.nav.noteLine2}
          </p>
        </div>
      </SidebarContent>
      <SidebarFooter>
        <button
          className="profile"
          onClick={() => {
            setView('account');
            setOpenMobile(false);
          }}
        >
          <span className="avatar">{user?.displayName.slice(0, 1).toUpperCase() || 'A'}</span>
          <div>
            {user?.displayName || t.nav.browsing}
            <small>{user ? t.nav.account : t.nav.signIn}</small>
          </div>
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}
function Blank({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-zone">
      <Empty>
        <EmptyHeader>
          <BookOpen size={29} />
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        {action}
      </Empty>
    </div>
  );
}
function MediaImage({ media, className }: { media: Media; className?: string }) {
  const [broken, setBroken] = useState(false);
  return media.poster && !broken ? (
    <img
      className={className}
      src={media.poster}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  ) : (
    <div className={className || 'poster-fallback'}>
      {className ? <Film size={19} /> : <span>{media.title.slice(0, 2).toUpperCase()}</span>}
    </div>
  );
}
export default function WatchApp() {
  const { t, lang, locale, setLang } = useI18n();
  // load() is an effect dependency: read the texts through a ref so a language switch does not refetch.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const fmtDate = (date: string, options?: Intl.DateTimeFormatOptions) => formatDate(locale, date, options);
  const [auth, setAuth] = useState<AuthStatus>({
    user: null,
    configured: false,
    telegramEnabled: false,
    googleEnabled: false,
  });
  const [authChecked, setAuthChecked] = useState(false);
  const authUserId = useRef<string | null | undefined>(undefined);
  const [state, setState] = useState<WatchState>(defaults);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [aiReady, setAiReady] = useState(false);
  const [view, setView] = useState<View>('catalog');
  const [catalogDetail, setCatalogDetail] = useState<CatalogItem | null>(null);
  const [filter, setFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [mediaDialog, setMediaDialog] = useState<Media | null | undefined>(undefined);
  const [sessionDialog, setSessionDialog] = useState<{
    date: string;
    mediaId?: string;
    session?: Session;
  } | null>(null);
  const [deleteMedia, setDeleteMedia] = useState<Media | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [planPreview, setPlanPreview] = useState<Session[] | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [now, setNow] = useState({ date: '', time: '' });
  const [reminder, setReminder] = useState<Session | null>(null);
  const [permission, setPermission] = useState('default');
  const load = useCallback(async () => {
    try {
      setError('');
      setLoaded(false);
      const accountResponse = await fetch('/api/auth/user', { cache: 'no-store' });
      const account: AuthStatus & { error?: string } = await accountResponse.json();
      if (!accountResponse.ok) throw new Error(account.error || tRef.current.app.verifyFailed);
      authUserId.current = account.user?.id || null;
      setAuth(account);
      setAuthChecked(true);
      if (!account.user) {
        setState(defaults);
        setRevision(0);
        setAiReady(false);
        return;
      }
      const r = await fetch('/api/state', { cache: 'no-store' });
      const data: any = await r.json();
      if (r.status === 401) {
        setAuth({ ...account, user: null });
        authUserId.current = null;
        setState(defaults);
        setRevision(0);
        setAiReady(false);
        return;
      }
      if (!r.ok) throw new Error(data.error || tRef.current.app.loadFailed);
      if (data.userId !== account.user.id) {
        window.location.reload();
        return;
      }
      setState(data.state);
      setRevision(data.revision);
      setAiReady(data.aiReady);
      setLoaded(true);
    } catch (e) {
      setAuthChecked(true);
      setError(e instanceof Error ? e.message : tRef.current.common.connectionUnavailable);
    }
  }, []);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('auth_error')) setView('account');
    load();
  }, [load]);
  // supabase-js emits SIGNED_IN when it restores a stored session, before /api/auth/user answers.
  // undefined = server check pending: ignore events until then, and re-check instead of reloading so a mismatch cannot loop.
  useEffect(() => {
    const client = createSupabaseBrowserClient();
    if (!client) return;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      if (authUserId.current === undefined) return;
      if (
        (event === 'SIGNED_IN' || event === 'SIGNED_OUT') &&
        (session?.user.id || null) !== authUserId.current
      ) {
        authUserId.current = undefined;
        setState(defaults);
        setLoaded(false);
        setAiReady(false);
        setMediaDialog(undefined);
        setSessionDialog(null);
        setSettingsOpen(false);
        setPlanPreview(null);
        setCatalogDetail(null);
        setReminder(null);
        window.setTimeout(() => load(), 0);
      }
    });
    return () => subscription.unsubscribe();
  }, [load]);
  const commit = useCallback(
    async (next: WatchState) => {
      if (!auth.user) {
        setView('account');
        toast.info(t.app.signInToSave);
        return false;
      }
      if (savingRef.current || !loaded) return false;
      savingRef.current = true;
      setSaving(true);
      try {
        const r = await fetch('/api/state', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: next, revision, expectedUserId: auth.user.id }),
        });
        const data: any = await r.json();
        if (r.status === 401) {
          window.location.reload();
          return false;
        }
        if (!r.ok) throw new Error(data.error || t.app.saveFailed);
        setState(next);
        setRevision(data.revision);
        setError('');
        return true;
      } catch (e) {
        const message = e instanceof Error ? e.message : t.common.connectionUnavailable;
        setError(message);
        toast.error(message);
        return false;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [revision, loaded, auth.user, t],
  );
  useEffect(() => {
    const tick = () => setNow(zonedNow(state.settings.timezone));
    tick();
    const timer = setInterval(tick, 30000);
    if ('Notification' in window) setPermission(Notification.permission);
    return () => clearInterval(timer);
  }, [state.settings.timezone]);
  useEffect(() => {
    if (!loaded || !state.settings.reminders || !now.date) return;
    for (const s of state.sessions) {
      if (s.done || s.date !== now.date) continue;
      const [a, b] = s.time.split(':').map(Number);
      const [c, d] = now.time.split(':').map(Number);
      const delay = c * 60 + d - a * 60 - b;
      const tag = `afterwatch-reminder-${s.id}-${s.date}-${s.time}`;
      if (delay >= 0 && delay < 3) {
        let seen = false;
        try {
          seen = !!sessionStorage.getItem(tag);
        } catch {}
        if (seen) continue;
        try {
          sessionStorage.setItem(tag, '1');
        } catch {}
        setReminder(s);
        const m = state.media.find((m) => m.id === s.mediaId);
        if ('Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification(t.reminder.notificationTitle, {
              body: m ? `${m.title} · ${s.duration} min` : t.reminder.notificationFallback,
              icon: '/favicon.svg',
              tag,
            });
          } catch {}
        }
        break;
      }
    }
  }, [now, state, loaded, t]);
  useEffect(() => {
    const context = (document as any).modelContext;
    if (!context?.registerTool) return;
    const life = new AbortController();
    const tools = [
      {
        name: 'read_watch_collection',
        title: t.agentTools.readTitle,
        description: t.agentTools.readDescription,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input: unknown) => {
          if (!input || typeof input !== 'object' || Object.keys(input).length)
            throw new Error('No arguments expected');
          if (!loaded) throw new Error('Collection not loaded');
          return { media: state.media, sessions: state.sessions, settings: state.settings };
        },
      },
      {
        name: 'start_adding_watch_title',
        title: t.agentTools.addTitle,
        description: t.agentTools.addDescription,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input: unknown) => {
          if (!input || typeof input !== 'object' || Object.keys(input).length)
            throw new Error('No arguments expected');
          setMediaDialog(null);
          return { formOpened: true, saved: false };
        },
      },
    ];
    for (const tool of tools) {
      try {
        Promise.resolve(context.registerTool(tool, { signal: life.signal })).catch(() => {});
      } catch {}
    }
    return () => life.abort();
  }, [state, loaded, t]);
  const today = now.date || zonedNow(state.settings.timezone).date;
  const active = state.media.filter((m) => m.status !== 'completed');
  const priorities = active.filter((m) => m.priority);
  const todaySessions = state.sessions
    .filter((s) => s.date === today)
    .sort((a, b) => a.time.localeCompare(b.time));
  const start = dayPlus(today, weekOffset * 7);
  const week = Array.from({ length: 7 }, (_, i) => dayPlus(start, i));
  const upcoming = state.sessions
    .filter((s) => !s.done && s.date >= today)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const filtered = state.media
    .filter(
      (m) =>
        (filter === 'all' || m.kind === filter) &&
        (priorityFilter === 'all' ||
          (priorityFilter === 'priority'
            ? m.priority
            : priorityFilter === 'normal'
              ? !m.priority
              : m.status === 'completed')) &&
        m.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    )
    .sort((a, b) => Number(b.priority) - Number(a.priority) || a.title.localeCompare(b.title));
  const add = (kind?: Kind) => {
    if (!auth.user) {
      setView('account');
      return;
    }
    if (!loaded) return;
    setMediaDialog(
      kind
        ? {
            id: '',
            title: '',
            kind,
            priority: true,
            status: 'watching',
            progress: 0,
            total: kind === 'film' ? 1 : 0,
            duration: kind === 'manga' ? 10 : kind === 'film' ? 120 : kind === 'series' ? 45 : 24,
            poster: '',
            sourceUrl: '',
            notes: '',
          }
        : null,
    );
  };
  const generate = () => {
    const proposed = planWeek(state, start);
    if (!proposed.length) {
      toast.info(t.toasts.noSessionsToAdd);
      return;
    }
    setPlanPreview(proposed);
  };
  const finish = async (s: Session) => {
    if (await commit(completeSession(state, s.id))) toast.success(t.toasts.sessionDone);
  };
  const advance = async (m: Media) => {
    const progress = m.total ? Math.min(m.total, m.progress + 1) : m.progress + 1;
    const next = {
      ...state,
      media: state.media.map((x) =>
        x.id === m.id
          ? {
              ...x,
              progress,
              status: m.total > 0 && progress >= m.total ? ('completed' as const) : ('watching' as const),
            }
          : x,
      ),
      sessions: state.sessions.map((s) =>
        s.mediaId === m.id && s.to <= progress ? { ...s, done: true } : s,
      ),
    };
    if (await commit(next)) toast.success(m.kind === 'manga' ? t.toasts.chapterLogged : t.toasts.logged);
  };
  const canAct = !!auth.user && loaded && !saving;
  const addCatalog = async (item: CatalogItem, priority: boolean) => {
    if (state.media.some((m) => sameTitle(m, item))) {
      toast.info(t.toasts.alreadyInCollection);
      return true;
    }
    const media = { ...mediaFromCatalog(item), priority };
    const ok = await commit({ ...state, media: [...state.media, media] });
    if (ok) toast.success(t.toasts.addedToList(item.title));
    return ok;
  };
  const sessionRow = (s: Session) => {
    const m = state.media.find((m) => m.id === s.mediaId);
    if (!m) return null;
    return (
      <div className={`session-row ${s.done ? 'done' : ''}`} key={s.id}>
        <MediaImage media={m} className="session-cover" />
        <div className="session-info">
          <h3>{m.title}</h3>
          <p>
            {m.kind === 'film'
              ? t.kinds.film
              : `${t.units[m.kind]} ${s.from}${s.to > s.from ? ` – ${s.to}` : ''}`}{' '}
            · {s.duration} min
          </p>
        </div>
        <span className="session-time">{s.time}</span>
        <button
          title={s.done ? t.media.sessionDone : t.media.markDone}
          aria-label={t.media.finish(m.title)}
          className={`session-check ${s.done ? 'checked' : ''}`}
          disabled={!canAct || s.done}
          onClick={() => finish(s)}
        >
          <Check size={16} />
        </button>
      </div>
    );
  };
  const mediaCard = (m: Media) => (
    <article className="media-card" key={m.id}>
      <div className="poster-wrap">
        <button
          className="collection-cover-detail"
          onClick={() => setCatalogDetail(itemFromMedia(m))}
          aria-label={t.media.viewDetailsOf(m.title)}
        >
          <MediaImage media={m} />
        </button>
        <span className="poster-type">{t.kinds[m.kind]}</span>
        <button
          className={`icon-btn priority-toggle ${m.priority ? 'active' : ''}`}
          title={m.priority ? t.media.removePriority : t.media.makePriority}
          aria-label={t.media.priorityFor(m.title)}
          aria-pressed={m.priority}
          disabled={!canAct}
          onClick={() =>
            commit({
              ...state,
              media: state.media.map((x) => (x.id === m.id ? { ...x, priority: !x.priority } : x)),
            })
          }
        >
          <Flame size={17} fill={m.priority ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="media-body">
        <button className="collection-title-detail" onClick={() => setCatalogDetail(itemFromMedia(m))}>
          <h3>{m.title}</h3>
        </button>
        <div className="media-meta">
          <span>
            {m.progress} / {m.total || '?'} {t.units[m.kind]}
          </span>
          <span className={`status-badge ${m.status}`}>{t.statuses[m.status]}</span>
        </div>
        <Progress
          value={m.total ? (m.progress / m.total) * 100 : 0}
          aria-label={t.media.progressOf(m.title)}
        />
        <div className="media-actions">
          <button
            className="secondary small-btn"
            disabled={!canAct || m.status === 'completed'}
            onClick={() => advance(m)}
          >
            <Check size={14} />
            {m.kind === 'film'
              ? t.media.advanceFilm
              : m.kind === 'manga'
                ? t.media.advanceChapter
                : t.media.advanceEpisode}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="icon-btn" aria-label={t.media.optionsFor(m.title)}>
                <MoreHorizontal size={19} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setCatalogDetail(itemFromMedia(m))}>
                <Info />
                {t.media.viewDetails}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setMediaDialog(m)}>
                <Pencil />
                {t.media.edit}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSessionDialog({ date: today, mediaId: m.id })}>
                <CalendarPlus />
                {t.media.schedule}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDeleteMedia(m)} className="danger">
                <Trash2 />
                {t.media.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </article>
  );
  return (
    <SidebarProvider>
      <Toaster theme="dark" position="bottom-right" richColors />
      <AppNavigation view={view} setView={setView} priority={priorities.length} user={auth.user} />
      <main className="main">
        <header className="topbar">
          <div className="topbar-title">
            <SidebarTrigger aria-label={t.nav.openMenu} />
            <span>{t.nav[view]}</span>
          </div>
          <div className="topbar-right">
            <InstallApp />
            <button
              className="ghost-btn small-btn lang-switch"
              aria-label={t.langSwitch.aria}
              title={t.langSwitch.aria}
              onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}
            >
              <Languages size={15} />
              <span>{t.langSwitch.label}</span>
            </button>
            <span className="private-badge">
              <LockKeyhole size={13} />
              {saving ? t.topbar.saving : auth.user ? t.topbar.privateSpace : t.topbar.publicCatalog}
            </span>
            <button
              className="icon-btn"
              aria-label={t.topbar.openReminders}
              onClick={() => setView('reminders')}
            >
              <Bell size={18} />
            </button>
            <button className="secondary small-btn" onClick={() => setView('account')}>
              {auth.user ? t.nav.account : t.nav.signIn}
            </button>
          </div>
        </header>
        <div className="workspace">
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button className="secondary small-btn" onClick={load}>
                <RefreshCw size={14} />
                {t.common.reload}
              </button>
            </div>
          )}
          {reminder && (
            <div className="notification-banner" role="status">
              <Bell size={20} />
              <p>
                {t.reminder.banner(
                  state.media.find((m) => m.id === reminder.mediaId)?.title || '',
                  reminder.duration,
                )}
              </p>
              <div className="row">
                <button
                  className="secondary small-btn"
                  onClick={() => {
                    setView('today');
                    setReminder(null);
                  }}
                >
                  {t.reminder.seeSession}
                </button>
                <button className="icon-btn" aria-label={t.reminder.close} onClick={() => setReminder(null)}>
                  <X size={16} />
                </button>
              </div>
            </div>
          )}
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {view === 'today'
                  ? fmtDate(today, { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()
                  : t.app.eyebrow}
              </p>
              <h1>{t.headings[view]}</h1>
              <p>
                {view === 'planning' ? t.subheadings.planning(state.settings.budget) : t.subheadings[view]}
              </p>
            </div>
            {['today', 'collection'].includes(view) ? (
              <button className="primary" disabled={!canAct} onClick={() => setView('catalog')}>
                <Plus size={18} />
                {t.app.browseCatalog}
              </button>
            ) : view === 'planning' ? (
              <button className="primary" disabled={!canAct} onClick={generate}>
                <CalendarDays size={17} />
                {t.app.prepareWeek}
              </button>
            ) : view === 'reminders' ? (
              <button className="secondary" disabled={!canAct} onClick={() => setSettingsOpen(true)}>
                <Settings2 size={17} />
                {t.app.myHours}
              </button>
            ) : null}
          </div>
          {view === 'catalog' && authChecked && !auth.user && (
            <p className="notice">
              {t.app.catalogNotice}{' '}
              <button className="ghost-btn small-btn" onClick={() => setView('account')}>
                {t.app.signInToSaveTitles}
              </button>
            </p>
          )}
          {authChecked && !auth.user && !['catalog', 'account'].includes(view) ? (
            <AuthPanel {...auth} />
          ) : !loaded && !error && !['catalog', 'account'].includes(view) ? (
            <div className="loading-grid" aria-label={t.app.loadingCollection}>
              <Skeleton className="skeleton-block h-52 w-full" />
              <Skeleton className="skeleton-block h-24 w-full" />
              <Skeleton className="skeleton-block h-64 w-full" />
            </div>
          ) : loaded || ['catalog', 'account'].includes(view) ? (
            <>
              {view === 'account' &&
                (authChecked ? (
                  <AuthPanel {...auth} />
                ) : (
                  <p className="inline-note" role="status">
                    {t.app.checkingSignIn}
                  </p>
                ))}
              {view === 'today' && (
                <>
                  <section className="welcome-banner">
                    <img src="/night-city.webp" alt={t.today.bannerAlt} />
                    <div className="banner-content">
                      <span className="tag">
                        {todaySessions.some((s) => !s.done) ? t.today.tagSession : t.today.tagResume}
                      </span>
                      <h2>
                        {todaySessions.some((s) => !s.done)
                          ? state.media.find((m) => m.id === todaySessions.find((s) => !s.done)?.mediaId)
                              ?.title
                          : t.today.oneEpisode}
                      </h2>
                      <p>
                        {todaySessions.length
                          ? t.today.remaining(
                              todaySessions.filter((s) => !s.done).length,
                              todaySessions.filter((s) => !s.done).reduce((n, s) => n + s.duration, 0),
                            )
                          : t.today.simpleEvening}
                      </p>
                      <button
                        className="secondary small-btn"
                        onClick={() => (active.length ? setView('planning') : setView('catalog'))}
                      >
                        {active.length ? <CalendarDays size={15} /> : <Plus size={15} />}{' '}
                        {active.length ? t.today.seeSchedule : t.today.startCollection}
                      </button>
                    </div>
                  </section>
                  <div className="stats-grid">
                    <div className="stat">
                      <div className="stat-label">
                        <Layers3 size={20} />
                        <span>{t.today.toResume}</span>
                      </div>
                      <strong>{active.length}</strong>
                    </div>
                    <div className="stat">
                      <div className="stat-label">
                        <Flame size={20} />
                        <span>{t.today.priorities}</span>
                      </div>
                      <strong>{priorities.length}</strong>
                    </div>
                    <div className="stat">
                      <div className="stat-label">
                        <Clock3 size={20} />
                        <span>{t.today.perDay}</span>
                      </div>
                      <strong>{state.settings.budget === 60 ? '1 h' : `${state.settings.budget} m`}</strong>
                    </div>
                  </div>
                  <div className="two-col">
                    <section className="panel">
                      <div className="section-heading">
                        <h2>
                          <Play size={18} />
                          {t.today.todayProgram}
                        </h2>
                        <span className="muted-count">{t.today.sessions(todaySessions.length)}</span>
                      </div>
                      {todaySessions.length ? (
                        todaySessions.map(sessionRow)
                      ) : (
                        <Blank
                          title={t.today.freeEvening}
                          description={t.today.freeEveningHint}
                          action={
                            <button
                              className="secondary small-btn"
                              onClick={() =>
                                state.media.length ? setSessionDialog({ date: today }) : setView('catalog')
                              }
                            >
                              <Plus size={15} />
                              {t.today.planSession}
                            </button>
                          }
                        />
                      )}
                    </section>
                    <section className="panel">
                      <div className="section-heading">
                        <h2>{t.today.nextDays}</h2>
                        <button
                          className="icon-btn"
                          aria-label={t.today.adjustHours}
                          onClick={() => setSettingsOpen(true)}
                        >
                          <Settings2 size={17} />
                        </button>
                      </div>
                      <div className="mini-week">
                        {Array.from({ length: 7 }, (_, i) => dayPlus(today, i)).map((d, i) => (
                          <button
                            key={d}
                            className={`mini-day ${i === 0 ? 'today' : ''} ${state.sessions.some((s) => s.date === d) ? 'has-plan' : ''}`}
                            onClick={() => {
                              setWeekOffset(0);
                              setView('planning');
                            }}
                          >
                            <span>{t.weekdaysShort[new Date(d + 'T12:00:00').getDay()]}</span>
                            <b>{new Date(d + 'T12:00:00').getDate()}</b>
                            <i />
                          </button>
                        ))}
                      </div>
                      <p className="inline-note">
                        <Clock3 size={15} />
                        {t.today.perDayLine(state.settings.time, state.settings.budget)}
                      </p>
                      <button
                        className="secondary full mt-24"
                        onClick={() => {
                          setWeekOffset(0);
                          setView('planning');
                        }}
                      >
                        {t.today.organizeWeek}
                      </button>
                    </section>
                  </div>
                  <section className="mt-24">
                    <div className="section-heading">
                      <h2>
                        <Flame size={20} />
                        {t.today.topOfList}
                      </h2>
                      <button
                        className="ghost-btn small-btn"
                        onClick={() => {
                          setPriorityFilter('priority');
                          setView('collection');
                        }}
                      >
                        {t.today.seeAll}
                      </button>
                    </div>
                    {priorities.length ? (
                      <div className="media-grid">{priorities.slice(0, 4).map(mediaCard)}</div>
                    ) : (
                      <div className="panel">
                        <p className="inline-note">
                          <Flame size={17} />
                          {t.today.flameHint}
                        </p>
                      </div>
                    )}
                  </section>
                </>
              )}
              {view === 'catalog' && (
                <CatalogBrowser
                  collection={state.media}
                  saving={saving}
                  onAdd={addCatalog}
                  onDetail={setCatalogDetail}
                  onManual={() => add()}
                />
              )}
              {view === 'collection' && (
                <>
                  <Tabs value={filter} onValueChange={setFilter} className="media-tabs">
                    <TabsList aria-label={t.collection.contentType}>
                      <TabsTrigger value="all">
                        {t.collection.all} <span className="muted-count">{state.media.length}</span>
                      </TabsTrigger>
                      {kindKeys.map((v) => (
                        <TabsTrigger value={v} key={v}>
                          {t.kindsPlural[v]}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                    <div className="toolbar">
                      <div className="filter-line">
                        <div className="search-field">
                          <Search size={17} />
                          <input
                            aria-label={t.collection.searchAria}
                            placeholder={t.collection.searchPlaceholder}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                          />
                        </div>
                        <Choice
                          value={priorityFilter}
                          onChange={setPriorityFilter}
                          label={t.collection.filterAria}
                          options={t.collection.filters}
                        />
                      </div>
                      <span className="muted-count">{t.collection.titles(filtered.length)}</span>
                    </div>
                    {['all', ...kindKeys].map((tab) => (
                      <TabsContent value={tab} key={tab}>
                        {filtered.length ? (
                          <div className="media-grid">{filtered.map(mediaCard)}</div>
                        ) : (
                          <div className="empty-collection">
                            <Blank
                              title={state.media.length ? t.collection.noMatch : t.collection.empty}
                              description={
                                state.media.length ? t.collection.noMatchHint : t.collection.emptyHint
                              }
                              action={
                                <button className="primary" onClick={() => setView('catalog')}>
                                  <Plus size={17} />
                                  {t.app.browseCatalog}
                                </button>
                              }
                            />
                          </div>
                        )}
                      </TabsContent>
                    ))}
                  </Tabs>
                </>
              )}
              {view === 'planning' && (
                <>
                  <div className="row spread flex-wrap">
                    <p className="inline-note">
                      <Flame size={17} />
                      {t.planning.priorityFirst}
                    </p>
                    <button className="secondary small-btn" onClick={() => setSettingsOpen(true)}>
                      <Settings2 size={15} />
                      {state.settings.budget} min · {state.settings.time}
                    </button>
                  </div>
                  <div className="week-heading">
                    <h2>
                      {fmtDate(start)} – {fmtDate(dayPlus(start, 6))}
                    </h2>
                    <div className="row">
                      <button
                        className="icon-btn"
                        aria-label={t.planning.previousWeek}
                        onClick={() => setWeekOffset((v) => v - 1)}
                      >
                        <ChevronLeft size={20} />
                      </button>
                      <button className="ghost-btn small-btn" onClick={() => setWeekOffset(0)}>
                        {t.planning.today}
                      </button>
                      <button
                        className="icon-btn"
                        aria-label={t.planning.nextWeek}
                        onClick={() => setWeekOffset((v) => v + 1)}
                      >
                        <ChevronRight size={20} />
                      </button>
                    </div>
                  </div>
                  <div className="week-grid">
                    {week.map((date) => {
                      const sessions = state.sessions
                        .filter((s) => s.date === date)
                        .sort((a, b) => a.time.localeCompare(b.time));
                      return (
                        <section className={`day-column ${date === today ? 'is-today' : ''}`} key={date}>
                          <div className="day-heading">
                            <span>{t.weekdaysShort[new Date(date + 'T12:00:00').getDay()]}</span>
                            <b>{new Date(date + 'T12:00:00').getDate()}</b>
                          </div>
                          {sessions.map((s) => {
                            const m = state.media.find((m) => m.id === s.mediaId);
                            return m ? (
                              <div
                                className={`plan-item ${m.priority ? 'priority' : ''} ${s.done ? 'done' : ''}`}
                                key={s.id}
                              >
                                <small>
                                  {s.time} · {s.duration} min
                                </small>
                                <p>{m.title}</p>
                                <small>
                                  {m.kind === 'film'
                                    ? t.kinds.film
                                    : `${t.units[m.kind]} ${s.from}${s.to > s.from ? `–${s.to}` : ''}`}
                                </small>
                                <div className="plan-actions">
                                  <button
                                    className="icon-btn"
                                    aria-label={t.media.finish(m.title)}
                                    disabled={s.done || !canAct}
                                    onClick={() => finish(s)}
                                  >
                                    <Check size={15} />
                                  </button>
                                  <button
                                    className="icon-btn"
                                    aria-label={t.planning.move(m.title)}
                                    onClick={() =>
                                      setSessionDialog({ date: s.date, mediaId: s.mediaId, session: s })
                                    }
                                  >
                                    <Pencil size={13} />
                                  </button>
                                  <button
                                    className="icon-btn"
                                    aria-label={t.planning.removeSession(m.title)}
                                    disabled={!canAct}
                                    onClick={() =>
                                      commit({
                                        ...state,
                                        sessions: state.sessions.filter((x) => x.id !== s.id),
                                      })
                                    }
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              </div>
                            ) : null;
                          })}
                          {!sessions.length && (
                            <p className="day-empty">
                              {state.settings.days.includes(new Date(date + 'T12:00:00').getDay())
                                ? t.planning.freeEvening
                                : t.planning.dayOff}
                            </p>
                          )}
                          <button
                            className="plan-add"
                            onClick={() => (state.media.length ? setSessionDialog({ date }) : add())}
                          >
                            <Plus size={13} />
                            {t.planning.addSession}
                          </button>
                          {sessions.length > 0 && (
                            <p className="day-total">
                              {sessions.reduce((n, s) => n + s.duration, 0)} / {state.settings.budget} min
                            </p>
                          )}
                        </section>
                      );
                    })}
                  </div>
                  <p className="form-hint mt-24">{t.planning.hint(state.settings.timezone)}</p>
                </>
              )}
              {view === 'assistant' && (
                <Assistant
                  key={auth.user?.id}
                  expectedUserId={auth.user?.id || ''}
                  aiReady={aiReady}
                  state={state}
                  onPlanning={() => setView('planning')}
                />
              )}
              {view === 'reminders' && (
                <div className="two-col">
                  <section className="panel">
                    <div className="section-heading">
                      <h2>
                        <Bell size={18} />
                        {t.reminders.upcoming}
                      </h2>
                    </div>
                    {upcoming.length ? (
                      upcoming.slice(0, 20).map((s) => (
                        <div key={s.id}>
                          <p className="form-hint mt-24">
                            {fmtDate(s.date, { weekday: 'long', day: 'numeric', month: 'long' })}
                          </p>
                          {sessionRow(s)}
                        </div>
                      ))
                    ) : (
                      <Blank
                        title={t.reminders.nothingPlanned}
                        description={t.reminders.nothingPlannedHint}
                        action={
                          <button className="secondary" onClick={() => setView('planning')}>
                            {t.reminders.openPlanning}
                          </button>
                        }
                      />
                    )}
                  </section>
                  <section className="panel">
                    <div className="section-heading">
                      <h2>{t.reminders.myNotifications}</h2>
                    </div>
                    <div className="settings-row">
                      <div>
                        <h3>{t.reminders.inApp}</h3>
                        <p>{t.reminders.inAppHint}</p>
                      </div>
                      <Switch
                        checked={state.settings.reminders}
                        disabled={!canAct}
                        aria-label={t.reminders.inAppAria}
                        onCheckedChange={(v) =>
                          commit({ ...state, settings: { ...state.settings, reminders: v } })
                        }
                      />
                    </div>
                    <div className="settings-row">
                      <div>
                        <h3>{t.reminders.browser}</h3>
                        <p>
                          {permission === 'granted'
                            ? t.reminders.granted
                            : permission === 'denied'
                              ? t.reminders.denied
                              : t.reminders.ask}
                        </p>
                      </div>
                    </div>
                    <button
                      className="secondary full"
                      onClick={async () => {
                        if (!('Notification' in window)) {
                          toast.info(t.toasts.notificationsUnsupported);
                          return;
                        }
                        try {
                          const p = await Notification.requestPermission();
                          setPermission(p);
                          toast.info(
                            p === 'granted' ? t.toasts.notificationsAllowed : t.toasts.inAppStillAvailable,
                          );
                        } catch {
                          toast.info(t.toasts.useInApp);
                        }
                      }}
                      disabled={permission === 'granted' || permission === 'denied'}
                    >
                      <Bell size={16} />
                      {permission === 'granted' ? t.reminders.allowedButton : t.reminders.allowButton}
                    </button>
                    <p className="notice">{t.reminders.keepOpen}</p>
                    <p className="subdued">
                      {t.reminders.usualTime} <span className="accent-text">{state.settings.time}</span>
                      <br />
                      {state.settings.timezone}
                    </p>
                  </section>
                </div>
              )}
              <p className="footer-note">
                <LockKeyhole size={12} />
                {auth.user ? t.app.footerPrivate : t.app.footerPublic}
              </p>
            </>
          ) : null}
        </div>
      </main>
      {catalogDetail && (
        <CatalogDetail
          item={catalogDetail}
          collection={state.media}
          saving={saving}
          onClose={() => setCatalogDetail(null)}
          onAdd={addCatalog}
          onEdit={(m) => {
            setCatalogDetail(null);
            setMediaDialog(m);
          }}
        />
      )}
      {mediaDialog !== undefined && (
        <MediaEditor
          media={mediaDialog}
          onClose={() => setMediaDialog(undefined)}
          saving={saving}
          onSave={async (m) => {
            const exists = state.media.some((x) => x.id === m.id);
            if (
              !exists &&
              state.media.some(
                (x) => x.kind === m.kind && x.title.toLocaleLowerCase() === m.title.toLocaleLowerCase(),
              )
            ) {
              toast.error(t.toasts.titleExists);
              return false;
            }
            const ok = await commit({
              ...state,
              media: exists ? state.media.map((x) => (x.id === m.id ? m : x)) : [...state.media, m],
            });
            if (ok) {
              toast.success(exists ? t.toasts.titleUpdated : t.toasts.addedToCollection);
              setMediaDialog(undefined);
            }
            return ok;
          }}
        />
      )}
      {sessionDialog && (
        <SessionEditor
          state={state}
          data={sessionDialog}
          saving={saving}
          onClose={() => setSessionDialog(null)}
          onSave={async (s) => {
            const ok = await commit({
              ...state,
              sessions: [...state.sessions.filter((x) => x.id !== s.id), s],
            });
            if (ok) {
              setSessionDialog(null);
              toast.success(t.toasts.sessionSaved);
            }
            return ok;
          }}
        />
      )}
      {settingsOpen && (
        <SettingsEditor
          initial={state.settings}
          saving={saving}
          onClose={() => setSettingsOpen(false)}
          onSave={async (settings) => {
            if (await commit({ ...state, settings })) {
              setSettingsOpen(false);
              toast.success(t.toasts.preferencesSaved);
            }
          }}
        />
      )}
      <AlertDialog open={!!deleteMedia} onOpenChange={(open) => !open && setDeleteMedia(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.removeDialog.title(deleteMedia?.title || '')}</AlertDialogTitle>
            <AlertDialogDescription>{t.removeDialog.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.removeDialog.keep}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!canAct}
              onClick={async (e) => {
                e.preventDefault();
                if (
                  deleteMedia &&
                  (await commit({
                    ...state,
                    media: state.media.filter((m) => m.id !== deleteMedia.id),
                    sessions: state.sessions.filter((s) => s.mediaId !== deleteMedia.id),
                  }))
                ) {
                  setDeleteMedia(null);
                  toast.success(t.toasts.titleRemoved);
                }
              }}
            >
              {t.common.remove}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={planPreview !== null} onOpenChange={(open) => !open && setPlanPreview(null)}>
        <DialogContent className="modal-content">
          <DialogHeader>
            <DialogTitle>{t.planning.proposedTitle}</DialogTitle>
            <DialogDescription>
              {t.planning.proposedDescription(
                planPreview?.length || 0,
                planPreview?.reduce((n, s) => n + s.duration, 0) || 0,
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="catalog-results">
            {planPreview?.map((s) => (
              <div className="catalog-result" key={s.id}>
                <CalendarDays size={19} />
                <span>
                  {state.media.find((m) => m.id === s.mediaId)?.title}
                  <small>
                    {fmtDate(s.date)} · {s.time} · {s.duration} min · {s.from}–{s.to}
                  </small>
                </span>
              </div>
            ))}
          </div>
          <p className="form-hint">{t.planning.unknownTotalHint}</p>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setPlanPreview(null)}>
              {t.common.cancel}
            </button>
            <button
              className="primary"
              disabled={!canAct}
              onClick={async () => {
                if (
                  planPreview &&
                  (await commit({ ...state, sessions: [...state.sessions, ...planPreview] }))
                ) {
                  setPlanPreview(null);
                  setView('planning');
                  toast.success(t.toasts.scheduleAdded);
                }
              }}
            >
              {t.planning.addToPlanning}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
function MediaEditor({
  media,
  onClose,
  onSave,
  saving,
}: {
  media: Media | null;
  onClose: () => void;
  onSave: (m: Media) => Promise<boolean>;
  saving: boolean;
}) {
  const { t } = useI18n();
  const [m, setM] = useState<Media>(
    media || {
      id: '',
      title: '',
      kind: 'anime',
      priority: true,
      status: 'watching',
      progress: 0,
      total: 0,
      duration: 24,
      poster: '',
      sourceUrl: '',
      notes: '',
    },
  );
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searched, setSearched] = useState(false);
  const [formError, setFormError] = useState('');
  const requestSeq = useRef(0);
  const set = <K extends keyof Media>(key: K, value: Media[K]) => setM((old) => ({ ...old, [key]: value }));
  const search = async () => {
    if (term.trim().length < 2) return;
    const seq = ++requestSeq.current;
    setSearching(true);
    setSearchError('');
    try {
      const r = await fetch(`/api/catalog?kind=${m.kind}&q=${encodeURIComponent(term.trim())}`);
      const data: any = await r.json();
      if (seq !== requestSeq.current) return;
      if (!r.ok) throw new Error(data.error);
      setResults(data.results);
      setSearched(true);
    } catch (e) {
      if (seq === requestSeq.current)
        setSearchError(e instanceof Error ? e.message : t.mediaEditor.searchUnavailable);
    } finally {
      if (seq === requestSeq.current) setSearching(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="modal-content">
        <DialogHeader>
          <DialogTitle>{media?.id ? t.mediaEditor.editTitle : t.mediaEditor.addTitle}</DialogTitle>
          <DialogDescription>{t.mediaEditor.description}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setFormError('');
            if (!m.title.trim()) {
              setFormError(t.mediaEditor.needTitle);
              return;
            }
            if (m.total && m.progress > m.total) {
              setFormError(t.mediaEditor.progressOverTotal);
              return;
            }
            await onSave({
              ...m,
              id: m.id || crypto.randomUUID(),
              title: m.title.trim(),
              status: m.total > 0 && m.progress === m.total ? 'completed' : m.status,
            });
          }}
        >
          <div className="form-grid">
            <label className="field full-span">
              <span>{t.mediaEditor.category}</span>
              <Choice
                value={m.kind}
                onChange={(v) => {
                  requestSeq.current++;
                  setSearching(false);
                  setResults([]);
                  setSearched(false);
                  setSearchError('');
                  setM((old) => ({
                    ...old,
                    kind: v as Kind,
                    poster: '',
                    sourceUrl: '',
                    catalog: undefined,
                    total: v === 'film' ? 1 : 0,
                    duration: v === 'manga' ? 10 : v === 'film' ? 120 : v === 'series' ? 45 : 24,
                  }));
                }}
                label={t.mediaEditor.categoryAria}
                options={t.kinds}
              />
            </label>
            {!media?.id && m.kind !== 'film' && (
              <div className="field full-span">
                <span>{t.mediaEditor.searchLabel}</span>
                <div className="catalog-search">
                  <input
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                    placeholder={
                      m.kind === 'manga'
                        ? t.mediaEditor.searchPlaceholderManga
                        : t.mediaEditor.searchPlaceholder
                    }
                    aria-label={t.mediaEditor.searchAria}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        search();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="secondary"
                    disabled={searching || term.trim().length < 2}
                    onClick={search}
                  >
                    {searching ? <LoaderCircle className="loading-icon" size={17} /> : <Search size={17} />}
                  </button>
                </div>
                {searchError && (
                  <p className="form-hint danger" role="status">
                    {searchError}
                  </p>
                )}
                {searched && !results.length && !searchError && (
                  <p className="form-hint">{t.mediaEditor.noResults}</p>
                )}
                {results.length > 0 && (
                  <div className="catalog-results">
                    {results.map((r, i) => (
                      <button
                        type="button"
                        key={i}
                        className="catalog-result"
                        onClick={() => {
                          setM((old) => ({
                            ...old,
                            title: r.title,
                            poster: r.poster,
                            sourceUrl: r.sourceUrl,
                            total: r.total,
                            catalog: r.catalog,
                            duration: Math.max(1, Math.min(600, r.duration)),
                          }));
                          setResults([]);
                          setSearched(false);
                        }}
                      >
                        {r.poster && <img src={r.poster} alt="" referrerPolicy="no-referrer" />}
                        <span>
                          {r.title}
                          <small>{r.subtitle}</small>
                        </span>
                        <Plus size={15} />
                      </button>
                    ))}
                  </div>
                )}
                <span className="form-hint">
                  {m.kind === 'series' ? (
                    <a href="https://www.tvmaze.com" target="_blank" rel="noreferrer">
                      {t.mediaEditor.sourceTvmaze}
                    </a>
                  ) : (
                    <a href="https://jikan.moe" target="_blank" rel="noreferrer">
                      {t.mediaEditor.sourceJikan}
                    </a>
                  )}{' '}
                  {t.mediaEditor.manualAlways}
                </span>
              </div>
            )}
            <label className="field full-span">
              <span>{t.common.title}</span>
              <input
                value={m.title}
                maxLength={180}
                onChange={(e) => set('title', e.target.value)}
                required
                placeholder={t.mediaEditor.titlePlaceholder}
              />
            </label>
            <label className="field">
              <span>{t.mediaEditor.status}</span>
              <Choice
                value={m.status}
                onChange={(v) => set('status', v as Media['status'])}
                label={t.mediaEditor.status}
                options={t.statuses}
              />
            </label>
            <label className="field">
              <span>
                {m.kind === 'manga'
                  ? t.mediaEditor.minutesPerChapter
                  : m.kind === 'film'
                    ? t.mediaEditor.minutesPerFilm
                    : t.mediaEditor.minutesPerEpisode}
              </span>
              <input
                type="number"
                min={1}
                max={600}
                value={m.duration}
                onChange={(e) => set('duration', Number(e.target.value))}
                required
              />
            </label>
            <label className="field">
              <span>
                {m.kind === 'manga'
                  ? t.mediaEditor.lastChapter
                  : m.kind === 'film'
                    ? t.mediaEditor.filmSeen
                    : t.mediaEditor.lastEpisode}
              </span>
              <input
                type="number"
                min={0}
                max={m.kind === 'film' ? 1 : 100000}
                value={m.progress}
                onChange={(e) => set('progress', Number(e.target.value))}
                required
              />
            </label>
            <label className="field">
              <span>{m.kind === 'film' ? t.mediaEditor.totalFilm : t.mediaEditor.totalOther}</span>
              <input
                type="number"
                min={0}
                max={100000}
                value={m.total}
                onChange={(e) => set('total', Number(e.target.value))}
                required
              />
            </label>
            <p className="form-hint full-span">{t.mediaEditor.airingHint}</p>
            <label className="check-line full-span">
              <Checkbox checked={m.priority} onCheckedChange={(v) => set('priority', v === true)} />
              <Flame size={16} className="accent-text" />
              {t.mediaEditor.priority}
            </label>
            <label className="field full-span">
              <span>{t.mediaEditor.notes}</span>
              <textarea
                value={m.notes}
                onChange={(e) => set('notes', e.target.value)}
                maxLength={2000}
                placeholder={t.mediaEditor.notesPlaceholder}
              />
            </label>
            {m.sourceUrl && (
              <a className="source-link full-span" href={m.sourceUrl} target="_blank" rel="noreferrer">
                {t.mediaEditor.viewCatalogEntry}
              </a>
            )}
          </div>
          {formError && (
            <p className="notice danger" role="alert">
              {formError}
            </p>
          )}
          <div className="modal-actions mt-24">
            <button type="button" className="secondary" onClick={onClose}>
              {t.common.cancel}
            </button>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? <LoaderCircle className="loading-icon" size={16} /> : <Check size={16} />}
              {t.common.save}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function SessionEditor({
  state,
  data,
  saving,
  onClose,
  onSave,
}: {
  state: WatchState;
  data: { date: string; mediaId?: string; session?: Session };
  saving: boolean;
  onClose: () => void;
  onSave: (s: Session) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const chosen = state.media.find((m) => m.id === data.mediaId) || state.media[0];
  const [id, setId] = useState(chosen?.id || '');
  const [date, setDate] = useState(data.date);
  const [time, setTime] = useState(data.session?.time || state.settings.time);
  const nextFor = (id: string) => {
    const m = state.media.find((m) => m.id === id);
    return m
      ? Math.max(
          m.progress,
          ...state.sessions.filter((s) => s.mediaId === id && s.id !== data.session?.id).map((s) => s.to),
        ) + 1
      : 1;
  };
  const [from, setFrom] = useState(data.session?.from || nextFor(id));
  const [to, setTo] = useState(data.session?.to || nextFor(id));
  const [err, setErr] = useState('');
  const m = state.media.find((m) => m.id === id);
  const duration = m ? Math.max(0, to - from + 1) * m.duration : 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="modal-content">
        <DialogHeader>
          <DialogTitle>{data.session ? t.sessionEditor.editTitle : t.sessionEditor.addTitle}</DialogTitle>
          <DialogDescription>{t.sessionEditor.description(state.settings.timezone)}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setErr('');
            if (!m || from < 1 || to < from || (m.total > 0 && to > m.total) || duration > 1440) {
              setErr(t.sessionEditor.checkUnits);
              return;
            }
            const [a, b] = time.split(':').map(Number);
            const minute = a * 60 + b;
            if (minute + duration > 1440) {
              setErr(t.sessionEditor.beforeMidnight);
              return;
            }
            const overlap = state.sessions.some((s) => {
              if (s.date !== date || s.id === data.session?.id) return false;
              const [h, mi] = s.time.split(':').map(Number);
              const start = h * 60 + mi;
              return minute < start + s.duration && minute + duration > start;
            });
            if (overlap) {
              setErr(t.sessionEditor.overlap);
              return;
            }
            await onSave({
              id: data.session?.id || crypto.randomUUID(),
              mediaId: id,
              date,
              time,
              from,
              to,
              duration,
              done: data.session?.done || false,
            });
          }}
        >
          <div className="form-grid">
            <label className="field full-span">
              <span>{t.common.title}</span>
              <Choice
                value={id}
                onChange={(v) => {
                  setId(v);
                  const n = nextFor(v);
                  setFrom(n);
                  setTo(n);
                }}
                label={t.sessionEditor.titleAria}
                options={Object.fromEntries(state.media.map((m) => [m.id, m.title]))}
              />
            </label>
            <label className="field">
              <span>{t.sessionEditor.day}</span>
              <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field">
              <span>{t.sessionEditor.time}</span>
              <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
            <label className="field">
              <span>{m?.kind === 'manga' ? t.sessionEditor.firstChapter : t.sessionEditor.firstEpisode}</span>
              <input
                type="number"
                min={1}
                max={m?.total || 100000}
                required
                value={from}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setFrom(n);
                  if (n > to) setTo(n);
                }}
              />
            </label>
            <label className="field">
              <span>{m?.kind === 'manga' ? t.sessionEditor.lastChapter : t.sessionEditor.lastEpisode}</span>
              <input
                type="number"
                min={from}
                max={m?.total || 100000}
                required
                value={to}
                onChange={(e) => setTo(Number(e.target.value))}
              />
            </label>
          </div>
          <p className="notice">
            <Clock3 size={15} className="inline mr-2" />
            {t.sessionEditor.plannedMinutes(duration, state.settings.budget)}
          </p>
          {err && (
            <p className="form-hint danger" role="alert">
              {err}
            </p>
          )}
          <div className="modal-actions mt-24">
            <button type="button" className="secondary" onClick={onClose}>
              {t.common.cancel}
            </button>
            <button type="submit" className="primary" disabled={saving || !m}>
              <CalendarPlus size={16} />
              {t.common.save}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function SettingsEditor({
  initial,
  onClose,
  onSave,
  saving,
}: {
  initial: Settings;
  onClose: () => void;
  onSave: (s: Settings) => Promise<void>;
  saving: boolean;
}) {
  const { t } = useI18n();
  const [s, setS] = useState(initial);
  const [error, setError] = useState('');
  // Keep a saved zone selectable even if it is not in the suggested list.
  const zones: Record<string, string> = { ...t.settingsEditor.timezones };
  if (!zones[s.timezone]) zones[s.timezone] = s.timezone;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="modal-content">
        <DialogHeader>
          <DialogTitle>{t.settingsEditor.title}</DialogTitle>
          <DialogDescription>{t.settingsEditor.description}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!s.days.length) {
              setError(t.settingsEditor.pickDay);
              return;
            }
            try {
              new Intl.DateTimeFormat('fr', { timeZone: s.timezone });
            } catch {
              setError(t.settingsEditor.badTimezone);
              return;
            }
            onSave(s);
          }}
        >
          <div className="form-grid">
            <label className="field">
              <span>{t.settingsEditor.minutesPerDay}</span>
              <input
                type="number"
                min={15}
                max={600}
                required
                value={s.budget}
                onChange={(e) => setS({ ...s, budget: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span>{t.settingsEditor.usualTime}</span>
              <input
                type="time"
                required
                value={s.time}
                onChange={(e) => setS({ ...s, time: e.target.value })}
              />
            </label>
            <div className="field full-span">
              <span>{t.settingsEditor.availableDays}</span>
              <div className="day-choices">
                {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                  <label className="day-choice" key={day}>
                    <Checkbox
                      checked={s.days.includes(day)}
                      onCheckedChange={(v) =>
                        setS({ ...s, days: v ? [...s.days, day] : s.days.filter((x) => x !== day) })
                      }
                    />
                    {t.weekdaysShort[day]}
                  </label>
                ))}
              </div>
            </div>
            <label className="field full-span">
              <span>{t.settingsEditor.timezone}</span>
              <Choice
                value={s.timezone}
                onChange={(v) => setS({ ...s, timezone: v })}
                label={t.settingsEditor.timezone}
                options={zones}
              />
            </label>
            <label className="check-line full-span">
              <Switch checked={s.reminders} onCheckedChange={(v) => setS({ ...s, reminders: v })} />
              {t.settingsEditor.remindersOpen}
            </label>
          </div>
          {error && <p className="notice danger">{error}</p>}
          <div className="modal-actions mt-24">
            <button type="button" className="secondary" onClick={onClose}>
              {t.common.cancel}
            </button>
            <button type="submit" className="primary" disabled={saving}>
              {t.common.save}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
function Assistant({
  aiReady,
  state,
  onPlanning,
  expectedUserId,
}: {
  aiReady: boolean;
  state: WatchState;
  onPlanning: () => void;
  expectedUserId: string;
}) {
  const { t } = useI18n();
  const [key, setKey] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'model'; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [failed, setFailed] = useState('');
  const chatEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, busy]);
  const ask = async (text: string) => {
    if (!text.trim() || busy) return;
    if (!aiReady && (!key.trim() || !confirmed)) {
      setErr(t.assistant.needKey);
      return;
    }
    setBusy(true);
    setErr('');
    setFailed('');
    const history = messages.slice(-8);
    try {
      const r = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, apiKey: key.trim() || undefined, history, expectedUserId }),
      });
      const data: any = await r.json();
      if (!r.ok) throw new Error(data.error || t.assistant.unavailable);
      setMessages((m) => [...m, { role: 'user', text }, { role: 'model', text: data.text }]);
      setQuestion('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.assistant.unavailable);
      setFailed(text);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ai-layout">
      <section className="panel ai-main">
        {!messages.length ? (
          <div className="ai-intro">
            <div className="sparkle-box">
              <Sparkles size={30} />
            </div>
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
                {m.role === 'model' && <span className="chat-label">GEMINI · AFTERWATCH</span>}
                {m.text}
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
        <p className="form-hint mt-24">{t.assistant.disclaimer}</p>
      </section>
      <aside className="panel key-panel">
        <h2>
          <KeyRound size={19} />
          {aiReady ? t.assistant.connected : t.assistant.connect}
        </h2>
        <div className="key-details">
          {!aiReady ? (
            <div>
              <p>
                {t.assistant.createKeyBefore}{' '}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                  Google AI Studio
                </a>{' '}
                {t.assistant.createKeyAfter}
              </p>
              <label className="field">
                <span>{t.assistant.keyLabel}</span>
                <input
                  type="password"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={t.assistant.keyPlaceholder}
                />
              </label>
              <p className="form-hint">{t.assistant.keyHint}</p>
              <label className="check-line">
                <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} />
                <span className="form-hint">{t.assistant.freeTier}</span>
              </label>
            </div>
          ) : (
            <p>{t.assistant.serverConfigured}</p>
          )}
          <div>
            <div className="notice">{t.assistant.quota}</div>
            <p>{t.assistant.data}</p>
            <a
              className="form-hint"
              href="https://ai.google.dev/gemini-api/docs/pricing"
              target="_blank"
              rel="noreferrer"
            >
              {t.assistant.terms}
            </a>
            <div className="divider mt-24" />
            <p>{t.assistant.withoutAi}</p>
            <button className="secondary full" onClick={onPlanning}>
              <CalendarDays size={16} />
              {t.assistant.autoPlanning}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
