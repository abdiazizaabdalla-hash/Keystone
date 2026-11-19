'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';

/**
 * Does this agent already have portal access to anything of the coordinator's? null while loading or when unknown.
 * When true, a new deal or listing for them is added to their portal by default and the form offers an opt-out.
 */
export function useAgentHasPortalAccess(agentId: string | null | undefined): boolean | null {
  const [has, setHas] = useState<boolean | null>(null);
  useEffect(() => {
    setHas(null);
    if (!agentId) return;
    let alive = true;
    (async () => {
      try {
        const res = await authFetch(`/api/agents/${agentId}/portal-access`);
        if (!res.ok) return;
        const body = await res.json();
        if (alive) setHas([...(body.deals || []), ...(body.listings || [])].some((i: { hasAccess: boolean }) => i.hasAccess));
      } catch { /* unknown: fall back to the unticked default */ }
    })();
    return () => { alive = false; };
  }, [agentId]);
  return has;
}
