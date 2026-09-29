// Client-side Sentry init. Next.js auto-loads a file with this exact
// name/path (root of the project, alongside next.config.ts) before any
// other client code runs -- this is the App Router replacement for the
// older sentry.client.config.ts pattern.
//
// No-ops entirely if NEXT_PUBLIC_SENTRY_DSN isn't set (e.g. local dev, or
// before the Sentry project exists yet) -- nothing else in the app
// depends on Sentry being active, so this is safe to leave unset.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Low sample rate to start -- this is about catching real errors in
    // production traffic, not deep performance profiling on day one.
    tracesSampleRate: 0.1,
    // Errors only; no session replay recording of what users typed/saw
    // (this app handles real names, emails, and financial figures --
    // replay is an easy thing to turn on later deliberately, not a
    // default to ship with).
  });
}
