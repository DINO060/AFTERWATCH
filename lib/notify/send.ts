// Delivery: e-mail through Resend's API, phone notifications through Web Push. Server-only.
import webpush from 'web-push';
import type { Note } from './messages';

export const emailReady = () => Boolean(process.env.RESEND_API_KEY?.trim());
export const pushReady = () =>
  Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim());
const sender = () => process.env.NOTIFY_FROM?.trim() || 'Afterwatch <notifications@afterwatch.online>';

export async function sendEmail(to: string, note: Note, unsubscribeUrl: string): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY?.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: sender(),
      to: [to],
      subject: note.subject,
      html: note.html,
      text: note.text,
      // One-click unsubscribe (RFC 8058), shown by Gmail and others next to the sender.
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Resend ${response.status}`);
}

let vapidReady = false;
/** 'gone' means the browser dropped the subscription: the caller deletes it. */
export async function sendPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  note: Note,
): Promise<'sent' | 'gone'> {
  if (!vapidReady) {
    webpush.setVapidDetails(
      'mailto:notifications@afterwatch.online',
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!.trim(),
      process.env.VAPID_PRIVATE_KEY!.trim(),
    );
    vapidReady = true;
  }
  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify({ title: note.subject, body: note.body, url: note.url }),
      { TTL: 3600, timeout: 10000 },
    );
    return 'sent';
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return 'gone';
    throw error;
  }
}
