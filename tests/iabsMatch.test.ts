import { describe, expect, it } from 'vitest';
import { iabsForBrokerage, brokerageKey } from '@/lib/iabsMatch';

const forms = [
  { name: 'Acme Realty IABS' },
  { name: 'Lone Star Group - Information About Brokerage Services' },
  { name: 'Seller Disclosure' },
  { name: 'IABS' },
];

describe('iabsForBrokerage', () => {
  it('matches the disclosure named for the agent’s brokerage, ignoring case and suffixes', () => {
    expect(iabsForBrokerage(forms, 'ACME Realty, LLC').map((f) => f.name)).toEqual(['Acme Realty IABS']);
    expect(iabsForBrokerage(forms, 'Lone Star Group Inc.').map((f) => f.name)).toEqual(['Lone Star Group - Information About Brokerage Services']);
  });
  it('does not offer another brokerage’s form, a non-disclosure, or an unnamed IABS', () => {
    expect(iabsForBrokerage(forms, 'Other Brokers')).toEqual([]);
    expect(iabsForBrokerage(forms, 'Seller Disclosure')).toEqual([]);
  });
  it('returns nothing when the brokerage is unknown', () => {
    expect(iabsForBrokerage(forms, null)).toEqual([]);
    expect(iabsForBrokerage(forms, '  ')).toEqual([]);
  });
  it('normalizes names', () => {
    expect(brokerageKey('Acme Realty, LLC')).toBe('acme realty');
  });
});
