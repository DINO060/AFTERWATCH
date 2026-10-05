import test from 'node:test';
import assert from 'node:assert/strict';
import { pickLang, langFromRequest, messages } from '../lib/i18n.ts';

test('a saved language wins over the browser preference', () => {
  assert.equal(pickLang('en', 'fr-FR,fr;q=0.9'), 'en');
  assert.equal(pickLang('fr', 'en-US'), 'fr');
});

test('without a saved choice, French browsers get French and everyone else English', () => {
  assert.equal(pickLang(undefined, 'fr-CA,fr;q=0.9,en;q=0.8'), 'fr');
  assert.equal(pickLang(undefined, 'en-GB,en;q=0.9,fr;q=0.8'), 'en');
  assert.equal(pickLang(undefined, 'es-ES,es;q=0.9,fr;q=0.8,en;q=0.7'), 'fr');
  assert.equal(pickLang(undefined, 'de-DE'), 'en');
  assert.equal(pickLang(undefined, 'en;q=0.5,fr;q=0.9'), 'fr');
  assert.equal(pickLang(undefined, 'fr;q=0'), 'en');
  assert.equal(pickLang(undefined, null), 'en');
  assert.equal(pickLang('de', 'fr-FR'), 'fr', 'an unknown saved value is ignored');
});

test('requests read the language cookie, then Accept-Language', () => {
  const url = 'https://afterwatch.example/api/state';
  assert.equal(
    langFromRequest(
      new Request(url, { headers: { cookie: 'a=1; aw_lang=en; b=2', 'accept-language': 'fr' } }),
    ),
    'en',
  );
  assert.equal(langFromRequest(new Request(url, { headers: { 'accept-language': 'fr-FR' } })), 'fr');
  assert.equal(langFromRequest(new Request(url)), 'en');
});

test('both languages define the same texts', () => {
  const shape = (value) =>
    value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, shape(value[key])]),
        )
      : typeof value;
  assert.deepEqual(shape(messages.en), shape(messages.fr));
});
