// Who an account is *for* -- used only to tailor onboarding, navigation and
// copy. It is stored in user_metadata, which the account owner can edit, so
// it must NEVER be used to decide what someone is allowed to see or do. Every
// access check stays in the API routes (ownership of the transaction, plan
// limits, team membership). A missing value means a coordinator account,
// which is every account created before this existed.

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

export function getAccountType(metadata: Record<string, unknown> | null | undefined): AccountType {
  return metadata?.account_type === 'agent' ? 'agent' : 'tc';
}

export function getCoordinationMode(metadata: Record<string, unknown> | null | undefined): CoordinationMode | null {
  const m = metadata?.coordination_mode;
  return m === 'own_tc' || m === 'self' || m === 'automate' ? m : null;
}

export function isCoordinationMode(value: unknown): value is CoordinationMode {
  return value === 'own_tc' || value === 'self' || value === 'automate';
}
