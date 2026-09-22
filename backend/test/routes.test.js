import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';

const PORT = 8123;
const BASE = `http://127.0.0.1:${PORT}`;

// Env must be set before src/index.js is imported: lib/supabase.js reads these
// eagerly and throws on import if they're missing. The port is unreachable
// (nothing listens there) so any DB call fails fast with ECONNREFUSED instead
// of hanging or reaching a real project.
process.env.PORT = String(PORT);
process.env.SUPABASE_URL = 'http://127.0.0.1:51999';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role-key';
process.env.ENABLE_CRON = 'false';
delete process.env.ADMIN_SECRET_KEY;

const { server } = await import('../src/index.js');

before(async () => {
  // Give app.listen a beat to bind before the first request.
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${BASE}/health`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
});

// index.js doesn't export its http.Server, so there's no handle to close here.
after(async () => {
  // Close the listener so the runner can exit on its own.
  await new Promise((resolve) => server.close(resolve));
});

test('GET /health returns ok', async () => {
  const res = await fetch(`${BASE}/health`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.status, 'ok');
});

test('unknown route returns 404 without echoing the requested path', async () => {
  const path = '/totally-not-a-real-route-xyz';
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  assert.equal(res.status, 404);
  assert.deepEqual(JSON.parse(text), { error: 'Route not found', code: 'NOT_FOUND' });
  assert.ok(!text.includes(path), 'response body must not reflect the requested path');
});

describe('authentication gate', () => {
  test('GET /user/profile with no Authorization header is 401', async () => {
    const res = await fetch(`${BASE}/user/profile`);
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.equal(body.code, 'UNAUTHENTICATED');
  });

  test('GET /user/profile with a malformed bearer token is 401', async () => {
    const res = await fetch(`${BASE}/user/profile`, {
      headers: { Authorization: 'Bearer garbage' },
    });
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.equal(body.code, 'UNAUTHENTICATED');
  });

  test('GET /user/recommendations unauthenticated is 401', async () => {
    const res = await fetch(`${BASE}/user/recommendations`);
    assert.equal(res.status, 401);
  });
});

test('GET /hackathons/:id with a malformed id is 400, not 404/500', async () => {
  const res = await fetch(`${BASE}/hackathons/not-a-uuid`);
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.code, 'BAD_REQUEST');
});

// One sequential test, not three: subtests inside a `describe` run concurrently
// in node:test, so three tests mutating process.env.ADMIN_SECRET_KEY raced each
// other and the "unset" case saw a key set by a sibling.
test('admin gate: unset is 503, wrong key is 401, correct key gets past the guard', async () => {
  delete process.env.ADMIN_SECRET_KEY;
  const disabled = await fetch(`${BASE}/admin/stats`);
  assert.equal(disabled.status, 503);
  assert.equal((await disabled.json()).code, 'ADMIN_DISABLED');

  process.env.ADMIN_SECRET_KEY = 'correct-horse-battery-staple';

  const wrong = await fetch(`${BASE}/admin/stats`, { headers: { 'x-admin-key': 'wrong-key' } });
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).code, 'UNAUTHORIZED');

  // Deliberately not POST /admin/scrape: that fires a real scrape against five
  // live sites on every CI run. Getting past the guard is what matters here —
  // the request then fails at the unreachable test database, which is not a 401.
  const accepted = await fetch(`${BASE}/admin/stats`, {
    headers: { 'x-admin-key': 'correct-horse-battery-staple' },
  });
  assert.notEqual(accepted.status, 401);
  assert.notEqual(accepted.status, 503);

  delete process.env.ADMIN_SECRET_KEY;
});

test('security headers are set on every response', async () => {
  const res = await fetch(`${BASE}/health`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
});
