import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeUsername, usernameProblem } from '../lib/username.ts';
import { confirmsDeletion } from '../lib/account.ts';
import { CONTACT_EMAIL, legalDocs, legalPaths } from '../lib/legal.ts';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/202610080001_public_profiles.sql', import.meta.url),
  'utf8',
);

test('usernames follow the public rules', () => {
  for (const ok of ['dino060', 'john.d', 'a_b', 'abc', 'x'.repeat(20), 'Anime_Fan'])
    assert.equal(usernameProblem(ok), null, ok);
  assert.equal(usernameProblem('ab'), 'usernameLength');
  assert.equal(usernameProblem('x'.repeat(21)), 'usernameLength');
  assert.equal(usernameProblem('élodie'), 'usernameChars', 'no accents');
  assert.equal(usernameProblem('john doe'), 'usernameChars');
  assert.equal(usernameProblem('john-doe'), 'usernameChars');
  assert.equal(usernameProblem('.john'), 'usernameEdges');
  assert.equal(usernameProblem('john_'), 'usernameEdges');
  assert.equal(usernameProblem('jo..hn'), 'usernameEdges');
  assert.equal(usernameProblem('jo._hn'), 'usernameEdges');
  assert.equal(usernameProblem('Afterwatch_Team'), 'usernameReserved');
  assert.equal(usernameProblem('admin2'), 'usernameReserved');
  assert.equal(usernameProblem('moderateur'), 'usernameReserved');
  assert.equal(normalizeUsername('  Dino060 '), 'dino060');
  assert.equal(normalizeUsername(42), '');
});

test('the database reserves the same names and applies the same pattern', () => {
  const list = migration.match(/select p_username in \(([^)]*)\)/)[1];
  const words = [...list.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  assert.ok(words.length >= 10);
  for (const word of words) assert.equal(usernameProblem(word), 'usernameReserved', word);
  assert.ok(migration.includes("'^(afterwatch|admin|modo|moder)'"));
  // Same pattern as lib/username.ts: first and last a letter or digit, 3 to 20 characters.
  const pattern = new RegExp(migration.match(/username ~ '([^']+)'/)[1]);
  for (const name of ['abc', 'john.d', 'x'.repeat(20)]) assert.ok(pattern.test(name), name);
  for (const name of ['ab', '.abc', 'abc_', 'x'.repeat(21), 'ABC']) assert.ok(!pattern.test(name), name);
});

test('deleting an account needs the confirmation word, in either language', () => {
  assert.equal(confirmsDeletion('SUPPRIMER'), true);
  assert.equal(confirmsDeletion(' supprimer '), true);
  assert.equal(confirmsDeletion('delete'), true);
  assert.equal(confirmsDeletion(''), false);
  assert.equal(confirmsDeletion('SUPPRIME'), false);
  assert.equal(confirmsDeletion(undefined), false);
});

test('legal pages exist in both languages, complete and without placeholders', () => {
  for (const kind of Object.keys(legalPaths)) {
    const fr = legalDocs.fr[kind];
    const en = legalDocs.en[kind];
    assert.equal(fr.sections.length, en.sections.length, `${kind}: same sections in both languages`);
    for (const doc of [fr, en]) {
      const text = [
        doc.title,
        doc.intro,
        ...doc.sections.flatMap((s) => [
          s.title,
          ...s.body.flatMap((b) => (typeof b === 'string' ? b : b.list)),
        ]),
      ].join('\n');
      assert.ok(doc.title && doc.updated && doc.intro, kind);
      assert.ok(
        doc.sections.every((s) => s.title && s.body.length),
        kind,
      );
      assert.ok(!/\[|\]|TODO|XXX|lorem/i.test(text), `${kind}: no placeholder`);
      assert.ok(text.includes(CONTACT_EMAIL), `${kind}: contact address`);
    }
  }
});
