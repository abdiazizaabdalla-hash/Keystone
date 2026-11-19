'use client';

import { useEffect, useState } from 'react';
import { authFetch, storedUserId } from './authClient';
import { isFeatureOnClient } from './features';
import type { AdminRole, AdminScope } from './brokerageAdmins';

// Presentation only: is the person signed in an administrator of someone's brokerage? The server checks the role on every request.
export interface AdminAccess { delegated: boolean; role?: AdminRole; scopes?: AdminScope[]; brokerage?: string }

let cached: Promise<AdminAccess> | null = null;
let cachedFor: string | null = null;

function lookup(): Promise<AdminAccess> {
  const me = storedUserId();
  if (cachedFor !== me) { cached = null; cachedFor = me; }
  if (!cached) {
    cached = authFetch('/api/brokerage/admin-access')
      .then(async (res) => (res.ok ? ((await res.json()) as AdminAccess) : { delegated: false }))
      .catch(() => { cached = null; return { delegated: false }; });
  }
  return cached;
}

/** null while finding out. */
export function useBrokerageAdminAccess(): AdminAccess | null {
  const on = isFeatureOnClient('brokerage');
  const [access, setAccess] = useState<AdminAccess | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    lookup().then((v) => { if (live) setAccess(v); });
    return () => { live = false; };
  }, [on]);
  return on ? access : { delegated: false };
}
