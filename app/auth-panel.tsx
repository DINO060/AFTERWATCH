'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Provider } from '@supabase/supabase-js';
import { Link2, LoaderCircle, LogOut, Mail, Send } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { getTelegramProvider } from '@/lib/supabase/config';

export type AccountUser = {
  id: string;
  email: string | null;
  displayName: string;
  telegramLinked: boolean;
};

export type AuthStatus = { user: AccountUser | null; configured: boolean; telegramEnabled: boolean };
export type AuthPanelProps = AuthStatus & { onAuthChange?: () => void };

export function AuthPanel({ user, configured, telegramEnabled, onAuthChange }: AuthPanelProps) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<'email' | 'telegram' | 'signout' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const knownUserId = useRef(user?.id || null);
  const authChange = useRef(onAuthChange);

  useEffect(() => {
    knownUserId.current = user?.id || null;
    authChange.current = onAuthChange;
  }, [user?.id, onAuthChange]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('auth_error')) {
      setError('La connexion n’a pas abouti. Demande un nouveau lien ou réessaie.');
      const url = new URL(window.location.href);
      url.searchParams.delete('auth_error');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
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
      setMessage('Vérifie ta boîte mail et les indésirables. Ouvre le lien dans ce navigateur pour te connecter, sans mot de passe.');
    } catch {
      setError('Impossible d’envoyer le lien. Vérifie ton adresse, puis réessaie dans une minute.');
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
      setError(user ? 'Impossible de lier Telegram. Réessaie ou vérifie si ce compte Telegram est déjà lié à un autre compte.' : 'La connexion avec Telegram est indisponible pour le moment.');
      setBusy(null);
    }
  }

  async function signOut() {
    if (busy) return;
    setBusy('signout');
    setError('');
    try {
      const response = await fetch('/api/auth/signout', { method: 'POST' });
      if (!response.ok) throw new Error('Signout failed');
      knownUserId.current = null;
      // Discard the browser client's cached session after server cookies clear.
      await createSupabaseBrowserClient()?.auth.signOut({ scope: 'local' });
      if (onAuthChange) onAuthChange();
      else window.location.reload();
    } catch {
      setError('Impossible de terminer la déconnexion. Réessaie.');
      setBusy(null);
    }
  }

  return <section className="panel" aria-label="Mon compte">
    <div className="section-heading"><h2><Mail size={19} />{user ? 'Mon compte' : 'Connecte-toi à Afterwatch'}</h2></div>
    {!configured ? <p className="subdued">La connexion sera bientôt disponible. Tu peux déjà découvrir le catalogue.</p> : user ? <>
      <p className="subdued">Connecté en tant que <strong>{user.displayName}</strong>{user.email && <> · {user.email}</>}. Ta collection et ton planning restent dans ton compte.</p>
      {user.telegramLinked && <p className="inline-note"><Link2 size={16} />Telegram est lié à ce compte.</p>}
      <div className="row flex-wrap mt-24">
        {telegramEnabled && !user.telegramLinked && <button className="secondary" type="button" disabled={Boolean(busy)} onClick={connectTelegram}>{busy === 'telegram' ? <LoaderCircle className="loading-icon" size={16} /> : <Link2 size={16} />}Lier mon compte Telegram</button>}
        <button className="secondary" type="button" disabled={Boolean(busy)} onClick={signOut}>{busy === 'signout' ? <LoaderCircle className="loading-icon" size={16} /> : <LogOut size={16} />}Se déconnecter</button>
      </div>
    </> : <>
      <p className="subdued">Enregistre ta collection, ta progression et ton planning. Le catalogue reste accessible sans compte.</p>
      <form onSubmit={sendEmail}>
        <label className="field"><span>Adresse e-mail</span><input type="email" autoComplete="email" inputMode="email" autoCapitalize="none" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="toi@exemple.com" disabled={Boolean(busy)} /></label>
        <button className="primary mt-24" type="submit" disabled={Boolean(busy)}>{busy === 'email' ? <LoaderCircle className="loading-icon" size={16} /> : <Mail size={16} />}Recevoir un lien de connexion</button>
      </form>
      {telegramEnabled && <button className="secondary mt-24" type="button" disabled={Boolean(busy)} onClick={connectTelegram}>{busy === 'telegram' ? <LoaderCircle className="loading-icon" size={16} /> : <Send size={16} />}Continuer avec Telegram</button>}
      {telegramEnabled && <p className="form-hint">Tu as déjà un compte par e-mail ? Connecte-toi d’abord, puis lie Telegram pour conserver ta collection.</p>}
    </>}
    {message && <p className="notice" role="status">{message}</p>}
    {error && <p className="notice danger" role="alert">{error}</p>}
  </section>;
}

export default AuthPanel;
