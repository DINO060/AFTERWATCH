import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { catalogDetail, tmdbEnabled } from '@/lib/catalog-server';
import { parseRefPath, type TargetRef } from '@/lib/community';
import { messages } from '@/lib/i18n';
import { requestLang } from '@/lib/i18n-server';
import WatchApp from '../../watch-app';

type Props = { params: Promise<{ slug: string[] }> };
const refOf = async ({ params }: Props) => parseRefPath(`/oeuvre/${(await params).slug.join('/')}`);

/** The preview a messaging app shows for a shared discussion: public catalog title and poster only. */
export async function generateMetadata(props: Props): Promise<Metadata> {
  const ref = await refOf(props);
  if (!ref) return {};
  const lang = await requestLang();
  const c = messages[lang].community;
  try {
    const item = await catalogDetail(ref.kind, ref.source, ref.sourceId, lang);
    const part =
      ref.episode === null
        ? ''
        : ref.kind === 'series'
          ? ` · ${c.seasonEpisode(ref.season ?? 0)} ${ref.episode}`
          : ` · ${c.episode} ${ref.episode}`;
    const title = `${item.title}${part} — ${c.discussion}`;
    return {
      title: `${title} · Afterwatch`,
      openGraph: { title, siteName: 'Afterwatch', images: item.poster ? [{ url: item.poster }] : [] },
      twitter: { card: 'summary', title, images: item.poster ? [item.poster] : [] },
    };
  } catch {
    return { title: `${c.discussion} · Afterwatch` };
  }
}

export default async function Page(props: Props) {
  const ref: TargetRef | null = await refOf(props);
  if (!ref) notFound();
  return <WatchApp tmdb={tmdbEnabled()} initialRef={ref} />;
}
