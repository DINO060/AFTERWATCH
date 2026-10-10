import type { AuthError } from '@supabase/supabase-js';
import { cleanDisplayName } from './display-name';

// The Supabase library is large: it loads when an action needs it, not with every page.
const browserClient = () => import('./supabase/browser').then((m) => m.createSupabaseBrowserClient());

/** Ends the session on the server, then drops the browser client's cached copy. */
export async function signOut(): Promise<void> {
  const response = await fetch('/api/auth/signout', { method: 'POST' });
  if (!response.ok) throw new Error('Signout failed');
  await (await browserClient())?.auth.signOut({ scope: 'local' });
}

/** Saves the name the member chose; returns it as stored. Throws RangeError when it is empty. */
export async function saveDisplayName(value: string): Promise<string> {
  const name = cleanDisplayName(value);
  if (!name) throw new RangeError('Empty display name');
  const supabase = await client();
  const { error } = await supabase.auth.updateUser({ data: { display_name: name } });
  if (error) throw error;
  return name;
}

async function client() {
  const supabase = await browserClient();
  if (!supabase) throw new Error('Sign-in unavailable');
  return supabase;
}
const callbackUrl = () => `${window.location.origin}/auth/callback`;

// `captchaToken`: the anti-robot check's one-time token (app/captcha.tsx); undefined while it is off.
export async function logInWithPassword(
  email: string,
  password: string,
  captchaToken?: string,
): Promise<void> {
  const supabase = await client();
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
    options: { captchaToken },
  });
  if (error) throw error;
}

/** Creates the account; Supabase e-mails a confirmation link before the first log-in. */
export async function signUpWithPassword(
  email: string,
  password: string,
  name: string,
  captchaToken?: string,
): Promise<void> {
  const displayName = cleanDisplayName(name);
  const supabase = await client();
  const { error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      emailRedirectTo: callbackUrl(),
      data: displayName ? { display_name: displayName } : {},
      captchaToken,
    },
  });
  if (error) throw error;
}

/** Sends a reset link; the callback opens the "new password" form after verifying it. */
export async function sendPasswordReset(email: string, captchaToken?: string): Promise<void> {
  const supabase = await client();
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${callbackUrl()}?next=${encodeURIComponent('/?auth=recovery')}`,
    captchaToken,
  });
  if (error) throw error;
}

export async function setPassword(password: string): Promise<void> {
  const supabase = await client();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

type AuthTextKey =
  | 'invalidCredentials'
  | 'emailNotConfirmed'
  | 'weakPassword'
  | 'samePassword'
  | 'tooManyRequests'
  | 'invalidEmail'
  | 'signupDisabled'
  | 'captchaFailed';

/** Maps a Supabase Auth error to a message key, or null for an unexpected failure. */
export function authErrorKey(cause: unknown): AuthTextKey | null {
  const { code, status } = (cause ?? {}) as Partial<AuthError>;
  if (code === 'invalid_credentials') return 'invalidCredentials';
  if (code === 'email_not_confirmed') return 'emailNotConfirmed';
  if (code === 'weak_password') return 'weakPassword';
  if (code === 'same_password') return 'samePassword';
  if (status === 429 || code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit')
    return 'tooManyRequests';
  if (code === 'email_address_invalid' || code === 'validation_failed') return 'invalidEmail';
  if (code === 'signup_disabled' || code === 'email_provider_disabled') return 'signupDisabled';
  if (code === 'captcha_failed') return 'captchaFailed';
  return null;
}
