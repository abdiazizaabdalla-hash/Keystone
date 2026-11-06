'use client';

import { useEffect, useState } from 'react';
import { authFetch, storedUserId } from './authClient';
import { isFeatureOnClient } from './features';

// Presentation only: what level of access does this agent have, and has their brokerage lapsed (read-only)?
// The server enforces both on every request (auth.ts); this only lets screens hide buttons that would be refused.
// With the agent and brokerage features off nothing is fetched and nobody is treated as limited, so the live site is unaffected.
// The answer belongs to whoever is signed in: signing out and in as someone else must never reuse it.
export interface AgentAccess {
  level: string | null;
  readOnly: boolean;
}

const NONE: AgentAccess = { level: null, readOnly: false };
let cached: Promise<AgentAccess> | null = null;
let cachedFor: string | null = null;

function lookup(): Promise<AgentAccess> {
  const me = storedUserId();
  if (cachedFor !== me) {
    cached = null;
    cachedFor = me;
  }
  if (!cached) {
    cached = authFetch('/api/auth/me')
      .then(async (res) => {
        if (!res.ok) return NONE;
        const data = (await res.json()) as { agentLevel?: string | null; readOnly?: boolean };
        return { level: data.agentLevel ?? null, readOnly: data.readOnly === true };
      })
      .catch(() => {
        cached = null; // try again next time
        return NONE;
      });
  }
  return cached;
}

export function useAgentAccess(): AgentAccess {
  const on = isFeatureOnClient('agent_workspace') || isFeatureOnClient('brokerage');
  const [access, setAccess] = useState<AgentAccess>(NONE);
  useEffect(() => {
    if (!on) return;
    let live = true;
    lookup().then((a) => {
      if (live) setAccess(a);
    });
    return () => {
      live = false;
    };
  }, [on]);
  return on ? access : NONE;
}
