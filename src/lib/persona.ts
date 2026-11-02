'use client';

import type { AccountType, CoordinationMode } from './accountType';

// The dashboard layout learns the account type from /api/auth/me and shares
// it with pages through this small cache, so they can adjust wording without
// each making their own request. Presentation only -- see lib/accountType.ts.
const KEY = 'relay_persona';

export interface Persona {
  accountType: AccountType;
  coordinationMode: CoordinationMode | null;
}

export function savePersona(p: Persona) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage can be blocked; the pages just show the default wording.
  }
}

export function readPersona(): Persona {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        accountType: p.accountType === 'agent' ? 'agent' : 'tc',
        coordinationMode: p.coordinationMode === 'own_tc' || p.coordinationMode === 'self' || p.coordinationMode === 'automate' ? p.coordinationMode : null,
      };
    }
  } catch {
    // fall through
  }
  return { accountType: 'tc', coordinationMode: null };
}
