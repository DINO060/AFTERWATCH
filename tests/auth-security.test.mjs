import test from 'node:test';
import assert from 'node:assert/strict';
import { safeReturnPath } from '../lib/auth-redirect.ts';
import { assertSameOrigin } from '../lib/auth-origin.ts';
import { assertExpectedUser } from '../lib/auth-owner.ts';
import { getSupabaseConfig, getTelegramProvider } from '../lib/supabase/config.ts';
import { cleanDisplayName } from '../lib/display-name.ts';

test('display names are trimmed, single-spaced, capped and free of invisible characters', () => {
  const zeroWidth = String.fromCharCode(0x200b);
  const rtlOverride = String.fromCharCode(0x202e);
  assert.equal(cleanDisplayName('  John   Diverson  '), 'John Diverson');
  assert.equal(cleanDisplayName(`Jo${zeroWidth}hn${rtlOverride}`), 'John');
  assert.equal(cleanDisplayName('a\nb\tc'), 'a b c');
  assert.equal(cleanDisplayName('x'.repeat(60)).length, 40);
  assert.equal(cleanDisplayName('🎬'.repeat(45)), '🎬'.repeat(40), 'emoji count as one character');
  for (const value of [undefined, null, 42, {}, '   ', zeroWidth]) assert.equal(cleanDisplayName(value), '');
});

test('auth redirects preserve an application path, query and fragment', () => {
  assert.equal(safeReturnPath('/?view=collection#saved'), '/?view=collection#saved');
  assert.equal(safeReturnPath('/catalog?q=anime'), '/catalog?q=anime');
});

test('auth redirects reject external URLs and callback loops', () => {
  for (const value of [
    null,
    '',
    'https://evil.example',
    '//evil.example/path',
    '/\\evil.example',
    '/auth/callback',
    '/api/auth/signout',
    '/x/../auth/callback',
    '/\n/evil.example',
    '/\t/evil.example',
    '/.//evil.example',
    '/%2e//evil.example',
    '/x/..//evil.example',
    '/a/../..//evil.example/path?x=1',
  ]) {
    assert.equal(safeReturnPath(value), '/', String(value));
  }
});

test('mutations accept only the same Origin, including protocol and port', () => {
  const url = 'https://afterwatch.example/api/state';
  assert.doesNotThrow(() =>
    assertSameOrigin(new Request(url, { headers: { origin: 'https://afterwatch.example' } })),
  );
  for (const origin of [
    undefined,
    'null',
    'https://evil.example',
    'http://afterwatch.example',
    'https://afterwatch.example:8443',
    'https://afterwatch.example.evil.example',
  ]) {
    const headers = origin === undefined ? {} : { origin };
    assert.throws(
      () => assertSameOrigin(new Request(url, { headers })),
      (error) =>
        error instanceof Response &&
        error.status === 403 &&
        error.headers.get('cache-control') === 'private, no-store',
    );
  }
});

test('collection saves belong to the verified account that loaded the document', () => {
  const owner = 'a110a110-0000-4000-8000-000000000001';
  assert.doesNotThrow(() => assertExpectedUser(owner, owner));
  for (const expected of [undefined, null, '', {}, 'a110a110-0000-4000-8000-000000000002']) {
    assert.throws(
      () => assertExpectedUser(expected, owner),
      (error) =>
        error instanceof Response &&
        error.status === 409 &&
        error.headers.get('cache-control') === 'private, no-store',
    );
  }
});

test('missing or malformed Supabase configuration disables authentication', () => {
  const variables = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_TELEGRAM_AUTH_PROVIDER',
  ];
  const previous = Object.fromEntries(variables.map((name) => [name, process.env[name]]));
  try {
    variables.forEach((name) => delete process.env[name]);
    assert.equal(getSupabaseConfig(), null);
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    assert.equal(getSupabaseConfig(), null);
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_example';
    assert.deepEqual(getSupabaseConfig(), {
      url: 'https://example.supabase.co',
      publishableKey: 'sb_publishable_example',
    });
    for (const url of ['invalid-url', 'javascript:alert(1)', 'file:///etc/passwd']) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = url;
      assert.equal(getSupabaseConfig(), null);
    }
    assert.equal(getTelegramProvider(), null);
    for (const provider of [
      'telegram',
      'custom:',
      'custom:Telegram',
      'custom:telegram?x=1',
      `custom:${'x'.repeat(50)}`,
    ]) {
      process.env.NEXT_PUBLIC_TELEGRAM_AUTH_PROVIDER = provider;
      assert.equal(getTelegramProvider(), null);
    }
    process.env.NEXT_PUBLIC_TELEGRAM_AUTH_PROVIDER = 'custom:telegram';
    assert.equal(getTelegramProvider(), 'custom:telegram');
  } finally {
    for (const name of variables) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
