import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { getVisibleTcUserIds } from '@/lib/team';
import { isAgentUser } from '@/lib/agentPortal';
import { daysUntil } from '@/lib/keyDates';

// GET /api/key-dates/upcoming?days=14
// Every open critical date across the caller's open transactions (their
// team's too, for an owner) that is overdue or due within `days` days.
// Powers the "Critical dates" card on the dashboard. Read-only, so like the
// attention summary it never checks the trial.
export async function GET(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    if (isAgentUser(user)) {
      return NextResponse.json({ items: [] });
    }

    const rawDays = Number(new URL(request.url).searchParams.get('days') || 14);
    const days = Number.isFinite(rawDays) ? Math.min(Math.max(Math.round(rawDays), 1), 90) : 14;

    let tcUserIds: string[];
    if (isAdmin) {
      const { data } = await supabaseServer
        .from('transactions')
        .select('tc_user_id')
        .neq('status', 'Closed')
        .not('tc_user_id', 'is', null);
      tcUserIds = Array.from(new Set((data || []).map((t) => t.tc_user_id as string)));
    } else {
      tcUserIds = await getVisibleTcUserIds(user.id);
    }
    if (tcUserIds.length === 0) return NextResponse.json({ items: [] });

    const { data: transactions, error: txError } = await supabaseServer
      .from('transactions')
      .select('id, file_number, property_address')
      .in('tc_user_id', tcUserIds)
      .neq('status', 'Closed');
    if (txError) throw txError;
    if (!transactions || transactions.length === 0) return NextResponse.json({ items: [] });

    const todayIso = new Date().toISOString().split('T')[0];
    const end = new Date(`${todayIso}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + days);
    const endIso = end.toISOString().split('T')[0];

    const byId = new Map(transactions.map((t) => [t.id as string, t]));
    const { data: dates, error: dateError } = await supabaseServer
      .from('transaction_key_dates')
      .select('id, transaction_id, kind, label, due_date')
      .in('transaction_id', Array.from(byId.keys()))
      .eq('completed', false)
      .lte('due_date', endIso)
      .order('due_date', { ascending: true })
      .limit(200);
    if (dateError) throw dateError;

    const items = (dates || []).map((d) => {
      const tx = byId.get(d.transaction_id as string);
      return {
        id: d.id as string,
        transactionId: d.transaction_id as string,
        kind: d.kind as string,
        label: d.label as string,
        dueDate: d.due_date as string,
        daysUntil: daysUntil(d.due_date as string, todayIso),
        fileNumber: (tx?.file_number as string) || '',
        propertyAddress: (tx?.property_address as string) || '',
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error loading upcoming key dates:', error);
    return NextResponse.json({ error: 'Failed to load critical dates' }, { status: 500 });
  }
}
