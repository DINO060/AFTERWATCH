// E-mail and phone notification content. Type imports only, so the tests can load it directly;
// the caller passes the texts of the member's language.
import type { Messages } from '../i18n';
import type { Media, Session } from '../watch';

export type Note = { subject: string; body: string; url: string; html: string; text: string };

/** Titles and notes come from members: everything placed in HTML is escaped. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(
  t: Messages,
  heading: string,
  paragraphs: string[],
  button: { label: string; url: string },
  unsubscribeUrl: string,
): string {
  const p = paragraphs
    .map((line) => `<p style="margin:0 0 12px;color:#c9ccd6;line-height:1.6">${escapeHtml(line)}</p>`)
    .join('');
  return `<div style="margin:0;padding:32px 16px;background:#0d0e12;font-family:Arial,Helvetica,sans-serif;color:#f2f2f4">
<div style="max-width:520px;margin:0 auto;background:#16181f;border-radius:16px;padding:32px">
<p style="margin:0 0 24px;font-size:20px;font-weight:bold">afterwatch<span style="color:#ff6a55">.</span></p>
<p style="margin:0 0 12px;font-size:20px;font-weight:bold;line-height:1.3">${escapeHtml(heading)}</p>
${p}
<p style="margin:20px 0 28px"><a href="${escapeHtml(button.url)}" style="display:inline-block;background:#ff6a55;color:#1a0d0a;text-decoration:none;font-weight:bold;padding:14px 22px;border-radius:12px">${escapeHtml(button.label)}</a></p>
<p style="margin:0;color:#8b90a0;font-size:12px;line-height:1.6">${escapeHtml(t.notify.footer)}<br><a href="${escapeHtml(unsubscribeUrl)}" style="color:#8b90a0">${escapeHtml(t.notify.unsubscribe)}</a></p>
</div></div>`;
}

const plain = (heading: string, paragraphs: string[], url: string, t: Messages, unsubscribeUrl: string) =>
  [heading, '', ...paragraphs, '', url, '', `${t.notify.unsubscribe}: ${unsubscribeUrl}`].join('\n');

export function sessionDetail(t: Messages, media: Media, session: Session): string {
  if (media.kind === 'film') return t.kinds.film;
  const unit = t.units[media.kind];
  return session.to > session.from ? `${unit} ${session.from}–${session.to}` : `${unit} ${session.from}`;
}

export function reminderNote(
  t: Messages,
  media: Media,
  session: Session,
  site: string,
  unsubscribeUrl: string,
): Note {
  const subject = t.notify.reminderTitle(media.title);
  const body = t.notify.reminderBody(sessionDetail(t, media, session), session.duration);
  const url = `${site}/`;
  return {
    subject,
    body,
    url,
    html: layout(t, subject, [body], { label: t.notify.openApp, url }, unsubscribeUrl),
    text: plain(subject, [body], url, t, unsubscribeUrl),
  };
}

export function episodeNote(
  t: Messages,
  media: Media,
  episode: { episode: number; season: number | null },
  site: string,
  unsubscribeUrl: string,
): Note {
  const subject = t.notify.episodeTitle(media.title);
  const body = t.notify.episodeBody(t.notify.episodeLabel(episode.episode, episode.season));
  const url = `${site}/`;
  return {
    subject,
    body,
    url,
    html: layout(t, subject, [body], { label: t.notify.openApp, url }, unsubscribeUrl),
    text: plain(subject, [body], url, t, unsubscribeUrl),
  };
}

export function weeklyNote(
  t: Messages,
  locale: string,
  week: { session: Session; media: Media }[],
  priorities: number,
  site: string,
  unsubscribeUrl: string,
): Note {
  const minutes = week.reduce((n, w) => n + w.session.duration, 0);
  const intro = t.notify.weeklyIntro(week.length, minutes);
  const lines = week.map(({ session, media }) => {
    const day = new Date(session.date + 'T12:00:00Z').toLocaleDateString(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    });
    return `${day} · ${session.time} — ${media.title} (${sessionDetail(t, media, session)}, ${session.duration} min)`;
  });
  const paragraphs = [
    intro,
    ...(lines.length ? lines : [t.notify.weeklyEmptyHint]),
    ...(priorities ? [t.notify.weeklyPriorities(priorities)] : []),
  ];
  const url = `${site}/`;
  return {
    subject: t.notify.weeklySubject,
    body: intro,
    url,
    html: layout(
      t,
      t.notify.weeklySubject,
      paragraphs,
      { label: t.notify.openSchedule, url },
      unsubscribeUrl,
    ),
    text: plain(t.notify.weeklySubject, paragraphs, url, t, unsubscribeUrl),
  };
}
