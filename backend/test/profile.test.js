import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// lib/profile.js -> lib/supabase.js throws unless these are set; nothing
// connects at import time.
process.env.SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role-key';

const { buildProfileUpdate } = await import('../src/lib/profile.js');

describe('buildProfileUpdate', () => {
  // The bug: the onboarding form sends null for every question the user
  // skipped, and the enum validator rejected null while the string validator
  // accepted it. The whole save 400'd — interests included — so onboarding never
  // once succeeded and /for-you had nothing to match on.
  test('a skipped enum field is accepted and clears the column', () => {
    const set = buildProfileUpdate({
      interests: ['AI / ML', 'Web Dev'],
      year_of_study: null,
      experience: null,
      format_pref: 'both',
      team_pref: 'either',
    });
    assert.deepEqual(set.interests, ['AI / ML', 'Web Dev']);
    assert.equal(set.year_of_study, null);
    assert.equal(set.experience, null);
    assert.equal(set.format_pref, 'both');
  });

  test('an empty string clears an enum column too', () => {
    assert.equal(buildProfileUpdate({ format_pref: '' }).format_pref, null);
  });

  test('a genuinely invalid enum value is still rejected', () => {
    assert.throws(() => buildProfileUpdate({ format_pref: 'telepathy' }), /format_pref must be one of/);
    assert.throws(() => buildProfileUpdate({ year_of_study: '6th' }), /year_of_study must be one of/);
  });

  test('absent keys are left alone rather than nulled', () => {
    const set = buildProfileUpdate({ display_name: 'Ada' });
    assert.deepEqual(Object.keys(set), ['display_name']);
  });

  test('strings are trimmed and capped', () => {
    assert.equal(buildProfileUpdate({ display_name: '  Ada  ' }).display_name, 'Ada');
    assert.equal(buildProfileUpdate({ display_name: 'x'.repeat(500) }).display_name.length, 120);
    assert.equal(buildProfileUpdate({ avatar_url: 'u'.repeat(900) }).avatar_url.length, 500);
  });

  test('interests are capped per entry and per list, and deduped', () => {
    const set = buildProfileUpdate({ interests: ['L'.repeat(5000), 'ai', 'ai', '  ', ...Array(40).fill('x') ] });
    assert.equal(set.interests[0].length, 60, 'each entry is capped');
    assert.ok(set.interests.length <= 20, 'the list is capped');
    assert.equal(set.interests.filter((i) => i === 'ai').length, 1, 'duplicates collapse');
    assert.ok(!set.interests.includes(''), 'blank entries are dropped');
  });

  test('a non-string in interests is rejected', () => {
    assert.throws(() => buildProfileUpdate({ interests: [1, 2] }), /interests must be an array of strings/);
    assert.throws(() => buildProfileUpdate({ interests: 'ai' }), /interests must be an array of strings/);
  });

  test('display_name of the wrong type is rejected', () => {
    assert.throws(() => buildProfileUpdate({ display_name: 123 }), /display_name must be a string/);
  });
});
