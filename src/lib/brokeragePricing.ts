// The one place brokerage prices live. Pages, the account summary and the tests all read from here.
// BUILT: the numbers, the estimate, and what each tier includes. NOT BUILT: charging them. A brokerage's tier and seats are a manual
// record in brokerage_accounts (nothing here talks to Stripe), so every figure below is an estimate of the recurring price, not a bill.
export type BrokerageTierId = 'basic' | 'pro';

export const BROKERAGE_PRICING: Record<BrokerageTierId, { base: number; includedAgents: number; extraAgent: number }> = {
  basic: { base: 99, includedAgents: 10, extraAgent: 15 },
  pro: { base: 199, includedAgents: 25, extraAgent: 20 },
};

export const dollars = (n: number) => `$${n}`;

/** Agents past the included number, each billed monthly. The included agents are never charged again. */
export function extraAgents(tier: BrokerageTierId, agentCount: number): number {
  return Math.max(0, Math.floor(agentCount) - BROKERAGE_PRICING[tier].includedAgents);
}

/** Estimated recurring monthly price: base + extra agents x the per-agent rate. */
export function estimatedMonthly(tier: BrokerageTierId, agentCount: number): number {
  const p = BROKERAGE_PRICING[tier];
  return p.base + extraAgents(tier, agentCount) * p.extraAgent;
}
