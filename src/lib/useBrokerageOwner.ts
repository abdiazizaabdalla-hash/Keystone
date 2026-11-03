'use client';

import { useEffect, useState } from 'react';
import { authFetch } from './authClient';
import { isFeatureOnClient } from './features';
import { isTeamPlan } from './plans';

// Presentation only: is this person the owner of a Team or Brokerage plan, with the brokerage feature on?
// null while we are still finding out (pages show their normal view meanwhile); the server decides what they may do.
let cached: Promise<boolean> | null = null;

function lookup(): Promise<boolean> {
  if (!cached) {
    cached = authFetch('/api/team')
      .then(async (res) => {
        if (!res.ok) return false;
        const data = (await res.json()) as { role?: string | null; planId?: string | null };
        return data.role === 'owner' && isTeamPlan(data.planId);
      })
      .catch(() => {
        cached = null; // try again next time
        return false;
      });
  }
  return cached;
}

export function useBrokerageOwner(): boolean | null {
  const on = isFeatureOnClient('brokerage');
  const [owner, setOwner] = useState<boolean | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    lookup().then((v) => {
      if (live) setOwner(v);
    });
    return () => {
      live = false;
    };
  }, [on]);
  return on ? owner : false;
}
