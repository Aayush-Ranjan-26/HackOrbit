import type { NextConfig } from 'next';

/**
 * The frontend serves the browsable HTML, so it needs these more than the API
 * does — it previously sent no security headers at all. The CSP is a backstop:
 * React escapes by default and there is no dangerouslySetInnerHTML anywhere,
 * but a future injection should not get a free origin.
 *
 * 'unsafe-inline' on styles is required by CSS Modules' injected styles, and
 * 'unsafe-eval' by the dev overlay — hence the production-only tightening.
 */
const isProd = process.env.NODE_ENV === 'production';

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  // Supabase for auth, plus the API. Both are same-origin in prod behind a proxy.
  "connect-src 'self' https://*.supabase.co http://localhost:8080",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig: NextConfig = {
  // Emits .next/standalone with a self-contained server.js, so the Docker image
  // ships only the files actually traced as needed instead of all of node_modules.
  output: 'standalone',

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Only meaningful over HTTPS; harmless on localhost.
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ];
  },
};

export default nextConfig;
