'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from './i18n-provider';

// Cloudflare Turnstile: the anti-robot check before signing up or in. Without a site key nothing is
// shown and no token is sent, which is what Supabase expects while its CAPTCHA protection is off.
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';
export const captchaEnabled = SITE_KEY !== '';

type Turnstile = {
  render: (box: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widget: string) => void;
  remove: (widget: string) => void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let loading: Promise<Turnstile> | null = null;
function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')));
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error('turnstile'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * The check itself. Usually invisible: Cloudflare only shows a box when it needs a click.
 * `onToken` receives a one-time token (null when it expires or fails); change `nonce` to get a new one
 * after each attempt.
 */
export function CaptchaBox({
  nonce,
  onToken,
  onFail,
}: {
  nonce: number;
  onToken: (token: string | null) => void;
  onFail: () => void;
}) {
  const { lang } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const handlers = useRef({ onToken, onFail });
  // Empty most of the time: the form only makes room for it when Cloudflare shows something.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    handlers.current = { onToken, onFail };
  });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const watch = new ResizeObserver(() => setShown(el.getBoundingClientRect().height > 0));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  useEffect(() => {
    if (!captchaEnabled) return;
    let live = true;
    loadTurnstile()
      .then((turnstile) => {
        if (!live || !box.current) return;
        widget.current = turnstile.render(box.current, {
          sitekey: SITE_KEY,
          theme: 'dark',
          language: lang,
          appearance: 'interaction-only',
          size: 'flexible',
          callback: (token: string) => handlers.current.onToken(token),
          'expired-callback': () => handlers.current.onToken(null),
          'error-callback': () => {
            handlers.current.onToken(null);
            handlers.current.onFail();
          },
        });
      })
      .catch(() => live && handlers.current.onFail());
    return () => {
      live = false;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [lang]);

  // A token works once: a new attempt needs a new one.
  useEffect(() => {
    if (nonce > 0 && widget.current) window.turnstile?.reset(widget.current);
  }, [nonce]);

  if (!captchaEnabled) return null;
  return <div ref={box} className={`captcha-box${shown ? ' shown' : ''}`} />;
}
