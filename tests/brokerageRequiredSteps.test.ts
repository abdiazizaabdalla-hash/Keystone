import { describe, expect, it } from 'vitest';
import { DEFAULT_REQUIRED_STEPS, cleanRequiredSteps, stepsToAdd } from '@/lib/brokerageRequiredStepsRules';

describe('brokerage required steps', () => {
  it('trims, drops blanks and repeats, and keeps days in range', () => {
    expect(cleanRequiredSteps([{ name: '  Broker  file review ', dueDays: 3 }, { name: 'broker file review' }, { name: '' }, { name: 'Wire check', dueDays: 9999 }, { name: 'No date', dueDays: '' }, 'junk']))
      .toEqual([{ name: 'Broker file review', dueDays: 3 }, { name: 'Wire check', dueDays: 365 }, { name: 'No date', dueDays: null }]);
  });
  it('keeps at most 20 and ignores a non-list', () => {
    expect(cleanRequiredSteps(Array.from({ length: 40 }, (_, i) => ({ name: `Step ${i}` })))).toHaveLength(20);
    expect(cleanRequiredSteps('nope')).toEqual([]);
  });
  it('adds only the steps a file lacks, ignoring case', () => {
    const required = [{ name: 'Broker file review', dueDays: 3 }, { name: 'Wire check', dueDays: null }];
    expect(stepsToAdd(['broker FILE review', 'Inspection'], required)).toEqual([{ name: 'Wire check', dueDays: null }]);
    expect(stepsToAdd([], required)).toHaveLength(2);
  });
});

describe('starting checklist', () => {
  it('offers Relay’s baseline steps, with days only where they count from acceptance', () => {
    const t = DEFAULT_REQUIRED_STEPS.transaction;
    expect(t.map((s) => s.name)).toEqual(['Contract & File Setup', 'Earnest Money & Option', 'Inspection & Repairs', 'Title, Appraisal & Financing', 'Clear to Close', 'Closing & Post-Closing']);
    expect(t.map((s) => s.dueDays)).toEqual([1, 3, 10, 21, null, null]);
  });
  it('keeps listing steps that fall before the list date, and survives cleaning', () => {
    const l = DEFAULT_REQUIRED_STEPS.listing;
    expect(l[0].dueDays).toBe(-21);
    expect(cleanRequiredSteps(l, 'listing')).toEqual(l);
    // A transaction step cannot be due before acceptance.
    expect(cleanRequiredSteps([{ name: 'x', dueDays: -5 }], 'transaction')[0].dueDays).toBe(0);
  });
});
