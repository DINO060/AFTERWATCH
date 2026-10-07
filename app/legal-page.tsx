import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { messages } from '@/lib/i18n';
import { requestLang } from '@/lib/i18n-server';
import { CONTACT_EMAIL, legalDocs, legalPaths, type LegalKind } from '@/lib/legal';

/** E-mail addresses and https links in the text become links; everything else stays plain text. */
function Linked({ text }: { text: string }) {
  const parts = text.split(/(https:\/\/[^\s)]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noreferrer">
            {part.replace(/^https:\/\//, '')}
          </a>
        ) : /@/.test(part) && i % 2 === 1 ? (
          <a key={i} href={`mailto:${part}`}>
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

export async function legalMetadata(kind: LegalKind): Promise<Metadata> {
  const lang = await requestLang();
  return { title: `${legalDocs[lang][kind].title} · Afterwatch` };
}

export default async function LegalPage({ kind }: { kind: LegalKind }) {
  const lang = await requestLang();
  const doc = legalDocs[lang][kind];
  const t = messages[lang].legal;
  return (
    <main className="legal-page">
      <Link className="legal-back" href="/">
        <ArrowLeft size={16} aria-hidden />
        {t.back}
      </Link>
      <h1>{doc.title}</h1>
      <p className="legal-updated">{t.updated(doc.updated)}</p>
      <p className="legal-intro">{doc.intro}</p>
      {doc.sections.map((section) => (
        <section key={section.title}>
          <h2>{section.title}</h2>
          {section.body.map((block, i) =>
            typeof block === 'string' ? (
              <p key={i}>
                <Linked text={block} />
              </p>
            ) : (
              <ul key={i}>
                {block.list.map((item) => (
                  <li key={item}>
                    <Linked text={item} />
                  </li>
                ))}
              </ul>
            ),
          )}
        </section>
      ))}
      <nav className="legal-links" aria-label={t.footerAria}>
        {(Object.keys(legalPaths) as LegalKind[])
          .filter((other) => other !== kind)
          .map((other) => (
            <Link key={other} href={legalPaths[other]}>
              {t[other]}
            </Link>
          ))}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </nav>
    </main>
  );
}
