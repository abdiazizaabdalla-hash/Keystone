import { describe, it, expect } from 'vitest';
import { agentFeeOptions } from '@/lib/agentFees';

describe('agentFeeOptions', () => {
  it('lists transaction fee, listing fee and named charges', () => {
    const o = agentFeeOptions({ id: 'a', name: 'A', email: null, flat_fee: '400', listing_fee: 250, services: [{ id: 's1', name: 'Photos', amount: 75 }] });
    expect(o.map((x) => [x.label, x.amount])).toEqual([['Transaction coordination fee', 400], ['Listing coordination fee', 250], ['Photos', 75]]);
  });
  it('skips zero, empty and missing fees', () => {
    expect(agentFeeOptions({ id: 'a', name: 'A', email: null, flat_fee: 0, listing_fee: null, services: [{ id: 's', name: 'Free', amount: 0 }] })).toEqual([]);
  });
});
