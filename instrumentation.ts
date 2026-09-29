// Next.js's instrumentation hook -- runs once when the server starts, in
// every runtime (nodejs and edge). This is what actually loads the two
// server-side Sentry config files above; instrumentation-client.ts is
// loaded separately and automatically for the browser bundle.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Captures errors thrown during server-side rendering that Next.js
// otherwise only logs internally.
export async function onRequestError(...args: Parameters<typeof import('@sentry/nextjs').captureRequestError>) {
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(...args);
}
