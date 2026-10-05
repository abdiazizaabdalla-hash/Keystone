import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
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
