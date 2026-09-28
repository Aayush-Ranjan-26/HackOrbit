import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// middleware/auth.js -> lib/supabase.js throws unless these are set; nothing
// connects at import time.
process.env.SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role-key';

const { secondsSinceSignIn, REAUTH_WINDOW_SECONDS } = await import('../src/middleware/auth.js');

const NOW = 1_800_000_000;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (claims) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.sig`;

// Deleting an account needs a sign-in from the last few minutes, read from the
// token's `amr` claim. The point of amr over iat is that a refresh gives a
// stolen session a brand-new iat every hour but leaves amr alone.
describe('secondsSinceSignIn', () => {
  test('a fresh sign-in is inside the window', () => {
    const t = token({ iat: NOW - 60, amr: [{ method: 'password', timestamp: NOW - 60 }] });
    assert.equal(secondsSinceSignIn(t, NOW), 60);
    assert.ok(secondsSinceSignIn(t, NOW) <= REAUTH_WINDOW_SECONDS);
  });

  test('a refreshed token is still judged by when the user signed in', () => {
    // iat is seconds old (the token was just refreshed) but the sign-in was a
    // day ago. Reading iat here is the bug this function exists to avoid.
    const t = token({ iat: NOW - 5, amr: [{ method: 'password', timestamp: NOW - 86_400 }] });
    assert.equal(secondsSinceSignIn(t, NOW), 86_400);
    assert.ok(secondsSinceSignIn(t, NOW) > REAUTH_WINDOW_SECONDS);
  });

  test('the most recent authentication method counts', () => {
    const t = token({
      amr: [
        { method: 'password', timestamp: NOW - 86_400 },
        { method: 'oauth', timestamp: NOW - 30 },
      ],
    });
    assert.equal(secondsSinceSignIn(t, NOW), 30);
  });

  // Fail closed: anything unreadable must count as too old, never as fresh.
  test('no amr claim is treated as infinitely old', () => {
    assert.equal(secondsSinceSignIn(token({ iat: NOW }), NOW), Infinity);
    assert.equal(secondsSinceSignIn(token({ amr: [] }), NOW), Infinity);
    assert.equal(secondsSinceSignIn(token({ amr: [{ method: 'password' }] }), NOW), Infinity);
  });

  test('a malformed token is treated as infinitely old', () => {
    assert.equal(secondsSinceSignIn('not-a-jwt', NOW), Infinity);
    assert.equal(secondsSinceSignIn('a.!!!.c', NOW), Infinity);
    assert.equal(secondsSinceSignIn(undefined, NOW), Infinity);
  });
});
