'use client';

import { useEffect, useRef } from 'react';
import { useI18n } from './i18n-provider';

// "Continuer avec Google" drawn by Google itself (Google Identity Services). Google's window then names
// afterwatch.online instead of the Supabase server; the ID token it hands back signs in through Supabase.
// The client ID is public (Google shows it in every sign-in link). Its "Authorized JavaScript origins"
// in Google Cloud must list the site's addresses.
const CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
  '259107953322-fhmeqvdfkdkf8ku5t84i5acgn113tuak.apps.googleusercontent.com';

type Gsi = {
  accounts: {
    id: {
      initialize: (options: Record<string, unknown>) => void;
      renderButton: (box: HTMLElement, options: Record<string, unknown>) => void;
    };
  };
};
declare global {
  interface Window {
    google?: Gsi;
  }
}

let loading: Promise<Gsi> | null = null;
function loadGsi(): Promise<Gsi> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  loading ??= new Promise<Gsi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => (window.google?.accounts?.id ? resolve(window.google) : reject(new Error('gsi')));
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error('gsi'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** A random value for this page, and its SHA-256 for Google: Supabase checks that they match. */
async function makeNonce() {
  const raw = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return { raw, hashed };
}

export function GoogleButton({
  onCredential,
  onUnavailable,
}: {
  /** Google's ID token and the nonce it was made for. */
  onCredential: (token: string, nonce: string) => void;
  /** The Google script could not load (blocked, offline): use the classic redirect instead. */
  onUnavailable: () => void;
}) {
  const { lang } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onCredential, onUnavailable });
  useEffect(() => {
    handlers.current = { onCredential, onUnavailable };
  });

  useEffect(() => {
    let live = true;
    Promise.all([loadGsi(), makeNonce()])
      .then(([gsi, nonce]) => {
        if (!live || !box.current) return;
        gsi.accounts.id.initialize({
          client_id: CLIENT_ID,
          nonce: nonce.hashed,
          use_fedcm_for_button: true,
          callback: (response: { credential?: string }) => {
            if (response.credential) handlers.current.onCredential(response.credential, nonce.raw);
          },
        });
        gsi.accounts.id.renderButton(box.current, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'center',
          width: Math.max(200, Math.min(400, box.current.clientWidth)),
          locale: lang,
        });
      })
      .catch(() => live && handlers.current.onUnavailable());
    return () => {
      live = false;
    };
  }, [lang]);

  return <div ref={box} className="google-box" />;
}
