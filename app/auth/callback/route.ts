import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { safeReturnPath } from '@/lib/auth-redirect';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const supabase = await createSupabaseServerClient();
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const returnPath = safeReturnPath(url.searchParams.get('next'));
  let verified = false;
  // Supabase redirects here with error_code when the link itself was rejected (e.g. already used).
  let failure = url.searchParams.get('error_code') || (code || tokenHash ? 'unknown' : 'missing_code');

  if (supabase) {
    try {
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        verified = !error;
        if (error) failure = error.code || String(error.status || 'unknown');
      } else if (tokenHash && url.searchParams.get('type') === 'email') {
        // Supports the recommended token-hash Magic Link email template too.
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
        verified = !error;
        if (error) failure = error.code || String(error.status || 'unknown');
      }
    } catch {
      verified = false;
    }
  }

  let reason = 'callback';
  if (!verified) {
    console.warn('auth_callback_failed', failure.slice(0, 60));
    if (['otp_expired', 'flow_state_expired', 'flow_state_not_found'].includes(failure)) reason = 'expired';
    else if (['pkce_code_verifier_not_found', 'bad_code_verifier'].includes(failure)) reason = 'browser';
  }
  const destination = new URL(verified ? returnPath : `/?auth_error=${reason}`, url.origin);
  const response = NextResponse.redirect(destination);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
