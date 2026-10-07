import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

// Content-Security-Policy. Ships in REPORT-ONLY mode by default: browsers log
// violations to the console but block nothing, so a missed host can't break
// the app. After browsing the live app with the console open and seeing no
// violations, set CSP_MODE=enforce in Vercel to start blocking. Next.js's own
// inline bootstrap scripts need 'unsafe-inline' for scripts, so the main wins
// here are: no plugins/objects, no framing by other sites, no <base>/form
// hijacking, and connections/images only to hosts we actually use.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.supabase.co",
  "connect-src 'self' https://*.supabase.co https://*.ingest.sentry.io https://*.ingest.us.sentry.io",
  "frame-src 'self' blob: https://*.supabase.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

const cspHeaderName =
  process.env.CSP_MODE === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: [...securityHeaders, { key: cspHeaderName, value: csp }] }];
  },
};

// withSentryConfig wraps the build to also upload source maps to Sentry
// (readable stack traces instead of minified gibberish) -- but only if
// SENTRY_AUTH_TOKEN/SENTRY_ORG/SENTRY_PROJECT are set. Without them it
// just skips the upload step; `silent: true` keeps that from nagging on
// every build. Error reporting itself (instrumentation-client.ts,
// sentry.server.config.ts, sentry.edge.config.ts) works either way --
// this wrapper only affects how readable the stack traces are once
// they're in Sentry, not whether errors get captured at all.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
});
