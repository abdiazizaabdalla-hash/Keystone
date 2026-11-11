import { describe, it, expect } from 'vitest';
import { matchDocumentToTasks, type MatchTask } from '@/lib/documentMatch';

const t = (id: string, name: string, over: Partial<MatchTask> = {}): MatchTask => ({ id, name, completed: false, ...over });

describe('document to checklist matching', () => {
  it('matches a waiting-on step by document type', () => {
    const r = matchDocumentToTasks({ documentType: 'Title Commitment' }, [t('a', 'Request title commitment', { waiting_on: 'Title company' }), t('b', 'Schedule inspection')]);
    expect(r).toEqual(expect.objectContaining({ kind: 'match', taskId: 'a' }));
  });
  it('does not treat a scheduling step as waiting for the report', () => {
    expect(matchDocumentToTasks({ documentType: 'Inspection Report' }, [t('a', 'Schedule inspection')])).toEqual({ kind: 'none' });
    expect(matchDocumentToTasks({ documentType: 'Inspection Report' }, [t('a', 'Collect inspection report'), t('b', 'Schedule inspection')])).toEqual(expect.objectContaining({ kind: 'match', taskId: 'a' }));
  });
  it('is ambiguous when two steps fit equally, and never guesses', () => {
    const r = matchDocumentToTasks({ documentType: 'Inspection Report' }, [t('a', 'Collect inspection report'), t('b', 'Receive specialized inspection report')]);
    expect(r.kind).toBe('ambiguous');
  });
  it('a waiting step beats a plain one', () => {
    const r = matchDocumentToTasks({ documentType: 'Appraisal' }, [t('a', 'Appraisal report received'), t('b', 'Order appraisal report', { waiting_on: 'Lender' })]);
    expect(r).toEqual(expect.objectContaining({ kind: 'match', taskId: 'b' }));
  });
  it('ignores completed steps and generic document types', () => {
    expect(matchDocumentToTasks({ documentType: 'Survey' }, [t('a', 'Collect survey', { completed: true })])).toEqual({ kind: 'none' });
    expect(matchDocumentToTasks({ documentType: 'General' }, [t('a', 'Collect survey', { waiting_on: 'x' })])).toEqual({ kind: 'none' });
    expect(matchDocumentToTasks({ documentType: 'Other Contract Documents' }, [t('a', 'Collect documents', { waiting_on: 'x' })])).toEqual({ kind: 'none' });
  });
  it('a step the person chose on upload is a match, if it is still open', () => {
    expect(matchDocumentToTasks({ documentType: 'General', taskId: 'z' }, [t('z', 'Anything')])).toEqual(expect.objectContaining({ kind: 'match', taskId: 'z' }));
    expect(matchDocumentToTasks({ documentType: 'General', taskId: 'z' }, [t('z', 'Anything', { completed: true })])).toEqual({ kind: 'none' });
  });
});
