'use client';

import { Analytics, type BeforeSendEvent } from '@vercel/analytics/next';

// Vercel Web Analytics (cookie-free page-view counting) for the PUBLIC pages
// only. The app has URLs that contain secrets or personal details -- signing
// links (/sign/<token>), shared deal links (/external/<token>), invoice and
// payment pages, the signed-in dashboard, and /auth?email=... -- and none of
// that should ever reach an analytics service. So events are allowlisted by
// path and the query string is cut down to campaign tags and the plan.
const TRACKED_PATHS = new Set([
  '/',
  '/pricing',
  '/faq',
  '/for-agents',
  '/terms',
  '/privacy',
  '/auth',
  '/agent/login',
]);

const KEPT_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref', 'plan', 'mode'];

function beforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    const url = new URL(event.url);
    const path = url.pathname.replace(/\/$/, '') || '/';
    if (!TRACKED_PATHS.has(path)) return null;
    const kept = new URLSearchParams();
    for (const key of KEPT_PARAMS) {
      const value = url.searchParams.get(key);
      if (value) kept.set(key, value.slice(0, 100));
    }
    const query = kept.toString();
    return { ...event, url: `${url.origin}${path}${query ? `?${query}` : ''}` };
  } catch {
    return null;
  }
}

export default function SiteAnalytics() {
  return <Analytics beforeSend={beforeSend} />;
}
