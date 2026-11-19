import { NextRequest, NextResponse } from 'next/server';
import { AuthError, getUserFromRequest } from '../auth';
import { assertNotCollaborator } from '../workspaceGuard';
import { assertAgentHas } from '../agentGates';
import { AUTOMATION_PLAN_MESSAGE, userMayAutomate } from './plan';
import { isFeatureOn } from '../features';
import { supabaseServer } from '../supabase';
import { dealAutomationOwner } from './events';

// Shared guards for the /api/automation routes. Off (404) until the `automation` flag is on; refuses free collaborators and
// brokerage-provided (Basic) agent workspaces; every deal or listing must belong to the signed-in owner.

export async function requireAutomationUser(request: NextRequest) {
  const { user, isAdmin } = await getUserFromRequest(request);
  if (!isFeatureOn('automation')) throw new AuthError('Not found', 404);
  assertNotCollaborator(user);
  assertAgentHas(user, 'automation');
  if (!userMayAutomate(user)) throw new AuthError(AUTOMATION_PLAN_MESSAGE, 403);
  return { user, isAdmin };
}

export interface Scope {
  transactionId: string | null;
  listingId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads transactionId / listingId (exactly one) and proves the deal or listing is the caller's. Anyone else's is a 404. */
export async function requireOwnedScope(userId: string, input: { transactionId?: unknown; listingId?: unknown }): Promise<Scope> {
  const tx = typeof input.transactionId === 'string' && input.transactionId ? input.transactionId : null;
  const li = typeof input.listingId === 'string' && input.listingId ? input.listingId : null;
  if ((tx === null) === (li === null)) throw new AuthError('Give either a transaction or a listing', 400);
  if (tx) {
    if (!UUID.test(tx) || (await dealAutomationOwner(tx)) !== userId) throw new AuthError('Transaction not found', 404);
    return { transactionId: tx, listingId: null };
  }
  const { data } = UUID.test(li!) ? await supabaseServer.from('listings').select('tc_user_id').eq('id', li!).maybeSingle() : { data: null };
  if (!data || data.tc_user_id !== userId) throw new AuthError('Listing not found', 404);
  return { transactionId: null, listingId: li };
}

export function automationError(error: unknown, what: string) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  const info = error as { code?: string } | null;
  if (info && (info.code === 'PGRST205' || info.code === '42P01')) {
    console.error(`Error trying to ${what} (database not updated):`, error);
    return NextResponse.json({ error: 'The database needs one more update before the assistant works. Run add-automation-foundation.sql in Supabase.' }, { status: 500 });
  }
  console.error(`Error trying to ${what}:`, error);
  return NextResponse.json({ error: `Failed to ${what}` }, { status: 500 });
}

export const DEFAULT_SETTINGS = { mode: 'off', follow_up_days: 3, quiet_start_hour: 21, quiet_end_hour: 7, time_zone: 'America/Chicago', daily_send_cap: 20 } as const;
