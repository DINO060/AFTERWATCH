import type { Metadata } from 'next';
import { tmdbEnabled } from '@/lib/catalog-server';
import WatchApp from '../watch-app';

// Only moderators get content here: the data comes from /api/community, which checks the role.
export const metadata: Metadata = { title: 'Modération · Afterwatch', robots: { index: false } };

export default function Page() {
  return <WatchApp tmdb={tmdbEnabled()} initialView="moderation" />;
}
