import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

/**
 * Server-side proxy for the backend's /admin/* routes.
 *
 * The admin secret is read here, on the server — it was previously a
 * NEXT_PUBLIC_ variable and therefore compiled into the browser bundle.
 *
 * Holding the secret server-side is only half the job: this route then *is*
 * the admin credential, so it must also establish who is calling. Without
 * that check, anyone who could reach port 3000 could read the scrape logs and
 * trigger a full five-site scrape with a plain unauthenticated curl.
 */
const API_BASE = process.env.API_BASE || process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8080';

const ALLOWED = new Set(['scrape', 'scrape-status', 'stats']);

/** Comma-separated Supabase user ids. Unset ⇒ admin is unreachable. */
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

/** Same 404 for "not signed in", "not an admin" and "no such route" — the admin surface does not announce itself. */
const notFound = () => Response.json({ error: 'Not found' }, { status: 404 });

async function callerIsAdmin(): Promise<boolean> {
  if (!ADMIN_USER_IDS.length) return false;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return false;

  const cookieStore = await cookies();
  const supabase = createServerClient(url, anonKey, {
    cookieOptions: { secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' },
    cookies: {
      getAll: () => cookieStore.getAll(),
      // getUser() below refreshes an expired token, which ROTATES the refresh
      // token. Discarding the new one invalidated the admin's session, so they
      // appeared randomly signed out. Write it back.
      setAll: (toSet) => toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
    },
  });

  // getUser() validates the token against Supabase rather than trusting the cookie.
  const { data, error } = await supabase.auth.getUser();
  return !error && Boolean(data.user) && ADMIN_USER_IDS.includes(data.user.id);
}

async function proxy(request: Request, params: Promise<{ path: string[] }>) {
  // Identity first. A 503 ahead of this check told an unauthenticated caller
  // that an admin surface exists here, which is exactly what the flat 404 is
  // for. An admin still needs to know when the key is missing, so the 503 is
  // kept — just behind the gate.
  if (!(await callerIsAdmin())) return notFound();
  if (!process.env.ADMIN_SECRET_KEY) {
    return Response.json({ error: 'Admin is not configured' }, { status: 503 });
  }

  const { path } = await params;
  const segment = path.join('/');
  if (!ALLOWED.has(segment)) return notFound();

  try {
    const upstream = await fetch(`${API_BASE}/admin/${segment}`, {
      method: request.method,
      headers: { 'Content-Type': 'application/json', 'x-admin-key': process.env.ADMIN_SECRET_KEY },
      cache: 'no-store',
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return Response.json({ error: 'Backend unreachable' }, { status: 502 });
  }
}

export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(request, ctx.params);
}

export async function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(request, ctx.params);
}
