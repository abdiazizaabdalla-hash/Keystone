import { describe, it, expect } from 'vitest';
import { priceIdFor, brokeragePriceIds, brokerageBillingReady, STRIPE_PRICE_ENV_VARS } from '@/lib/stripePrices';

describe('priceIdFor', () => {
  it('uses the separate agent and coordinator variables when both are set', () => {
    const env = { STRIPE_PRICE_AGENT_PRO: 'price_agent_pro', STRIPE_PRICE_TC_PRO: 'price_tc_pro', STRIPE_PRICE_PRO: 'price_old' };
    expect(priceIdFor('pro', 'agent', env)).toBe('price_agent_pro');
    expect(priceIdFor('pro', 'tc', env)).toBe('price_tc_pro');
  });
  it('falls back from agent to coordinator to the original shared variable', () => {
    expect(priceIdFor('starter', 'agent', { STRIPE_PRICE_TC_STARTER: 'tc' })).toBe('tc');
    expect(priceIdFor('starter', 'agent', { STRIPE_PRICE_STARTER: 'old' })).toBe('old');
    expect(priceIdFor('pro', 'tc', { STRIPE_PRICE_PRO: 'old' })).toBe('old');
  });
  it('never gives a coordinator the agent price', () => {
    expect(priceIdFor('pro', 'tc', { STRIPE_PRICE_AGENT_PRO: 'agent' })).toBeUndefined();
  });
  it('reads Team from its own variable, then the original', () => {
    expect(priceIdFor('team', 'tc', { STRIPE_PRICE_TC_TEAM: 'new', STRIPE_PRICE_TEAM: 'old' })).toBe('new');
    expect(priceIdFor('team', 'tc', { STRIPE_PRICE_TEAM: 'old' })).toBe('old');
  });
  it('treats blank and whitespace values as not set', () => {
    expect(priceIdFor('pro', 'agent', { STRIPE_PRICE_AGENT_PRO: '   ', STRIPE_PRICE_PRO: 'old' })).toBe('old');
    expect(priceIdFor('pro', 'tc', {})).toBeUndefined();
  });
});

describe('brokerage prices', () => {
  const env = {
    STRIPE_PRICE_BROKERAGE_BASIC: 'b', STRIPE_PRICE_BROKERAGE_BASIC_EXTRA_AGENT: 'bx',
    STRIPE_PRICE_BROKERAGE_PRO: 'p', STRIPE_PRICE_BROKERAGE_PRO_EXTRA_AGENT: 'px',
  };
  it('keeps Basic and Pro separate', () => {
    expect(brokeragePriceIds('basic', env)).toEqual({ base: 'b', extraAgent: 'bx' });
    expect(brokeragePriceIds('pro', env)).toEqual({ base: 'p', extraAgent: 'px' });
  });
  it('is ready for sale only when both prices of a tier are set', () => {
    expect(brokerageBillingReady('pro', env)).toBe(true);
    expect(brokerageBillingReady('basic', { STRIPE_PRICE_BROKERAGE_BASIC: 'b' })).toBe(false);
    expect(brokerageBillingReady('pro', {})).toBe(false);
  });
  it('lists the nine variables', () => {
    expect(STRIPE_PRICE_ENV_VARS).toHaveLength(9);
    expect(new Set(STRIPE_PRICE_ENV_VARS).size).toBe(9);
  });
});
