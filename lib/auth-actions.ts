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
  const supabase = createSupabaseBrowserClient();
  if (!supabase) throw new Error('Sign-in unavailable');
  const { error } = await supabase.auth.updateUser({ data: { display_name: name } });
  if (error) throw error;
  return name;
}
