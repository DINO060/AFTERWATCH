import type { Metadata } from 'next';
import { tmdbEnabled } from '@/lib/catalog-server';
import WatchApp from '../watch-app';

export const metadata: Metadata = { title: 'Communauté · Afterwatch' };

export default function Page() {
  return <WatchApp tmdb={tmdbEnabled()} initialView="community" />;
}
