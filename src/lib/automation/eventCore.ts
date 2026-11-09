import { randomUUID } from 'node:crypto';
import { isFeatureOn } from '../features';
import { EVENT_TYPES, type EventType } from './types';

// Pure part of the event log (no database import, so it is unit-testable). The Supabase store is in events.ts.
// Event log (plan 16.4 item 1). Existing write points call `emitDealEvent` after they have saved; automation reacts
// to the rows in transaction_events, never to the browser. Emitting is inert unless the `automation` flag is on, never
// throws, and never delays or fails the request that caused it.
//
// Dedupe: `dedupe_key` is unique, so emitting the same key twice records one event. Route-origin events use a key that
// is stable where the real-world event can only happen once (a deal closing, the same dates saved again) and a fresh
// key where each occurrence is genuinely new (a document upload, a step ticked). Downstream actions carry their own
// idempotency keys, so a repeated event can never send twice.

export interface NewEvent {
  ownerUserId: string;
  transactionId?: string | null;
  listingId?: string | null;
  type: EventType;
  payload?: Record<string, unknown>;
  /** Omit for "every occurrence is new". */
  dedupeKey?: string;
}

export interface EventRow {
  owner_user_id: string;
  transaction_id: string | null;
  listing_id: string | null;
  type: EventType;
  payload: Record<string, unknown>;
  dedupe_key: string;
}

export interface EventStore {
  /** Returns true if a new row was written, false if the dedupe key already existed. */
  insert(row: EventRow): Promise<boolean>;
}

/** Pure: validates and shapes an event. Returns null when it is not a valid event (bad type, no owner, no deal/listing). */
export function buildEventRow(e: NewEvent): EventRow | null {
  if (!(EVENT_TYPES as readonly string[]).includes(e.type)) return null;
  if (!e.ownerUserId) return null;
  const transactionId = e.transactionId ?? null;
  const listingId = e.listingId ?? null;
  if (!transactionId && !listingId) return null;
  return {
    owner_user_id: e.ownerUserId,
    transaction_id: transactionId,
    listing_id: listingId,
    type: e.type,
    payload: e.payload ?? {},
    dedupe_key: e.dedupeKey ?? `${e.type}:${transactionId ?? listingId}:${randomUUID()}`,
  };
}

/** Core: record one event. Never throws. Returns whether a new row was written. */
export async function emitEvent(e: NewEvent, opts: { store: EventStore; featureOn?: boolean }): Promise<boolean> {
  try {
    if (!(opts.featureOn ?? isFeatureOn('automation'))) return false;
    const row = buildEventRow(e);
    if (!row) return false;
    return await opts.store.insert(row);
  } catch (err) {
    console.error('Automation event failed:', err);
    return false;
  }
}
