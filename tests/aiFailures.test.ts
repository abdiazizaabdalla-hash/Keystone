import { beforeEach, describe, expect, it, vi } from 'vitest';

const insert = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: {}, supabaseServer: { from: () => ({ insert }) } }));

import { logAiFailure, AI_FAILURE_LABEL } from '@/lib/aiFailures';

beforeEach(() => insert.mockReset());

describe('logAiFailure', () => {
  it('stores who, what, the reason, the file name and size, and a trimmed note', async () => {
    insert.mockResolvedValue({ error: null });
    await logAiFailure('u1', 'contract', 'unreadable', { detail: 'x'.repeat(500), fileName: 'scan.pdf', fileBytes: 1234.7 });
    expect(insert).toHaveBeenCalledTimes(1);
    const row = insert.mock.calls[0][0];
    expect(row).toMatchObject({ user_id: 'u1', feature: 'contract', reason: 'unreadable', file_name: 'scan.pdf', file_bytes: 1235 });
    expect(row.detail).toHaveLength(300);
  });

  it('takes the message from an Error and stores nothing else about it', async () => {
    insert.mockResolvedValue({ error: null });
    await logAiFailure('u1', 'offer', 'service_error', { detail: new Error('boom') });
    expect(insert.mock.calls[0][0]).toMatchObject({ detail: 'boom', file_name: null, file_bytes: null });
  });

  it('never throws, even when the table is missing or the database is down', async () => {
    insert.mockResolvedValue({ error: { message: 'relation does not exist' } });
    await expect(logAiFailure('u1', 'contract', 'unreadable')).resolves.toBeUndefined();
    insert.mockImplementation(() => { throw new Error('down'); });
    await expect(logAiFailure('u1', 'contract', 'unreadable')).resolves.toBeUndefined();
  });

  it('has a plain-language label for every reason', () => {
    for (const r of ['unreadable', 'not_a_document', 'too_large', 'wrong_type', 'upload_error', 'service_error', 'not_configured', 'rate_limited']) {
      expect(AI_FAILURE_LABEL[r]).toBeTruthy();
    }
  });
});
