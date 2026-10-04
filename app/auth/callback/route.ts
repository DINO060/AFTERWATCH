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

  if (supabase) {
    try {
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        verified = !error;
      } else if (tokenHash && url.searchParams.get('type') === 'email') {
        // Supports the recommended token-hash Magic Link email template too.
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
        verified = !error;
      }
    } catch {
      verified = false;
    }
  }

  const destination = new URL(verified ? returnPath : '/?auth_error=callback', url.origin);
  const response = NextResponse.redirect(destination);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
