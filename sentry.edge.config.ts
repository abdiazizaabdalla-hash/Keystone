// Sentry init for the Edge runtime (middleware, edge API routes -- this
// app doesn't currently use either, but Next.js's instrumentation hook
// calls this unconditionally, so it needs to exist and no-op safely).
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
  });
}
