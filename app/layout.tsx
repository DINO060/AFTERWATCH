import type { Metadata } from 'next';
import { preconnect } from 'react-dom';
import { DM_Sans, Sora } from 'next/font/google';
import './globals.css';
import './design-a.css';
import { messages } from '@/lib/i18n';
import { requestLang } from '@/lib/i18n-server';
import { I18nProvider } from './i18n-provider';

// Self-hosted at build time: visitors' browsers never call Google Fonts.
const bodyFont = DM_Sans({ subsets: ['latin', 'latin-ext'], variable: '--font-body', display: 'swap' });
const displayFont = Sora({
  subsets: ['latin', 'latin-ext'],
  weight: ['600', '700'],
  variable: '--font-display',
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const { meta } = messages[await requestLang()];
  return {
    title: meta.title,
    description: meta.description,
    manifest: '/manifest.webmanifest',
    appleWebApp: { capable: true, title: 'Afterwatch', statusBarStyle: 'black-translucent' },
    icons: { icon: '/favicon.svg', shortcut: '/favicon.svg', apple: '/icon-192.png' },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const lang = await requestLang();
  // Posters and banners come from these servers: connect early.
  preconnect('https://media.kitsu.app');
  preconnect('https://image.tmdb.org');
  return (
    <html lang={lang} className={`dark ${bodyFont.variable} ${displayFont.variable}`}>
      <body>
        <I18nProvider initialLang={lang}>{children}</I18nProvider>
      </body>
    </html>
  );
}
