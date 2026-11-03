import { describe, expect, it } from 'vitest';
import { cleanDeductions, computeSplit, SplitError, splitLabel } from '../src/lib/commissionMath';

describe('computeSplit', () => {
  it('splits by percent', () => {
    const r = computeSplit({ gross: 10000, splitType: 'percent', splitValue: 80 });
    expect(r.agentNetCents).toBe(800000);
    expect(r.brokerageNetCents).toBe(200000);
    expect(r.agentPercentOfGross).toBe(80);
  });
  it('splits by a fixed amount to the agent, and by a fixed brokerage fee', () => {
    expect(computeSplit({ gross: 9000, splitType: 'flat_agent', splitValue: 6000 }).brokerageNetCents).toBe(300000);
    const fee = computeSplit({ gross: 9000, splitType: 'flat_brokerage', splitValue: 500 });
    expect(fee.agentNetCents).toBe(850000);
    expect(fee.brokerageNetCents).toBe(50000);
  });
  it('charges fees to the agent and pays them to the brokerage, and the totals always add up', () => {
    const r = computeSplit({ gross: 12345.67, splitType: 'percent', splitValue: 70.5, deductions: [{ label: 'Transaction fee', amount: 395 }, { label: 'E&O', amount: 40.25 }] });
    expect(r.agentNetCents + r.brokerageNetCents).toBe(r.grossCents);
    expect(r.deductionsCents).toBe(43525);
    expect(r.agentNetCents).toBe(r.agentShareCents - 43525);
  });
  it('never loses a cent to rounding', () => {
    for (const [gross, pct] of [[333.33, 33.33], [0.07, 50], [19999.99, 12.345]] as const) {
      const r = computeSplit({ gross, splitType: 'percent', splitValue: pct });
      expect(r.agentNetCents + r.brokerageNetCents).toBe(r.grossCents);
    }
  });
  it('refuses nonsense', () => {
    const bad = (i: Parameters<typeof computeSplit>[0]) => expect(() => computeSplit(i)).toThrow(SplitError);
    bad({ gross: 0, splitType: 'percent', splitValue: 50 });
    bad({ gross: -5, splitType: 'percent', splitValue: 50 });
    bad({ gross: NaN, splitType: 'percent', splitValue: 50 });
    bad({ gross: 1000, splitType: 'percent', splitValue: 101 });
    bad({ gross: 1000, splitType: 'percent', splitValue: -1 });
    bad({ gross: 1000, splitType: 'flat_agent', splitValue: 1001 });
    bad({ gross: 1000, splitType: 'flat_brokerage', splitValue: 2000 });
    bad({ gross: 1000, splitType: 'percent', splitValue: 50, deductions: [{ label: 'x', amount: 600 }] });
    bad({ gross: 1000, splitType: 'nope' as never, splitValue: 50 });
  });
});

describe('cleanDeductions', () => {
  it('trims, drops blanks, rounds to cents, and rejects bad rows', () => {
    expect(cleanDeductions([{ label: '  Fee ', amount: '10.005' }, { label: '', amount: 0 }])).toEqual([{ label: 'Fee', amount: 10.01 }]);
    expect(cleanDeductions(undefined)).toEqual([]);
    expect(() => cleanDeductions([{ label: '', amount: 5 }])).toThrow(SplitError);
    expect(() => cleanDeductions([{ label: 'x', amount: -1 }])).toThrow(SplitError);
    expect(() => cleanDeductions('x')).toThrow(SplitError);
    expect(() => cleanDeductions(Array.from({ length: 11 }, () => ({ label: 'x', amount: 1 })))).toThrow(SplitError);
  });
});

describe('splitLabel', () => {
  it('reads plainly', () => {
    expect(splitLabel('percent', 80)).toBe('Agent keeps 80%');
    expect(splitLabel('flat_agent', 6000)).toBe('Agent gets $6,000.00');
    expect(splitLabel('flat_brokerage', 500)).toBe('Brokerage fee $500.00');
  });
});
