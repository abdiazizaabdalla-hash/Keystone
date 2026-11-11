import { describe, it, expect } from 'vitest';
import { findDuplicate, type LoggedEmail } from '@/lib/emailLogCore';

const now = new Date('2026-11-10T18:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
const row = (over: Partial<LoggedEmail>): LoggedEmail => ({ task_id: null, to_emails: ['agent@x.com'], subject: 'Inspection', sent_at: hoursAgo(2), ...over });

describe('duplicate email guard', () => {
  it('blocks the same step to the same person inside the window', () => {
    expect(findDuplicate([row({ task_id: 't1' })], { taskId: 't1', to: ['AGENT@x.com'], subject: 'Different words' }, now)).not.toBeNull();
  });
  it('lets a different step or a different person through', () => {
    expect(findDuplicate([row({ task_id: 't1' })], { taskId: 't2', to: ['agent@x.com'], subject: 'Inspection' }, now)).toBeNull();
    expect(findDuplicate([row({ task_id: 't1' })], { taskId: 't1', to: ['lender@x.com'], subject: 'Inspection' }, now)).toBeNull();
  });
  it('without a step, matches on subject ignoring case and spacing', () => {
    expect(findDuplicate([row({})], { to: ['agent@x.com'], subject: '  inspection ' }, now)).not.toBeNull();
    expect(findDuplicate([row({})], { to: ['agent@x.com'], subject: 'Appraisal' }, now)).toBeNull();
  });
  it('ignores emails older than the window', () => {
    expect(findDuplicate([row({ task_id: 't1', sent_at: hoursAgo(30) })], { taskId: 't1', to: ['agent@x.com'], subject: 'x' }, now)).toBeNull();
  });
});
