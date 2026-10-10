'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Provider } from '@supabase/supabase-js';
import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  LoaderCircle,
  LogOut,
  Mail,
  Send,
  UserPlus,
} from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { getTelegramProvider } from '@/lib/supabase/config';
import {
  authErrorKey,
  logInWithPassword,
  saveDisplayName,
  sendPasswordReset,
  setPassword as savePassword,
  signOut as endSession,
  signUpWithPassword,
} from '@/lib/auth-actions';
import { DISPLAY_NAME_MAX } from '@/lib/display-name';
import { PASSWORD_MIN, passwordProblem } from '@/lib/password';
import type { Messages } from '@/lib/i18n';
import { legalPaths } from '@/lib/legal';
import { useI18n } from './i18n-provider';

// Messages are kept as keys so they follow a language switch while on screen.
type AuthText = keyof Messages['auth'];
export type AuthMode = 'login' | 'signup';
type Screen = AuthMode | 'forgot' | 'magic';
type Busy = 'login' | 'signup' | 'reset' | 'magic' | 'telegram' | 'google' | 'signout' | 'name' | 'password';

export type AccountUser = {
  id: string;
  email: string | null;
  displayName: string;
  telegramLinked: boolean;
  /** The community profile photo, in the avatar bucket. */
  avatar?: string | null;
};

export type AuthStatus = {
  user: AccountUser | null;
  configured: boolean;
  telegramEnabled: boolean;
  googleEnabled: boolean;
};
export type AuthPanelProps = AuthStatus & {
  onAuthChange?: () => void;
  onProfileChange?: () => void;
  initialMode?: AuthMode;
  /** Opened from a password-reset link: ask for the new password first. */
  recovery?: boolean;
  /** Inside "Mon compte" › Compte: no title, no "signed in as" line, no sign-out button. */
  compact?: boolean;
};

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

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  disabled,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  disabled: boolean;
  hint?: string;
}) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <span className="password-row">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          required
          minLength={autoComplete === 'new-password' ? PASSWORD_MIN : undefined}
          maxLength={128}
          disabled={disabled}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        <button
          type="button"
          className="icon-btn"
          aria-label={shown ? t.auth.hidePassword : t.auth.showPassword}
          aria-pressed={shown}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
      {hint && (
        <span id={`${id}-hint`} className="form-hint">
          {hint}
        </span>
      )}
    </div>
  );
}

