import type { AuthError } from '@supabase/supabase-js';
import { createSupabaseBrowserClient } from './supabase/browser';
import { cleanDisplayName } from './display-name';

/** Ends the session on the server, then drops the browser client's cached copy. */
export async function signOut(): Promise<void> {
  const response = await fetch('/api/auth/signout', { method: 'POST' });
  if (!response.ok) throw new Error('Signout failed');
  await createSupabaseBrowserClient()?.auth.signOut({ scope: 'local' });
}

/** Saves the name the member chose; returns it as stored. Throws RangeError when it is empty. */
export async function saveDisplayName(value: string): Promise<string> {
  const name = cleanDisplayName(value);
  if (!name) throw new RangeError('Empty display name');
  const { error } = await client().auth.updateUser({ data: { display_name: name } });
  if (error) throw error;
  return name;
}

function client() {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) throw new Error('Sign-in unavailable');
  return supabase;
}
const callbackUrl = () => `${window.location.origin}/auth/callback`;

export async function logInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await client().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
}

/** Creates the account; Supabase e-mails a confirmation link before the first log-in. */
export async function signUpWithPassword(email: string, password: string, name: string): Promise<void> {
  const displayName = cleanDisplayName(name);
  const { error } = await client().auth.signUp({
    email: email.trim(),
    password,
    options: { emailRedirectTo: callbackUrl(), data: displayName ? { display_name: displayName } : {} },
  });
  if (error) throw error;
}

/** Sends a reset link; the callback opens the "new password" form after verifying it. */
export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await client().auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${callbackUrl()}?next=${encodeURIComponent('/?auth=recovery')}`,
  });
  if (error) throw error;
}

export async function setPassword(password: string): Promise<void> {
  const { error } = await client().auth.updateUser({ password });
  if (error) throw error;
}

type AuthTextKey =
  | 'invalidCredentials'
  | 'emailNotConfirmed'
  | 'weakPassword'
  | 'samePassword'
  | 'tooManyRequests'
  | 'invalidEmail'
  | 'signupDisabled';

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
  return null;
}
