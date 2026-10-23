import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';

// GET /api/calendar/events?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// The dates behind the Calendar tab: critical dates, closing days, checklist due dates and listing dates
// for the signed-in coordinator's OWN deals and listings (never anyone else's, team owners included).
// Every kind is returned with a `kind`, and the page filters by the person's "What goes on my calendar"
// choices, so switching a kind off or on there is instant.

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const OPEN_LISTING = ['preparing', 'active', 'under_offer'];

export type CalendarEventKind = 'critical' | 'closing' | 'task' | 'listing_date' | 'listing_step';

interface CalEvent {
  id: string;
  date: string;
  title: string;
  detail: string;
  kind: CalendarEventKind;
  href: string;
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (isAgentUser(user)) return NextResponse.json({ error: 'Not available' }, { status: 403 });

    const from = request.nextUrl.searchParams.get('from') || '';
    const to = request.nextUrl.searchParams.get('to') || '';
    if (!ISO.test(from) || !ISO.test(to) || from > to) {
      return NextResponse.json({ error: 'from and to must be YYYY-MM-DD dates' }, { status: 400 });
    }

    const events: CalEvent[] = [];

    // Deals this login owns.
    const { data: txs, error: txError } = await supabaseServer
      .from('transactions')
      .select('id, file_number, property_address, closing_date, status')
      .eq('tc_user_id', user.id)
      .limit(1000);
    if (txError) throw txError;
    const txById = new Map((txs || []).map((t) => [t.id as string, t]));
    const txIds = [...txById.keys()];
    const addr = (id: string) => (txById.get(id)?.property_address as string) || 'Deal';

    for (const t of txs || []) {
      const d = t.closing_date as string | null;
      if (d && d >= from && d <= to && t.status !== 'Closed') {
        events.push({ id: `closing-${t.id}`, date: d, title: 'Closing', detail: t.property_address as string, kind: 'closing', href: `/dashboard/transactions/${t.id}` });
      }
    }

    if (txIds.length) {
      const [{ data: keyDates }, { data: tasks }] = await Promise.all([
        supabaseServer
          .from('transaction_key_dates')
          .select('id, transaction_id, kind, label, due_date')
          .in('transaction_id', txIds)
          .eq('completed', false)
          .gte('due_date', from)
          .lte('due_date', to),
        supabaseServer
          .from('tasks')
          .select('id, transaction_id, name, due_date')
          .in('transaction_id', txIds)
          .eq('completed', false)
          .not('due_date', 'is', null)
          .gte('due_date', from)
          .lte('due_date', to),
      ]);
      for (const k of keyDates || []) {
        events.push({
          id: `kd-${k.id}`,
          date: k.due_date as string,
          title: k.label as string,
          detail: addr(k.transaction_id as string),
          kind: k.kind === 'closing' ? 'closing' : 'critical',
          href: `/dashboard/transactions/${k.transaction_id}`,
        });
      }
      for (const t of tasks || []) {
        events.push({
          id: `task-${t.id}`,
          date: t.due_date as string,
          title: t.name as string,
          detail: addr(t.transaction_id as string),
          kind: 'task',
          href: `/dashboard/transactions/${t.transaction_id}`,
        });
      }
    }

    // Open listings this login owns.
    const { data: listings } = await supabaseServer
      .from('listings')
      .select('id, property_address, planned_list_date, expiration_date')
      .eq('tc_user_id', user.id)
      .in('status', OPEN_LISTING)
      .limit(1000);
    const listingById = new Map((listings || []).map((l) => [l.id as string, l]));
    const listingIds = [...listingById.keys()];

    for (const l of listings || []) {
      const href = `/dashboard/listings/${l.id}`;
      const go = l.planned_list_date as string | null;
      const exp = l.expiration_date as string | null;
      if (go && go >= from && go <= to) events.push({ id: `golive-${l.id}`, date: go, title: 'Go live', detail: l.property_address as string, kind: 'listing_date', href });
      if (exp && exp >= from && exp <= to) events.push({ id: `exp-${l.id}`, date: exp, title: 'Listing expires', detail: l.property_address as string, kind: 'listing_date', href });
    }

    if (listingIds.length) {
      const [{ data: listingDates }, { data: listingTasks }] = await Promise.all([
        supabaseServer.from('listing_dates').select('id, listing_id, label, due_date').in('listing_id', listingIds).gte('due_date', from).lte('due_date', to),
        supabaseServer
          .from('listing_tasks')
          .select('id, listing_id, name, due_date')
          .in('listing_id', listingIds)
          .eq('completed', false)
          .not('due_date', 'is', null)
          .gte('due_date', from)
          .lte('due_date', to),
      ]);
      for (const d of listingDates || []) {
        const l = listingById.get(d.listing_id as string);
        events.push({ id: `ld-${d.id}`, date: d.due_date as string, title: d.label as string, detail: (l?.property_address as string) || 'Listing', kind: 'listing_date', href: `/dashboard/listings/${d.listing_id}` });
      }
      for (const t of listingTasks || []) {
        const l = listingById.get(t.listing_id as string);
        events.push({ id: `lt-${t.id}`, date: t.due_date as string, title: t.name as string, detail: (l?.property_address as string) || 'Listing', kind: 'listing_step', href: `/dashboard/listings/${t.listing_id}` });
      }
    }

    events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
    return NextResponse.json(events);
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error loading calendar events:', error);
    return NextResponse.json({ error: 'Failed to load calendar' }, { status: 500 });
  }
}
