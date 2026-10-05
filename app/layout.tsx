import type { Metadata } from 'next';
import './globals.css';
import { messages } from '@/lib/i18n';
import { requestLang } from '@/lib/i18n-server';
import { I18nProvider } from './i18n-provider';

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
  return (
    <html lang={lang} className="dark">
      <body>
        <I18nProvider initialLang={lang}>{children}</I18nProvider>
      </body>
    </html>
  );
}
