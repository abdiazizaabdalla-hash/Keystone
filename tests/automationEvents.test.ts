import { describe, expect, it } from 'vitest';
import { buildEventRow, emitEvent, type EventRow, type EventStore } from '@/lib/automation/eventCore';

function memoryStore(): EventStore & { rows: EventRow[] } {
  const rows: EventRow[] = [];
  return {
    rows,
    async insert(row) {
      if (rows.some((r) => r.dedupe_key === row.dedupe_key)) return false; // same as the unique index
      rows.push(row);
      return true;
    },
  };
}
const tx = '11111111-1111-1111-1111-111111111111';
const owner = '22222222-2222-2222-2222-222222222222';

describe('automation events', () => {
  it('rejects an unknown type, a missing owner, or no deal/listing', () => {
    expect(buildEventRow({ ownerUserId: owner, transactionId: tx, type: 'send_everything' as never })).toBeNull();
    expect(buildEventRow({ ownerUserId: '', transactionId: tx, type: 'deal_closed' })).toBeNull();
    expect(buildEventRow({ ownerUserId: owner, type: 'deal_closed' })).toBeNull();
  });

  it('records nothing when the feature is off', async () => {
    const store = memoryStore();
    expect(await emitEvent({ ownerUserId: owner, transactionId: tx, type: 'deal_closed' }, { store, featureOn: false })).toBe(false);
    expect(store.rows).toHaveLength(0);
  });

  it('the same dedupe key is recorded once (replay-safe)', async () => {
    const store = memoryStore();
    const e = { ownerUserId: owner, transactionId: tx, type: 'deal_closed' as const, dedupeKey: `deal_closed:${tx}` };
    expect(await emitEvent(e, { store, featureOn: true })).toBe(true);
    expect(await emitEvent(e, { store, featureOn: true })).toBe(false);
    expect(store.rows).toHaveLength(1);
  });

  it('without a key, each occurrence is its own event', async () => {
    const store = memoryStore();
    const e = { ownerUserId: owner, transactionId: tx, type: 'step_ticked' as const };
    await emitEvent(e, { store, featureOn: true });
    await emitEvent(e, { store, featureOn: true });
    expect(store.rows).toHaveLength(2);
  });

  it('never throws when the store fails, so the calling request is not affected', async () => {
    const broken: EventStore = { insert: async () => { throw new Error('db down'); } };
    await expect(emitEvent({ ownerUserId: owner, transactionId: tx, type: 'deal_closed' }, { store: broken, featureOn: true })).resolves.toBe(false);
  });
});
