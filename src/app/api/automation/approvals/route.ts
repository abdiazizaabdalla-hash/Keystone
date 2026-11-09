import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { automationError, requireAutomationUser } from '@/lib/automation/server';
import { kindLabel, summarizeAction } from '@/lib/automation/describe';

// GET: every draft waiting for the caller across all their deals (one list). ?countOnly=1 returns just the number for a badge.
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAutomationUser(request);
    if (request.nextUrl.searchParams.get('countOnly') === '1') {
      const { count, error } = await supabaseServer.from('automation_approvals').select('id', { count: 'exact', head: true }).eq('owner_user_id', user.id).eq('status', 'pending');
      if (error) throw error;
      return NextResponse.json({ pending: count ?? 0 });
    }
    const { data: approvals, error } = await supabaseServer.from('automation_approvals').select('action_id, draft, created_at').eq('owner_user_id', user.id).eq('status', 'pending').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    const ids = (approvals ?? []).map((a) => a.action_id as string);
    const { data: actions } = ids.length ? await supabaseServer.from('automation_actions').select('id, kind, transaction_id, listing_id, inputs').in('id', ids).eq('owner_user_id', user.id) : { data: [] };
    const txIds = [...new Set((actions ?? []).map((a) => a.transaction_id as string | null).filter((x): x is string => !!x))];
    const { data: tx } = txIds.length ? await supabaseServer.from('transactions').select('id, file_number, property_address').in('id', txIds) : { data: [] };
    const deals = new Map((tx ?? []).map((t) => [t.id as string, t]));
    const byId = new Map((actions ?? []).map((a) => [a.id as string, a]));
    return NextResponse.json({
      approvals: (approvals ?? []).flatMap((ap) => {
        const a = byId.get(ap.action_id as string);
        if (!a) return [];
        const inputs = (ap.draft ?? a.inputs ?? {}) as Record<string, unknown>;
        const deal = a.transaction_id ? deals.get(a.transaction_id as string) : null;
        return [{ actionId: a.id, kind: a.kind, label: kindLabel(a.kind as string), summary: summarizeAction(a.kind as string, inputs), inputs, createdAt: ap.created_at, transactionId: a.transaction_id, listingId: a.listing_id, deal: deal ? { fileNumber: deal.file_number, address: deal.property_address } : null }];
      }),
    });
  } catch (error) {
    return automationError(error, 'load the drafts waiting for you');
  }
}
