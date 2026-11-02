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
