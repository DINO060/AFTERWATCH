import { timingSafeEqual } from 'node:crypto';
import { runNotifications } from '@/lib/notify/run';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Called every 10 minutes by Supabase (pg_cron + pg_net) with "Authorization: Bearer <CRON_SECRET>".
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 32) return false;
  const given = Buffer.from(request.headers.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function handle(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const site = process.env.SITE_URL?.trim() || new URL(request.url).origin;
    const summary = await runNotifications(site);
    console.info('notify_run', summary);
    return Response.json(summary, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('notify_run_failed', error instanceof Error ? error.message : 'unknown');
    // Only the scheduled caller sees this: the failing step and Supabase's error code, never data.
    return Response.json(
      { error: 'Run failed', step: error instanceof Error ? error.message.slice(0, 120) : 'unknown' },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
