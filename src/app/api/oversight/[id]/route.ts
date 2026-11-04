import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { assertBrokerageOwner } from '@/lib/oversight';
import { oversightError } from '@/lib/oversightServer';
import { SplitError, cleanBaseFees, cleanRate, isSplitType, toCents } from '@/lib/commissionMath';
import { isCapReset } from '@/lib/commissionCap';

// DELETE: cancel an invitation, or remove an agent from the brokerage. The agent keeps all of their deals.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await getUserFromRequest(request);
    assertBrokerageOwner(user);
    const { data: link, error } = await supabaseServer.from('brokerage_links').select('id, status, agent_user_id').eq('id', id).eq('owner_user_id', user.id).in('status', ['pending', 'active']).maybeSingle();
    if (error) throw error;
    if (!link) throw new AuthError('Not found', 404);
    const { error: updateError } = await supabaseServer.from('brokerage_links').update({ status: 'removed', ended_at: new Date().toISOString() }).eq('id', id);
    if (updateError) throw updateError;
    await logAudit(request, user, link.status === 'active' ? 'brokerage.remove_agent' : 'brokerage.cancel_invite', { entityType: 'brokerage_link', entityId: id, metadata: { agentUserId: link.agent_user_id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return oversightError(error, 'remove that agent');
  }
}

// PATCH: the agent's base commission terms. Every key is optional; only the ones sent are changed.
//   { commissionType: 'percent' | 'flat', commissionValue }  the agent's commission rate: a percent of the sale price, or a flat fee ({ commissionType: null } clears it)
//   { splitType, splitValue }  the base split ({ splitType: null } clears it)
//   { fees: [{ label, amount }] }  fees charged to the agent's share on every deal (an empty list clears them)
//   { cap: { amount, reset: 'calendar_year' | 'anniversary', start? } }  the brokerage's yearly cap on this agent ({ cap: null } clears it)
// These are the starting point for each deal's commission estimate; the owner can still change them on a deal.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await getUserFromRequest(request);
    assertBrokerageOwner(user);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const { data: link, error } = await supabaseServer.from('brokerage_links').select('id').eq('id', id).eq('owner_user_id', user.id).eq('status', 'active').maybeSingle();
    if (error) throw error;
    if (!link) throw new AuthError('Not found', 404);

    const update: Record<string, unknown> = {};
    if ('commissionType' in body) {
      if (body.commissionType === null) {
        update.default_commission_type = null;
        update.default_commission_value = null;
      } else {
        const rate = cleanRate(body.commissionType, body.commissionValue);
        update.default_commission_type = rate.type;
        update.default_commission_value = rate.value;
      }
    }
    if ('splitType' in body) {
      if (body.splitType === null) {
        update.default_split_type = null;
        update.default_split_value = null;
      } else {
        const value = typeof body.splitValue === 'number' ? body.splitValue : Number(body.splitValue);
        if (!isSplitType(body.splitType)) throw new SplitError('Choose how the commission is split.');
        if (!Number.isFinite(value) || value < 0 || (body.splitType === 'percent' && value > 100) || value > 100_000_000) throw new SplitError(body.splitType === 'percent' ? 'A percentage must be between 0 and 100.' : 'Enter an amount of zero or more.');
        update.default_split_type = body.splitType;
        update.default_split_value = Math.round(value * 100) / 100;
      }
    }
    if ('fees' in body) update.default_fees = cleanBaseFees(body.fees ?? []);
    if ('cap' in body) {
      const cap = body.cap as Record<string, unknown> | null;
      if (cap === null) {
        update.cap_cents = null;
        update.cap_reset = null;
        update.cap_start = null;
      } else {
        const amount = typeof cap?.amount === 'number' ? cap.amount : Number(cap?.amount);
        if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) throw new SplitError('Enter the cap as an amount above zero.');
        if (!isCapReset(cap?.reset)) throw new SplitError('Choose when the cap resets.');
        let start: string | null = null;
        if (cap?.start !== undefined && cap.start !== null && cap.start !== '') {
          if (typeof cap.start !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(cap.start) || Number.isNaN(Date.parse(cap.start))) throw new SplitError('Enter the cap start date as a date.');
          start = cap.start;
        }
        update.cap_cents = toCents(amount);
        update.cap_reset = cap.reset;
        update.cap_start = start;
      }
    }
    if (Object.keys(update).length === 0) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });

    const { error: updateError } = await supabaseServer.from('brokerage_links').update(update).eq('id', id);
    if (updateError) {
      if (isMissingColumn(updateError)) return NextResponse.json({ error: 'The database needs one more update before fees and caps can be saved. Run add-commission-estimates.sql in Supabase.' }, { status: 500 });
      throw updateError;
    }
    await logAudit(request, user, 'brokerage.base_terms', { entityType: 'brokerage_link', entityId: id, metadata: update });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SplitError) return NextResponse.json({ error: error.message }, { status: 400 });
    return oversightError(error, 'save those terms');
  }
}

const isMissingColumn = (error: unknown) => {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === '42703' || e?.code === 'PGRST204' || /column .* does not exist/i.test(e?.message ?? '');
};
