import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';
import { checkRateLimit } from '@/lib/rateLimit';
import { syncTransactionCalendar } from '@/lib/calendarSync';
import { getDealCalendarStatus } from '@/lib/dealCalendar';

export const maxDuration = 60;

// Only the coordinator who owns the deal sees or triggers this.
async function loadOwnedDeal(request: NextRequest, transactionId: string) {
  const { user } = await getUserFromRequest(request);
  if (isAgentUser(user)) return { error: NextResponse.json({ error: 'Not available' }, { status: 403 }) } as const;
  const { data: tx } = await supabaseServer.from('transactions').select('id, tc_user_id').eq('id', transactionId).maybeSingle();
  if (!tx || tx.tc_user_id !== user.id) {
    return { error: NextResponse.json({ error: 'You do not have permission to manage this deal' }, { status: 403 }) } as const;
  }
  return { user } as const;
}

// GET: which calendars on this deal are connected.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const r = await loadOwnedDeal(request, id);
    if ('error' in r) return r.error;
    return NextResponse.json(await getDealCalendarStatus(id, r.user.id));
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Calendar status failed:', error);
    return NextResponse.json({ error: 'Failed to load calendar status' }, { status: 500 });
  }
}

// POST: add every date on the deal to every connected calendar (yours and the agent's) right now.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const r = await loadOwnedDeal(request, id);
    if ('error' in r) return r.error;
    if (!(await checkRateLimit(`deal-calendar-sync:${r.user.id}`, 20, 10 * 60))) {
      return NextResponse.json({ error: 'Too many syncs. Try again in a few minutes.' }, { status: 429 });
    }
    await syncTransactionCalendar(id);
    const status = await getDealCalendarStatus(id, r.user.id);
    return NextResponse.json({ ok: true, ...status });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Calendar sync failed:', error);
    return NextResponse.json({ error: 'Failed to sync calendar' }, { status: 500 });
  }
}
