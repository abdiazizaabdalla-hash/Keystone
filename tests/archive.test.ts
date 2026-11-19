import { describe, it, expect } from 'vitest';
import { ARCHIVE_REASONS, archiveLabel, cleanArchiveInput, isArchived, isArchiveReason } from '@/lib/archive';

describe('archive helpers', () => {
  it('knows every listed reason', () => {
    for (const r of ARCHIVE_REASONS) expect(isArchiveReason(r.id)).toBe(true);
    expect(isArchiveReason('nope')).toBe(false);
  });
  it('accepts a valid reason with an optional note', () => {
    const r = cleanArchiveInput({ reason: 'financing', note: '  loan denied  ' });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.reason).toBe('financing'); expect(r.note).toBe('loan denied'); }
  });
  it('requires a note for "other"', () => {
    expect(cleanArchiveInput({ reason: 'other', note: '' }).ok).toBe(false);
    expect(cleanArchiveInput({ reason: 'other', note: 'seller moved' }).ok).toBe(true);
  });
  it('rejects unknown reasons and bad bodies', () => {
    expect(cleanArchiveInput({ reason: 'bogus' }).ok).toBe(false);
    expect(cleanArchiveInput(null).ok).toBe(false);
  });
  it('detects archived deals and labels reasons', () => {
    expect(isArchived({ archived_at: '2026-01-01T00:00:00Z' })).toBe(true);
    expect(isArchived({ archived_at: null })).toBe(false);
    expect(isArchived(null)).toBe(false);
    expect(archiveLabel('fell_through')).toBe('Deal fell through');
  });
});
