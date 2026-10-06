import { tmdbEnabled } from '@/lib/catalog-server';
import WatchApp from './watch-app';

export default function Page() {
  // Only whether TMDB is configured reaches the browser, never the key.
  return <WatchApp tmdb={tmdbEnabled()} />;
}
