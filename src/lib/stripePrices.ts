// Every Stripe price Relay bills, one environment variable each, so a price can be changed in one place without touching code.
//
// Prices are immutable in Stripe: to change an amount, create a new price in the dashboard, paste its id into the variable below
// in Vercel, and redeploy. Existing subscribers keep the price they signed up on. The amounts shown on the website are separate
// (plans.ts and brokeragePricing.ts), so change those too.
//
// Agents and coordinators have their own variables. If an agent variable is not set it falls back to the coordinator one, and
// that falls back to the original shared variable, so nothing breaks while prices are being split.

export type Audience = 'agent' | 'tc';
export type PersonalPlan = 'starter' | 'pro' | 'team' | 'brokerage';
export type BrokerageBillingTier = 'basic' | 'pro';

type Env = Record<string, string | undefined>;

const clean = (value: string | undefined): string | undefined => {
  const v = (value ?? '').trim();
  return v || undefined;
};
const pick = (env: Env, ...names: string[]): string | undefined => {
  for (const name of names) {
    const v = clean(env[name]);
    if (v) return v;
  }
  return undefined;
};

/** The price id for a personal plan. Agents have their own Starter and Pro; Team and the old Brokerage plan are coordinator plans. */
export function priceIdFor(plan: PersonalPlan, audience: Audience = 'tc', env: Env = process.env): string | undefined {
  switch (plan) {
    case 'starter':
      return audience === 'agent'
        ? pick(env, 'STRIPE_PRICE_AGENT_STARTER', 'STRIPE_PRICE_TC_STARTER', 'STRIPE_PRICE_STARTER')
        : pick(env, 'STRIPE_PRICE_TC_STARTER', 'STRIPE_PRICE_STARTER');
    case 'pro':
      return audience === 'agent'
        ? pick(env, 'STRIPE_PRICE_AGENT_PRO', 'STRIPE_PRICE_TC_PRO', 'STRIPE_PRICE_PRO')
        : pick(env, 'STRIPE_PRICE_TC_PRO', 'STRIPE_PRICE_PRO');
    case 'team':
      return pick(env, 'STRIPE_PRICE_TC_TEAM', 'STRIPE_PRICE_TEAM');
    case 'brokerage':
      return pick(env, 'STRIPE_PRICE_BROKERAGE');
  }
}

/**
 * The one graduated price a brokerage tier bills: the monthly base covers the included agents (a flat fee on the first tier), and each
 * agent beyond that is the per-unit price on the second tier. The subscription quantity is the number of agents paid for.
 */
export function brokeragePriceId(tier: BrokerageBillingTier, env: Env = process.env): string | undefined {
  return tier === 'pro' ? pick(env, 'STRIPE_PRICE_BROKERAGE_PRO') : pick(env, 'STRIPE_PRICE_BROKERAGE_BASIC');
}

/** A brokerage tier can be sold only when its price is configured. */
export function brokerageBillingReady(tier: BrokerageBillingTier, env: Env = process.env): boolean {
  return Boolean(brokeragePriceId(tier, env));
}

/** Every variable, for the setup guide and the tests. */
export const STRIPE_PRICE_ENV_VARS = [
  'STRIPE_PRICE_AGENT_STARTER',
  'STRIPE_PRICE_AGENT_PRO',
  'STRIPE_PRICE_TC_STARTER',
  'STRIPE_PRICE_TC_PRO',
  'STRIPE_PRICE_TC_TEAM',
  'STRIPE_PRICE_BROKERAGE_BASIC',
  'STRIPE_PRICE_BROKERAGE_PRO',
] as const;
