import type { Metadata } from 'next';
import { tmdbEnabled } from '@/lib/catalog-server';
import WatchApp from '../watch-app';

export const metadata: Metadata = { title: 'Communauté · Afterwatch' };

export default async function Page({ searchParams }: { searchParams: Promise<{ tag?: string | string[] }> }) {
  const { tag } = await searchParams;
  const value =
    typeof tag === 'string' ? tag.replace(/^#/, '').trim().slice(0, 30).toLocaleLowerCase('fr') : '';
  return <WatchApp tmdb={tmdbEnabled()} initialView="community" initialTag={value || null} />;
}
