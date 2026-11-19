// Who an account is *for* -- used to tailor onboarding, navigation and copy.
//
// account_type lives in app_metadata, which only our server can write, so a
// person cannot tag their own account by calling Supabase Auth directly
// (user_metadata is user-editable and is ignored for this). It still must not
// be the only thing that decides what someone may see or do: every access
// check stays in the API routes (ownership of the transaction, plan limits,
// team membership, entitlements). coordination_mode is a harmless preference
// and stays in user_metadata. A missing account_type means a coordinator
// account, which is every account created before this existed.

export type AccountType = 'tc' | 'agent';
export type CoordinationMode = 'own_tc' | 'self' | 'automate';

export const COORDINATION_MODES: { id: CoordinationMode; title: string; body: string }[] = [
  {
    id: 'self',
    title: 'I handle my own transactions',
    body: 'Relay keeps every deal, checklist step, document and deadline in one place.',
  },
  {
    id: 'automate',
    title: 'I want Relay to do the coordination work',
    body: 'Upload the contract and Relay builds the deal, checklist and deadlines, then reminds you before each one is due.',
  },
  {
    id: 'own_tc',
    title: 'I work with a transaction coordinator',
    body: 'Keep your own view of every deal and stay in step with your TC.',
  },
];

// Pass the user's app_metadata (server-controlled), never user_metadata.
export function getAccountType(appMetadata: Record<string, unknown> | null | undefined): AccountType {
  return appMetadata?.account_type === 'agent' ? 'agent' : 'tc';
}

export function getCoordinationMode(metadata: Record<string, unknown> | null | undefined): CoordinationMode | null {
  const m = metadata?.coordination_mode;
  return m === 'own_tc' || m === 'self' || m === 'automate' ? m : null;
}

export function isCoordinationMode(value: unknown): value is CoordinationMode {
  return value === 'own_tc' || value === 'self' || value === 'automate';
}

// What an agent tells us in setup, beyond how they like to work. Presentation and planning only: nothing here grants access.
export const AGENT_FOCUS: { id: string; label: string }[] = [
  { id: 'listings', label: 'Listings' },
  { id: 'buyers', label: 'Buyers' },
  { id: 'new_construction', label: 'New construction' },
  { id: 'investors', label: 'Investors' },
  { id: 'land', label: 'Land and rural' },
];
export const AGENT_VOLUME: { id: string; label: string }[] = [
  { id: 'under_10', label: 'Under 10' },
  { id: '10_25', label: '10 to 25' },
  { id: '26_50', label: '26 to 50' },
  { id: 'over_50', label: 'More than 50' },
];

export interface AgentProfile {
  focus: string[];
  dealsPerYear: string | null;
  license: string | null;
}

/** Only known choices are kept; the license number is trimmed and limited to plain license-number characters. */
export function cleanAgentProfile(input: { focus?: unknown; dealsPerYear?: unknown; license?: unknown } | null | undefined): AgentProfile {
  const focus = Array.isArray(input?.focus)
    ? [...new Set(input.focus.filter((f): f is string => typeof f === 'string' && AGENT_FOCUS.some((o) => o.id === f)))]
    : [];
  const dealsPerYear = typeof input?.dealsPerYear === 'string' && AGENT_VOLUME.some((o) => o.id === input.dealsPerYear) ? input.dealsPerYear : null;
  const licenseRaw = typeof input?.license === 'string' ? input.license.trim().replace(/[^A-Za-z0-9 \-./#]/g, '').slice(0, 40) : '';
  return { focus, dealsPerYear, license: licenseRaw || null };
}
