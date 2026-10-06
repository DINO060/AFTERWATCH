'use client';
import { useEffect, useState } from 'react';
import { Bell, BellOff, LoaderCircle, Mail, Smartphone } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useI18n } from './i18n-provider';

type Prefs = {
  email_reminders: boolean;
  email_new_episodes: boolean;
  email_weekly: boolean;
  push_reminders: boolean;
  push_new_episodes: boolean;
};
type Settings = {
  prefs: Prefs;
  emailAvailable: boolean;
  pushAvailable: boolean;
  vapidPublicKey: string | null;
};
type Device = 'checking' | 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on';

/** The VAPID public key is base64url; the Push API wants its bytes. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export default function NotificationSettings() {
  const { t, lang } = useI18n();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [device, setDevice] = useState<Device>('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    fetch('/api/notifications/prefs', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: Settings) => live && setSettings(data))
      .catch(() => live && setError(t.notify.saveFailed));
    (async () => {
      const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
      const ios =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const installed =
        window.matchMedia('(display-mode: standalone)').matches ||
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
      // iPhone and iPad only allow web push for apps added to the Home Screen.
      if (!supported) return setDevice(ios && !installed ? 'ios-install' : 'unsupported');
      if (Notification.permission === 'denied') return setDevice('denied');
      try {
        setDevice((await currentSubscription()) ? 'on' : 'off');
      } catch {
        setDevice('unsupported');
      }
    })();
    return () => {
      live = false;
    };
    // The texts only matter for the first error message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (prefs: Prefs) => {
    if (!settings) return;
    const previous = settings.prefs;
    setSettings({ ...settings, prefs });
    setError('');
    try {
      const response = await fetch('/api/notifications/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...prefs, lang }),
      });
      if (!response.ok) throw new Error('save failed');
    } catch {
      setSettings((s) => (s ? { ...s, prefs: previous } : s));
      setError(t.notify.saveFailed);
    }
  };
  const toggle = (field: keyof Prefs) => (value: boolean) =>
    settings && save({ ...settings.prefs, [field]: value });

  const enablePush = async () => {
    if (!settings?.vapidPublicKey || busy) return;
    setBusy(true);
    setError('');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setDevice(permission === 'denied' ? 'denied' : 'off');
        return;
      }
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(settings.vapidPublicKey),
      });
      const response = await fetch('/api/notifications/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!response.ok) {
        await subscription.unsubscribe();
        throw new Error('subscription refused');
      }
      setDevice('on');
      // First device: turn on both phone alerts so the button does something visible.
      if (!settings.prefs.push_reminders && !settings.prefs.push_new_episodes)
        await save({ ...settings.prefs, push_reminders: true, push_new_episodes: true });
    } catch {
      setError(t.notify.pushFailed);
    } finally {
      setBusy(false);
    }
  };
  const disablePush = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const subscription = await currentSubscription();
      if (subscription) {
        await fetch('/api/notifications/push', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setDevice('off');
    } catch {
      setError(t.notify.pushFailed);
    } finally {
      setBusy(false);
    }
  };

  const row = (field: keyof Prefs, label: string, disabled: boolean) => (
    <div className="settings-row" key={field}>
      <div>
        <h3>{label}</h3>
      </div>
      <Switch
        checked={Boolean(settings?.prefs[field])}
        disabled={disabled || !settings}
        aria-label={label}
        onCheckedChange={toggle(field)}
      />
    </div>
  );
  const emailOff = !settings?.emailAvailable;
  const pushOff = !settings?.pushAvailable || device !== 'on';

  return (
    <section className="panel notification-settings" aria-label={t.notify.settingsTitle}>
      <div className="section-heading">
        <h2>
          <Bell size={19} />
          {t.notify.settingsTitle}
        </h2>
      </div>
      <p className="subdued">{t.notify.settingsIntro}</p>

      <h3 className="settings-group">
        <Mail size={16} />
        {t.notify.emailHeading}
      </h3>
      {emailOff && settings && <p className="form-hint">{t.notify.emailUnavailable}</p>}
      {row('email_reminders', t.notify.reminders, emailOff)}
      {row('email_new_episodes', t.notify.newEpisodes, emailOff)}
      {row('email_weekly', t.notify.weekly, emailOff)}

      <h3 className="settings-group">
        <Smartphone size={16} />
        {t.notify.pushHeading}
      </h3>
      {device === 'ios-install' ? (
        <p className="notice">{t.notify.pushIosHint}</p>
      ) : device === 'unsupported' || (settings && !settings.pushAvailable) ? (
        <p className="form-hint">{t.notify.pushUnavailable}</p>
      ) : device === 'denied' ? (
        <p className="notice danger">{t.notify.pushDenied}</p>
      ) : device === 'on' ? (
        <div className="row flex-wrap">
          <p className="inline-note">{t.notify.pushOn}</p>
          <button className="ghost-btn small-btn" onClick={disablePush} disabled={busy}>
            {busy ? <LoaderCircle size={15} className="loading-icon" /> : <BellOff size={15} />}
            {t.notify.pushDisable}
          </button>
        </div>
      ) : device === 'off' ? (
        <button className="secondary" onClick={enablePush} disabled={busy || !settings?.vapidPublicKey}>
          {busy ? <LoaderCircle size={16} className="loading-icon" /> : <Bell size={16} />}
          {t.notify.pushEnable}
        </button>
      ) : null}
      {row('push_reminders', t.notify.reminders, pushOff)}
      {row('push_new_episodes', t.notify.newEpisodes, pushOff)}

      <p className="form-hint mt-24">{t.notify.episodesHint}</p>
      {error && (
        <p className="notice danger" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
