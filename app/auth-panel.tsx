'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Provider } from '@supabase/supabase-js';
import { Check, Link2, LoaderCircle, LogOut, Mail, Send } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { saveDisplayName, signOut as endSession } from '@/lib/auth-actions';
import { DISPLAY_NAME_MAX } from '@/lib/display-name';
import { getTelegramProvider } from '@/lib/supabase/config';
import type { Messages } from '@/lib/i18n';
import { useI18n } from './i18n-provider';

// Messages are kept as keys so they follow a language switch while on screen.
type AuthText = keyof Messages['auth'];

export type AccountUser = {
  id: string;
  email: string | null;
  displayName: string;
  telegramLinked: boolean;
};

export type AuthStatus = {
  user: AccountUser | null;
  configured: boolean;
  telegramEnabled: boolean;
  googleEnabled: boolean;
};
export type AuthPanelProps = AuthStatus & { onAuthChange?: () => void; onProfileChange?: () => void };

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

export function AuthPanel({
  user,
  configured,
  telegramEnabled,
  googleEnabled,
  onAuthChange,
  onProfileChange,
}: AuthPanelProps) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [name, setName] = useState(user?.displayName || '');
  const [busy, setBusy] = useState<'email' | 'telegram' | 'google' | 'signout' | 'name' | null>(null);
  const [message, setMessage] = useState<AuthText | ''>('');
  const [error, setError] = useState<AuthText | ''>('');
  const knownUserId = useRef(user?.id || null);
  const authChange = useRef(onAuthChange);

  useEffect(() => {
    knownUserId.current = user?.id || null;
    authChange.current = onAuthChange;
  }, [user?.id, onAuthChange]);

  useEffect(() => {
    const authError = new URLSearchParams(window.location.search).get('auth_error');
    if (authError !== null) {
      setError(
        authError === 'expired' ? 'linkExpired' : authError === 'browser' ? 'linkOtherBrowser' : 'linkFailed',
      );
      const url = new URL(window.location.href);
      url.searchParams.delete('auth_error');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return;
      const nextUserId = session?.user.id || null;
      if (nextUserId === knownUserId.current) return;
      knownUserId.current = nextUserId;
      // Defer outside the auth callback; consumers can clear all private state.
      window.setTimeout(() => {
        if (authChange.current) authChange.current();
        else window.location.reload();
      }, 0);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function sendEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    setBusy('email');
    setError('');
    setMessage('');
    try {
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback`, shouldCreateUser: true },
      });
      if (authError) throw authError;
      setMessage('emailSent');
    } catch (cause) {
      const { code, status } = (cause ?? {}) as { code?: string; status?: number };
      console.warn('Afterwatch e-mail sign-in failed', code || status || 'unknown');
      if (status === 429 || code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
        setError('tooManyRequests');
      } else if (code === 'email_address_invalid' || code === 'validation_failed') {
        setError('invalidEmail');
      } else if (code === 'email_address_not_authorized') {
        setError('emailNotOpen');
      } else if (code === 'signup_disabled') {
        setError('signupDisabled');
      } else {
        setError('sendFailed');
      }
    } finally {
      setBusy(null);
    }
  }

  async function connectTelegram() {
    if (busy) return;
    const supabase = createSupabaseBrowserClient();
    const provider = getTelegramProvider();
    if (!supabase || !provider || !telegramEnabled) return;
    setBusy('telegram');
    setError('');
    setMessage('');
    try {
      const options = { redirectTo: `${window.location.origin}/auth/callback`, skipBrowserRedirect: true };
      const { data, error: authError } = user
        ? await supabase.auth.linkIdentity({ provider: provider as Provider, options })
        : await supabase.auth.signInWithOAuth({ provider: provider as Provider, options });
      if (authError || !data.url) throw authError || new Error('Missing redirect');
      window.location.assign(data.url);
    } catch {
      setError(user ? 'telegramLinkFailed' : 'telegramUnavailable');
      setBusy(null);
    }
  }

  async function connectGoogle() {
    if (busy) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase || !googleEnabled) return;
    setBusy('google');
    setError('');
    setMessage('');
    try {
      // Supabase links this identity to an existing account with the same verified e-mail.
      const { data, error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback`, skipBrowserRedirect: true },
      });
      if (authError || !data.url) throw authError || new Error('Missing redirect');
      window.location.assign(data.url);
    } catch {
      setError('googleUnavailable');
      setBusy(null);
    }
  }

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setMessage('');
    setBusy('name');
    try {
      setName(await saveDisplayName(name));
      setMessage('nameSaved');
      onProfileChange?.();
    } catch (cause) {
      setError(cause instanceof RangeError ? 'nameInvalid' : 'nameFailed');
    } finally {
      setBusy(null);
    }
  }

  async function signOut() {
    if (busy) return;
    setBusy('signout');
    setError('');
    try {
      await endSession();
      knownUserId.current = null;
      if (onAuthChange) onAuthChange();
      else window.location.reload();
    } catch {
      setError('signoutFailed');
      setBusy(null);
    }
  }

  return (
    <section className="panel" aria-label={t.auth.panelAria}>
      <div className="section-heading">
        <h2>
          <Mail size={19} />
          {user ? t.auth.myAccount : t.auth.signInTitle}
        </h2>
      </div>
      {!configured ? (
        <p className="subdued">{t.auth.notConfigured}</p>
      ) : user ? (
        <>
          <p className="subdued">
            {t.auth.signedInAs} <strong>{user.displayName}</strong>
            {user.email && <> · {user.email}</>}
            {t.auth.accountNote}
          </p>
          <form className="name-form mt-24" onSubmit={saveName}>
            <label className="field">
              <span>{t.auth.nameLabel}</span>
              <span className="name-row">
                <input
                  value={name}
                  maxLength={DISPLAY_NAME_MAX}
                  autoComplete="nickname"
                  required
                  onChange={(event) => setName(event.target.value)}
                  disabled={Boolean(busy)}
                />
                <button
                  className="primary"
                  type="submit"
                  disabled={Boolean(busy) || name.trim() === user.displayName}
                >
                  {busy === 'name' ? (
                    <LoaderCircle className="loading-icon" size={16} />
                  ) : (
                    <Check size={16} />
                  )}
                  {t.common.save}
                </button>
              </span>
            </label>
            <p className="form-hint">{t.auth.nameHint}</p>
          </form>
          {user.telegramLinked && (
            <p className="inline-note">
              <Link2 size={16} />
              {t.auth.telegramLinked}
            </p>
          )}
          <div className="row flex-wrap mt-24">
            {telegramEnabled && !user.telegramLinked && (
              <button className="secondary" type="button" disabled={Boolean(busy)} onClick={connectTelegram}>
                {busy === 'telegram' ? (
                  <LoaderCircle className="loading-icon" size={16} />
                ) : (
                  <Link2 size={16} />
                )}
                {t.auth.linkTelegram}
              </button>
            )}
            <button className="secondary" type="button" disabled={Boolean(busy)} onClick={signOut}>
              {busy === 'signout' ? (
                <LoaderCircle className="loading-icon" size={16} />
              ) : (
                <LogOut size={16} />
              )}
              {t.auth.signOut}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="subdued">{t.auth.intro}</p>
          {googleEnabled && (
            <>
              <button
                className="secondary full mt-24"
                type="button"
                disabled={Boolean(busy)}
                onClick={connectGoogle}
              >
                {busy === 'google' ? <LoaderCircle className="loading-icon" size={16} /> : <GoogleIcon />}
                {t.auth.continueGoogle}
              </button>
              <p className="form-hint">{t.auth.orEmail}</p>
            </>
          )}
          <form onSubmit={sendEmail}>
            <label className="field">
              <span>{t.auth.emailLabel}</span>
              <input
                type="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t.auth.emailPlaceholder}
                disabled={Boolean(busy)}
              />
            </label>
            <button className="primary mt-24" type="submit" disabled={Boolean(busy)}>
              {busy === 'email' ? <LoaderCircle className="loading-icon" size={16} /> : <Mail size={16} />}
              {t.auth.sendLink}
            </button>
          </form>
          {telegramEnabled && (
            <button
              className="secondary mt-24"
              type="button"
              disabled={Boolean(busy)}
              onClick={connectTelegram}
            >
              {busy === 'telegram' ? <LoaderCircle className="loading-icon" size={16} /> : <Send size={16} />}
              {t.auth.continueTelegram}
            </button>
          )}
          {telegramEnabled && <p className="form-hint">{t.auth.telegramHint}</p>}
        </>
      )}
      {message && (
        <p className="notice" role="status">
          {t.auth[message]}
        </p>
      )}
      {error && (
        <p className="notice danger" role="alert">
          {t.auth[error]}
        </p>
      )}
    </section>
  );
}

export default AuthPanel;
