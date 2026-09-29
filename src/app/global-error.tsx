'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

// Next.js only mounts this if an error escapes the root layout itself
// (src/app/error.tsx only catches errors from pages/components rendered
// INSIDE the layout, not the layout's own render). This is the last line
// of defense, so it renders its own bare <html>/<body> rather than
// depending on anything from layout.tsx that might be what's broken.
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    console.error(error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ background: '#0f172a', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ maxWidth: '480px', textAlign: 'center' }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '8px' }}>Something went wrong</h1>
            <p style={{ color: '#94a3b8' }}>
              We hit an unexpected error. Please refresh the page — if it keeps happening, let us know at{' '}
              <a href="mailto:support@relaytc.com" style={{ color: '#60a5fa' }}>
                support@relaytc.com
              </a>
              .
            </p>
          </div>
        </div>
      </body>
    </html>
  );
}
