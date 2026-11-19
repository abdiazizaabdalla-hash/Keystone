import { describe, expect, it } from 'vitest';
import { cleanAgentProfile } from '@/lib/accountType';

describe('cleanAgentProfile', () => {
  it('keeps only known choices and trims the license number', () => {
    expect(cleanAgentProfile({ focus: ['listings', 'buyers', 'listings', 'boats', 5], dealsPerYear: '10_25', license: '  TX-123456 <script> ' })).toEqual({
      focus: ['listings', 'buyers'],
      dealsPerYear: '10_25',
      license: 'TX-123456 script',
    });
  });
  it('treats anything unknown or missing as empty', () => {
    expect(cleanAgentProfile({ focus: 'listings', dealsPerYear: 'lots', license: 12 })).toEqual({ focus: [], dealsPerYear: null, license: null });
    expect(cleanAgentProfile(null)).toEqual({ focus: [], dealsPerYear: null, license: null });
  });
  it('limits the license number length', () => {
    expect(cleanAgentProfile({ license: 'A'.repeat(100) }).license).toHaveLength(40);
  });
});
