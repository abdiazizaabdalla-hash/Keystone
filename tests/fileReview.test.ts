import { describe, expect, it } from 'vitest';
import { cleanRequiredTypes, compareReviewRows, inReviewWindow, missingRequired, REQUIRABLE_TYPES } from '@/lib/fileReview';

const today = '2026-11-03';

describe('cleanRequiredTypes', () => {
  it('keeps only real document types, once each, in taxonomy order', () => {
    expect(cleanRequiredTypes(['Survey', 'Purchase Contract', 'Survey', 'Nonsense', 42, 'General'])).toEqual(['Purchase Contract', 'Survey']);
    expect(cleanRequiredTypes('Survey')).toEqual([]);
    expect(REQUIRABLE_TYPES).not.toContain('General');
  });
});

describe('missingRequired', () => {
  it('lists the required types no document covers', () => {
    expect(missingRequired(['Purchase Contract', 'Survey'], [{ document_type: 'Survey' }, { document_type: null }])).toEqual(['Purchase Contract']);
    expect(missingRequired([], [])).toEqual([]);
  });
});

describe('inReviewWindow', () => {
  it('lists closed files from the last 180 days and open files closing within 30 days', () => {
    const f = (status: string, closing_date: string | null, updated_at: string | null = null) => inReviewWindow({ id: 'x', status, closing_date, updated_at }, 'Closed', today);
    expect(f('Closed', '2026-10-01')).toBe(true);
    expect(f('Closed', '2026-03-01')).toBe(false);
    expect(f('Closed', null, '2026-10-20T00:00:00Z')).toBe(true);
    expect(f('Contract Pending', '2026-11-20')).toBe(true);
    expect(f('Contract Pending', '2026-12-20')).toBe(false);
    expect(f('Contract Pending', '2026-10-01')).toBe(false);
    expect(f('Contract Pending', null)).toBe(false);
  });
});

describe('compareReviewRows', () => {
  it('puts unreviewed files with gaps first, then flagged, then clean, then reviewed', () => {
    const rows = [
      { id: 'reviewed', missing: [], review: { status: 'reviewed' as const }, closingDate: '2026-10-30' },
      { id: 'clean', missing: [], review: null, closingDate: '2026-10-29' },
      { id: 'flagged', missing: ['Survey'], review: { status: 'flagged' as const }, closingDate: '2026-10-01' },
      { id: 'gaps-old', missing: ['Survey'], review: null, closingDate: '2026-09-01' },
      { id: 'gaps-new', missing: ['Survey'], review: null, closingDate: '2026-10-20' },
    ];
    expect([...rows].sort(compareReviewRows).map((r) => r.id)).toEqual(['gaps-new', 'gaps-old', 'flagged', 'clean', 'reviewed']);
  });
});
