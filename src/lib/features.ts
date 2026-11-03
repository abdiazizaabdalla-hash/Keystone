// Feature switches for work that is built but not released.
//
// Everything on this list is OFF unless the environment turns it on. Production (Vercel)
// never sets these variables, so unreleased features are invisible and their APIs answer
// 404 there. Local development turns them on in .env.development.local.
//
//   RELAY_FEATURES              server side, comma separated
//   NEXT_PUBLIC_RELAY_FEATURES  same list, for pages and components in the browser
//
// Names: agent_workspace (agent workspace screens and routing), automation (the AI assistant),
// templates (state-filtered document and email templates, and rules that generate them),
// brokerage (a brokerage owner oversees the deals of agents who accept an invite).

export type FeatureName = 'agent_workspace' | 'automation' | 'templates' | 'brokerage';

function parse(list: string | undefined): Set<string> {
  return new Set(
    (list || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isFeatureOn(name: FeatureName, list?: string): boolean {
  return parse(list ?? process.env.RELAY_FEATURES).has(name);
}

/** For client components: reads the NEXT_PUBLIC_ copy, which Next inlines at build time. */
export function isFeatureOnClient(name: FeatureName): boolean {
  return parse(process.env.NEXT_PUBLIC_RELAY_FEATURES).has(name);
}

export const FEATURE_OFF_MESSAGE = 'Not found';
