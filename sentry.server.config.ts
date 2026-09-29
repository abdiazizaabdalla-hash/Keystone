// Server-side Sentry init (API routes, server components). Loaded via
// instrumentation.ts's register() at server startup, per Next.js's
// instrumentation hook convention.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
  });
}