export function AuthPanel({
  user,
  configured,
  telegramEnabled,
  googleEnabled,
  onAuthChange,
  onProfileChange,
  initialMode = 'login',
  recovery = false,
  compact = false,
}: AuthPanelProps) {
  const { t } = useI18n();
  const [screen, setScreen] = useState<Screen>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPasswordValue] = useState('');
  const [signupName, setSignupName] = useState('');
  const [name, setName] = useState(user?.displayName || '');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState<Busy | null>(null);
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

  const go = (next: Screen) => {
    setScreen(next);
    setError('');
    setMessage('');
  };
  /** Runs one action with a busy state; maps Supabase errors to a message or the given fallback. */
  async function run(kind: Busy, action: () => Promise<void>, fallback: AuthText, success?: AuthText) {
    if (busy) return;
    setBusy(kind);
    setError('');
    setMessage('');
    try {
      await action();
      if (success) setMessage(success);
    } catch (cause) {
      // A RangeError carries a message key for problems found before calling Supabase.
      if (cause instanceof RangeError) setError(cause.message as AuthText);
      else {
        const key = authErrorKey(cause);
        if (!key) console.warn('Afterwatch auth failed', (cause as { code?: string })?.code || 'unknown');
        setError(key || fallback);
      }
    } finally {
      setBusy(null);
    }
  }
  const checkNewPassword = (value: string) => {
    const problem = passwordProblem(value);
    if (problem) throw new RangeError(problem);
  };

  const logIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    run('login', () => logInWithPassword(email, password), 'sendFailed');
  };
  const signUp = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    run(
      'signup',
      async () => {
        checkNewPassword(password);
        await signUpWithPassword(email, password, signupName);
        setPasswordValue('');
      },
      'sendFailed',
      'signupSent',
    );
  };
  const resetPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    run('reset', () => sendPasswordReset(email), 'sendFailed', 'resetSent');
  };
  const sendMagicLink = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    run(
      'magic',
      async () => {
        const supabase = createSupabaseBrowserClient();
        if (!supabase) throw new Error('Sign-in unavailable');
        const { error: authError } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: { emailRedirectTo: `${window.location.origin}/auth/callback`, shouldCreateUser: true },
        });
        if (authError?.code === 'email_address_not_authorized') throw new RangeError('emailNotOpen');
        if (authError) throw authError;
      },
      'sendFailed',
      'emailSent',
    );
  };
  const changePassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    run(
      'password',
      async () => {
        checkNewPassword(newPassword);
        await savePassword(newPassword);
        setNewPassword('');
      },
      'passwordFailed',
      'passwordSaved',
    );
  };
  const saveName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    run(
      'name',
      async () => {
        try {
          setName(await saveDisplayName(name));
        } catch (cause) {
          throw cause instanceof RangeError ? new RangeError('nameInvalid') : cause;
        }
        onProfileChange?.();
      },
      'nameFailed',
      'nameSaved',
    );
  };

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

  const spinner = (kind: Busy, icon: ReactNode) =>
    busy === kind ? <LoaderCircle className="loading-icon" size={16} /> : icon;
  const emailField = (
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
  );
  const googleButton = googleEnabled && (
    <>
      <button className="secondary full" type="button" disabled={Boolean(busy)} onClick={connectGoogle}>
        {spinner('google', <GoogleIcon />)}
        {t.auth.continueGoogle}
      </button>
      <p className="auth-divider">
        <span>{t.auth.or}</span>
      </p>
    </>
  );
  const passwordForm = (
    <form className="auth-form mt-24" onSubmit={changePassword}>
      <PasswordField
        id="new-password"
        label={recovery ? t.auth.newPasswordLabel : t.auth.passwordSection}
        value={newPassword}
        onChange={setNewPassword}
        autoComplete="new-password"
        disabled={Boolean(busy)}
        hint={recovery ? t.auth.passwordHint : `${t.auth.passwordSectionHint} ${t.auth.passwordHint}`}
      />
      <button className="primary" type="submit" disabled={Boolean(busy) || !newPassword}>
        {spinner('password', <KeyRound size={16} />)}
        {t.common.save}
      </button>
    </form>
  );

  return (
    <section className="panel auth-panel" aria-label={t.auth.panelAria}>
      {!configured ? (
        <>
          <div className="section-heading">
            <h2>
              <Mail size={19} />
              {t.auth.signInTitle}
            </h2>
          </div>
          <p className="subdued">{t.auth.notConfigured}</p>
        </>
      ) : user ? (
        <>
          {recovery && (
            <div className="recovery-box">
              <h2>{t.auth.recoveryTitle}</h2>
              <p className="subdued">{t.auth.recoveryIntro}</p>
              {passwordForm}
            </div>
          )}
          {!compact && (
            <>
              <div className="section-heading">
                <h2>
                  <Mail size={19} />
                  {t.auth.myAccount}
                </h2>
              </div>
              <p className="subdued">
                {t.auth.signedInAs} <strong>{user.displayName}</strong>
                {user.email && <> · {user.email}</>}
                {t.auth.accountNote}
              </p>
            </>
          )}
          <form className={`name-form${compact ? '' : ' mt-24'}`} onSubmit={saveName}>
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
                  {spinner('name', <Check size={16} />)}
                  {t.common.save}
                </button>
              </span>
            </label>
            <p className="form-hint">{t.auth.nameHint}</p>
          </form>
          {!recovery && passwordForm}
          {user.telegramLinked && (
            <p className="inline-note">
              <Link2 size={16} />
              {t.auth.telegramLinked}
            </p>
          )}
          <div className="row flex-wrap mt-24">
            {telegramEnabled && !user.telegramLinked && (
              <button className="secondary" type="button" disabled={Boolean(busy)} onClick={connectTelegram}>
                {spinner('telegram', <Link2 size={16} />)}
                {t.auth.linkTelegram}
              </button>
            )}
            {!compact && (
              <button className="secondary" type="button" disabled={Boolean(busy)} onClick={signOut}>
                {spinner('signout', <LogOut size={16} />)}
                {t.auth.signOut}
              </button>
            )}
          </div>
        </>
      ) : screen === 'forgot' ? (
        <>
          <div className="section-heading">
            <h2>
              <KeyRound size={19} />
              {t.auth.forgotTitle}
            </h2>
          </div>
          <p className="subdued">{t.auth.forgotIntro}</p>
          <form className="auth-form mt-24" onSubmit={resetPassword}>
            {emailField}
            <button className="primary" type="submit" disabled={Boolean(busy)}>
              {spinner('reset', <Mail size={16} />)}
              {t.auth.sendReset}
            </button>
          </form>
          <button className="link-btn mt-24" type="button" onClick={() => go('login')}>
            {t.auth.backToLogin}
          </button>
        </>
      ) : (
        <>
          <div className="auth-tabs" role="tablist" aria-label={t.auth.panelAria}>
            <button
              role="tab"
              aria-selected={screen !== 'signup'}
              className={screen !== 'signup' ? 'on' : ''}
              onClick={() => go('login')}
            >
              {t.auth.tabLogin}
            </button>
            <button
              role="tab"
              aria-selected={screen === 'signup'}
              className={screen === 'signup' ? 'on' : ''}
              onClick={() => go('signup')}
            >
              {t.auth.tabSignup}
            </button>
          </div>
          <h2 className="auth-title">{screen === 'signup' ? t.auth.signupTitle : t.auth.signInTitle}</h2>
          <p className="subdued">{screen === 'signup' ? t.auth.signupIntro : t.auth.intro}</p>
          <div className="auth-form mt-24">
            {googleButton}
            {screen === 'signup' ? (
              <form className="auth-form" onSubmit={signUp}>
                <label className="field">
                  <span>{t.auth.nameOptional}</span>
                  <input
                    value={signupName}
                    maxLength={DISPLAY_NAME_MAX}
                    autoComplete="nickname"
                    onChange={(event) => setSignupName(event.target.value)}
                    disabled={Boolean(busy)}
                  />
                </label>
                {emailField}
                <PasswordField
                  id="signup-password"
                  label={t.auth.passwordLabel}
                  value={password}
                  onChange={setPasswordValue}
                  autoComplete="new-password"
                  disabled={Boolean(busy)}
                  hint={t.auth.passwordHint}
                />
                <button className="primary" type="submit" disabled={Boolean(busy)}>
                  {spinner('signup', <UserPlus size={16} />)}
                  {t.auth.signupButton}
                </button>
                <p className="form-hint">
                  {t.legal.signupBefore}{' '}
                  <a href={legalPaths.terms} target="_blank" rel="noreferrer">
                    {t.legal.signupTerms}
                  </a>{' '}
                  {t.legal.signupAnd}{' '}
                  <a href={legalPaths.privacy} target="_blank" rel="noreferrer">
                    {t.legal.signupPrivacy}
                  </a>
                  .
                </p>
              </form>
            ) : screen === 'magic' ? (
              <form className="auth-form" onSubmit={sendMagicLink}>
                {emailField}
                <button className="primary" type="submit" disabled={Boolean(busy)}>
                  {spinner('magic', <Mail size={16} />)}
                  {t.auth.sendLink}
                </button>
                <button className="link-btn" type="button" onClick={() => go('login')}>
                  {t.auth.passwordInstead}
                </button>
              </form>
            ) : (
              <form className="auth-form" onSubmit={logIn}>
                {emailField}
                <PasswordField
                  id="login-password"
                  label={t.auth.passwordLabel}
                  value={password}
                  onChange={setPasswordValue}
                  autoComplete="current-password"
                  disabled={Boolean(busy)}
                />
                <button className="primary" type="submit" disabled={Boolean(busy)}>
                  {spinner('login', <KeyRound size={16} />)}
                  {t.auth.loginButton}
                </button>
                <div className="auth-links">
                  <button className="link-btn" type="button" onClick={() => go('forgot')}>
                    {t.auth.forgotLink}
                  </button>
                  <button className="link-btn" type="button" onClick={() => go('magic')}>
                    {t.auth.magicLinkInstead}
                  </button>
                </div>
              </form>
            )}
          </div>
          {telegramEnabled && (
            <>
              <button
                className="secondary mt-24"
                type="button"
                disabled={Boolean(busy)}
                onClick={connectTelegram}
              >
                {spinner('telegram', <Send size={16} />)}
                {t.auth.continueTelegram}
              </button>
              <p className="form-hint">{t.auth.telegramHint}</p>
            </>
          )}
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
