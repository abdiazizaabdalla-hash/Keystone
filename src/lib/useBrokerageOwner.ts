'use client';

import { useEffect, useState } from 'react';
import { authFetch, storedUserId } from './authClient';
import { isFeatureOnClient } from './features';
import { isTeamPlan } from './plans';

// Presentation only: is this person the owner of a Team or Brokerage plan, and which kind of owner?
//   brokerage: has a brokerage account or has invited agents (the brokerage feature must also be on)
//   team: a coordinator who runs a team of TCs (the default)
// null while we are still finding out (pages show their normal view meanwhile); the server decides what they may do.
// The answer belongs to whoever is signed in: signing out and in as someone else must never reuse it.
export type OwnerKind = 'brokerage' | 'team' | null;

let cached: Promise<OwnerKind> | null = null;
let cachedFor: string | null = null;

function lookup(): Promise<OwnerKind> {
  const me = storedUserId();
  if (cachedFor !== me) {
    cached = null;
    cachedFor = me;
  }
  if (!cached) {
    cached = authFetch('/api/team')
      .then(async (res) => {
        if (!res.ok) return null;
        const data = (await res.json()) as { role?: string | null; planId?: string | null; ownerKind?: 'brokerage' | 'team' | null };
        if (data.role !== 'owner' || !isTeamPlan(data.planId)) return null;
        return data.ownerKind === 'brokerage' ? 'brokerage' : 'team';
      })
      .catch(() => {
        cached = null; // try again next time
        return null;
      });
  }
  return cached;
}

function useOwnerKind(enabled: boolean): { kind: OwnerKind; ready: boolean } {
  const [state, setState] = useState<{ kind: OwnerKind; ready: boolean }>({ kind: null, ready: false });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    lookup().then((v) => {
      if (live) setState({ kind: v, ready: true });
    });
    return () => {
      live = false;
    };
  }, [enabled]);
  return state;
}

/** Owner of a brokerage (brokerage feature on). null while finding out. */
export function useBrokerageOwner(): boolean | null {
  const on = isFeatureOnClient('brokerage');
  const { kind, ready } = useOwnerKind(on);
  if (!on) return false;
  return ready ? kind === 'brokerage' : null;
}

/** Owner of a TC team: coordinators who run team members, with status-only views. Works with the brokerage feature on or off. null while finding out. */
export function useTeamOwner(): boolean | null {
  const on = isFeatureOnClient('brokerage');
  const { kind, ready } = useOwnerKind(true);
  if (!ready) return null;
  // With the brokerage feature on, an owner with a brokerage account or agents is a brokerage; with it off, every Team-plan owner is a team.
  return on ? kind === 'team' : kind !== null;
}
