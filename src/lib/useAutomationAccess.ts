'use client';
import { useEffect, useState } from 'react';
import { authFetch } from './authClient';
import { isFeatureOnClient } from './features';

// Whether the signed-in account's PLAN includes automation (Pro or Team; see lib/automation/plan.ts), from /api/auth/me.
// The server enforces the same rule on every automation route; this only decides what the screen shows.
let cached: Promise<boolean> | null = null;

function loadAllowed(): Promise<boolean> {
  if (!cached) {
    cached = authFetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data?.automationAllowed === true)
      .catch(() => false);
    // A failed lookup should not stick for the whole session.
    cached.then((ok) => {
      if (!ok) setTimeout(() => (cached = null), 15000);
    });
  }
  return cached;
}

/** `flagOn`: automation is released in this deployment. `allowed`: this account's plan includes it. `ready`: the plan answer has arrived. */
export function useAutomationAccess(): { flagOn: boolean; allowed: boolean; ready: boolean } {
  const flagOn = isFeatureOnClient('automation');
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    if (!flagOn) return;
    let live = true;
    loadAllowed().then((ok) => live && setAllowed(ok));
    return () => {
      live = false;
    };
  }, [flagOn]);
  return { flagOn, allowed: allowed === true, ready: !flagOn || allowed !== null };
}
