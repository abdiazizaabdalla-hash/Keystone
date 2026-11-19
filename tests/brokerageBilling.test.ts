import { describe, it, expect } from 'vitest';
import { brokerageLineItems, minimumExtraSeats, validateExtraSeats, accountStatusForSubscription } from '@/lib/brokerageBilling';

const prices = { base: 'price_base', extraAgent: 'price_extra' };

describe('brokerageLineItems', () => {
  it('charges only the base when no extra agents are bought', () => {
    expect(brokerageLineItems(prices, 0)).toEqual([{ price: 'price_base', quantity: 1 }]);
  });
  it('adds the per-agent price with the number of extra agents', () => {
    expect(brokerageLineItems(prices, 4)).toEqual([{ price: 'price_base', quantity: 1 }, { price: 'price_extra', quantity: 4 }]);
  });
  it('ignores a negative number', () => {
    expect(brokerageLineItems(prices, -2)).toEqual([{ price: 'price_base', quantity: 1 }]);
  });
});

describe('extra agents', () => {
  it('counts joined and invited agents against the included number', () => {
    expect(minimumExtraSeats('basic', { active: 8, pending: 1 })).toBe(0);
    expect(minimumExtraSeats('basic', { active: 10, pending: 3 })).toBe(3);
    expect(minimumExtraSeats('pro', { active: 25, pending: 0 })).toBe(0);
    expect(minimumExtraSeats('pro', { active: 27, pending: 1 })).toBe(3);
  });
  it('accepts a number at or above the minimum', () => {
    expect(validateExtraSeats('basic', 3, { active: 10, pending: 3 })).toBeNull();
    expect(validateExtraSeats('basic', 0, { active: 4, pending: 0 })).toBeNull();
  });
  it('refuses going below the agents already on the roster', () => {
    expect(validateExtraSeats('basic', 1, { active: 10, pending: 3 })).toMatch(/at least 3/);
  });
  it('refuses values that are not whole numbers of zero or more', () => {
    for (const bad of [-1, 1.5, '2', null, undefined, NaN]) expect(validateExtraSeats('pro', bad, { active: 0, pending: 0 })).not.toBeNull();
    expect(validateExtraSeats('pro', 501, { active: 0, pending: 0 })).not.toBeNull();
  });
});

describe('accountStatusForSubscription', () => {
  it('treats paying states as converted', () => {
    for (const s of ['active', 'trialing', 'past_due']) expect(accountStatusForSubscription(s)).toBe('converted');
  });
  it('treats ended or unpaid states as terminated', () => {
    for (const s of ['canceled', 'unpaid', 'incomplete_expired']) expect(accountStatusForSubscription(s)).toBe('terminated');
  });
  it('leaves other states alone', () => {
    for (const s of ['incomplete', 'paused']) expect(accountStatusForSubscription(s)).toBeNull();
  });
});
