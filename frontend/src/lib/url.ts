/**
 * Resolves a caller-supplied `next` to a same-site path, or null.
 *
 * Hand-written prefix checks do not survive contact with the URL parser. A
 * guard of `/^\/(?!\/)/` looks right and is defeated by `/\evil.example`
 * (WHATWG treats a backslash as a slash for http URLs) and by `/<TAB>//evil`
 * or `/<LF>//evil` (the parser strips those bytes) — each resolving to a
 * protocol-relative URL on an attacker's host.
 *
 * So do not pattern-match. Resolve with the same parser the redirect will use
 * and compare origins; anything that lands off-site is rejected outright.
 */
export function sameSitePath(raw: string | null | undefined, origin: string): string | null {
  if (!raw) return null;

  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
