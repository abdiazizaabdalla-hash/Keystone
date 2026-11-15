import { describe, expect, it } from 'vitest';
import { cleanRequiredSteps, stepsToAdd } from '@/lib/brokerageRequiredStepsRules';

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
