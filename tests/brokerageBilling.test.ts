import { describe, it, expect } from 'vitest';
import { brokerageLineItems, brokerageQuantity, extraSeatsFromQuantity, minimumExtraSeats, validateExtraSeats, accountStatusForSubscription } from '@/lib/brokerageBilling';

describe('brokerage quantity', () => {
  it('bills the included agents when no extra agents are bought', () => {
    expect(brokerageQuantity('basic', 0)).toBe(10);
    expect(brokerageQuantity('pro', 0)).toBe(25);
  });
  it('adds the extra agents to the included number', () => {
    expect(brokerageQuantity('basic', 2)).toBe(12);
    expect(brokerageQuantity('pro', 5)).toBe(30);
  });
  it('ignores a negative number', () => {
    expect(brokerageQuantity('basic', -3)).toBe(10);
  });
  it('reads extra agents back from a quantity', () => {
    expect(extraSeatsFromQuantity('basic', 12)).toBe(2);
    expect(extraSeatsFromQuantity('basic', 10)).toBe(0);
    expect(extraSeatsFromQuantity('pro', 20)).toBe(0);
  });
  it('makes one Checkout line item at that quantity', () => {
    expect(brokerageLineItems('price_x', 'basic', 2)).toEqual([{ price: 'price_x', quantity: 12 }]);
    expect(brokerageLineItems('price_y', 'pro', 0)).toEqual([{ price: 'price_y', quantity: 25 }]);
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
