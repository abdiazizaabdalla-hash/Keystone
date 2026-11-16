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
interface OwnerInfo { kind: OwnerKind; name: string | null }

let cached: Promise<OwnerInfo> | null = null;
let cachedFor: string | null = null;

function lookup(): Promise<OwnerInfo> {
  const me = storedUserId();
  if (cachedFor !== me) {
    cached = null;
    cachedFor = me;
  }
  if (!cached) {
    cached = authFetch('/api/team')
      .then(async (res) => {
        if (!res.ok) return { kind: null, name: null };
        const data = (await res.json()) as { role?: string | null; planId?: string | null; ownerKind?: 'brokerage' | 'team' | null; team?: { name?: string | null } };
        if (data.role !== 'owner' || !isTeamPlan(data.planId)) return { kind: null, name: null };
        return { kind: (data.ownerKind === 'brokerage' ? 'brokerage' : 'team') as OwnerKind, name: data.team?.name?.trim() || null };
      })
      .catch(() => {
        cached = null; // try again next time
        return { kind: null, name: null };
      });
  }
  return cached as Promise<OwnerInfo>;
}

function useOwnerKind(enabled: boolean): { kind: OwnerKind; name: string | null; ready: boolean } {
  const [state, setState] = useState<{ kind: OwnerKind; name: string | null; ready: boolean }>({ kind: null, name: null, ready: false });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    lookup().then((v) => {
      if (live) setState({ kind: v.kind, name: v.name, ready: true });
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

/** The name the owner gave their brokerage or team (null until they set one, or while finding out). */
export function useOrgName(): { name: string | null; kind: OwnerKind; ready: boolean } {
  const { kind, name, ready } = useOwnerKind(true);
  return { name, kind, ready };
}
