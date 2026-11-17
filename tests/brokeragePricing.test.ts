import { describe, expect, it } from 'vitest';
import { BROKERAGE_PRICING, estimatedMonthly, extraAgents } from '@/lib/brokeragePricing';
import { BROKERAGE_TIERS } from '@/lib/marketingPricing';
import { brokerageHas, resolveAgentAccess } from '@/lib/tiers';

describe('brokerage pricing', () => {
  it('matches the published examples for Basic and Pro', () => {
    const basic = { 5: 99, 10: 99, 15: 174, 20: 249, 25: 324, 30: 399, 40: 549, 50: 699 };
    const pro = { 5: 199, 10: 199, 15: 199, 20: 199, 25: 199, 30: 299, 40: 499, 50: 699 };
    for (const [n, price] of Object.entries(basic)) expect(estimatedMonthly('basic', Number(n))).toBe(price);
    for (const [n, price] of Object.entries(pro)) expect(estimatedMonthly('pro', Number(n))).toBe(price);
  });
  it('never charges the included agents again', () => {
    expect(extraAgents('basic', 10)).toBe(0);
    expect(extraAgents('basic', 11)).toBe(1);
    expect(extraAgents('pro', 25)).toBe(0);
    expect(extraAgents('pro', 26)).toBe(1);
    expect(extraAgents('pro', 0)).toBe(0);
  });
  it('the public site reads the same numbers', () => {
    expect(BROKERAGE_TIERS.basic.price).toBe(`$${BROKERAGE_PRICING.basic.base}`);
    expect(BROKERAGE_TIERS.pro.agents).toBe(BROKERAGE_PRICING.pro.includedAgents);
    expect(BROKERAGE_TIERS.extraAgent).toEqual({ basic: '$15', pro: '$20' });
  });
});

describe('brokerage tier entitlements', () => {
  it('keeps the oversight basics, the six rules and commissions on Basic', () => {
    for (const f of ['dashboard', 'file_review', 'commission_statements', 'reporting_basic', 'multiple_administrators'] as const) expect(brokerageHas('basic', f)).toBe(true);
  });
  it('puts workflows, deeper reports, deal-type lists and scoped roles on Pro only', () => {
    for (const f of ['custom_workflows', 'reporting_advanced', 'advanced_analytics', 'compliance_templates_advanced', 'advanced_permissions'] as const) {
      expect(brokerageHas('basic', f)).toBe(false);
      expect(brokerageHas('pro', f)).toBe(true);
    }
  });
  it('sponsors Agent Pro only through a Pro brokerage, and an own subscription wins', () => {
    const none = { ownSubscription: false, adminGrant: false, brokerage: null, invitedByCoordinator: false };
    expect(resolveAgentAccess({ ...none, brokerage: { inGoodStanding: true, tier: 'pro' } })).toEqual({ level: 'pro', source: 'brokerage' });
    expect(resolveAgentAccess({ ...none, brokerage: { inGoodStanding: true, tier: 'basic' } })).toEqual({ level: 'basic', source: 'brokerage' });
    expect(resolveAgentAccess({ ...none, ownSubscription: true, brokerage: { inGoodStanding: true, tier: 'basic' } })).toEqual({ level: 'pro', source: 'own_subscription' });
    expect(resolveAgentAccess({ ...none, brokerage: { inGoodStanding: false, tier: 'pro' } })).toEqual({ level: 'none', source: null });
  });
});
