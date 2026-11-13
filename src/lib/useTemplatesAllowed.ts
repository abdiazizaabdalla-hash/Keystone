'use client';
import { useEffect, useState } from 'react';
import { authFetch } from './authClient';
import { isFeatureOnClient } from './features';

// Whether templates are available to the signed-in account: the deployment flag AND the plan (Pro/Team, see lib/automation/plan.ts).
// One request to /api/auth/me, shared by every component on the page. The server enforces the same rule on every templates route;
// this only decides whether to show the buttons.
let cached: Promise<boolean> | null = null;

function loadAllowed(): Promise<boolean> {
  if (!cached) {
    cached = authFetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data?.templatesAllowed === true)
      .catch(() => false);
    // A failed lookup should not stick for the whole session.
    cached.then((ok) => {
      if (!ok) setTimeout(() => (cached = null), 15000);
    });
  }
  return cached;
}

/** `ready` is false until the first answer arrives, so a page can wait instead of flashing an upgrade message. */
export function useTemplatesAccess(): { allowed: boolean; ready: boolean } {
  const flag = isFeatureOnClient('templates');
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    if (!flag) return;
    let live = true;
    loadAllowed().then((ok) => live && setAllowed(ok));
    return () => {
      live = false;
    };
  }, [flag]);
  return { allowed: flag && allowed === true, ready: !flag || allowed !== null };
}

export function useTemplatesAllowed(): boolean {
  return useTemplatesAccess().allowed;
}
