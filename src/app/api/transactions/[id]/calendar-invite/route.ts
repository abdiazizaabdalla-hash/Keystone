import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';
import { checkRateLimit } from '@/lib/rateLimit';
import { getDealCalendarStatus } from '@/lib/dealCalendar';
import { sendAgentCalendarInviteEmail } from '@/lib/agentPortalEmails';
import { logAudit } from '@/lib/audit';

// POST: emails each agent on this deal who has not connected a calendar a link to connect it.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await getUserFromRequest(request);
    if (isAgentUser(user)) return NextResponse.json({ error: 'Not available' }, { status: 403 });
    const { data: tx } = await supabaseServer.from('transactions').select('id, tc_user_id, property_address').eq('id', id).maybeSingle();
    if (!tx || tx.tc_user_id !== user.id) {
      return NextResponse.json({ error: 'You do not have permission to manage this deal' }, { status: 403 });
    }
    if (!(await checkRateLimit(`deal-calendar-invite:${user.id}:${id}`, 3, 60 * 60))) {
      return NextResponse.json({ error: 'You already sent this a few times. Try again in an hour.' }, { status: 429 });
    }

    const status = await getDealCalendarStatus(id, user.id);
    const targets = status.agents.filter((a) => !a.connected && a.email);
    if (targets.length === 0) {
      return NextResponse.json({ error: status.agents.length ? 'Every agent on this deal already has a calendar connected.' : 'This agent has not accepted their Relay TC invite yet, so there is no login to send the calendar link to. Invite them to the deal first.' }, { status: 400 });
    }

    const tcLabel = (user.user_metadata?.full_name as string | undefined) || user.email || 'Your transaction coordinator';
    const settingsUrl = `${request.nextUrl.origin}/agent/settings#calendar`;
    for (const t of targets) {
      await sendAgentCalendarInviteEmail({ toEmail: t.email as string, tcLabel, propertyAddress: (tx.property_address as string | null) || null, settingsUrl });
    }
    await logAudit(request, user, 'deal.calendar_invite', { entityType: 'transaction', entityId: id, metadata: { sent: targets.length } });
    return NextResponse.json({ ok: true, sent: targets.length });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Calendar invite failed:', error);
    return NextResponse.json({ error: 'Failed to send the calendar link' }, { status: 500 });
  }
}
