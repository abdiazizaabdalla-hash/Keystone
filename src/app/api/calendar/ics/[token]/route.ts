import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getVisibleTcUserIds } from '@/lib/team';
import { getAgentListingRows } from '@/lib/agentListings';

// The public (token-authenticated) calendar feed behind the "subscribe" link
// in Settings. Calendar apps fetch this URL on a schedule, with no login, so
// the unguessable token IS the credential (see /api/calendar/feed).
//
// What goes in it:
//   - TC:    critical dates + closing date + open checklist due dates on their deals
//   - agent: critical dates + closing date on the deals they've been added to
// Open items only, from 30 days back forward.

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

const esc = (t: string) => t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// RFC 5545: lines longer than 75 octets are folded with CRLF + a space.
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Don't cut in the middle of a multi-byte character.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // continuation lines carry a leading space
  }
  return parts.join('\r\n ');
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split('T')[0];
}

const compact = (iso: string) => iso.replace(/-/g, '');

interface FeedEvent {
  uid: string;
  date: string;
  summary: string;
  description: string;
}

function notFound() {
  return new NextResponse('Not found', { status: 404 });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    if (!TOKEN_RE.test(token)) return notFound();

    const { data: feed } = await supabaseServer.from('calendar_feed_tokens').select('user_id').eq('token', token).maybeSingle();
    if (!feed) return notFound();
    const userId = feed.user_id as string;

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Deals this person owns (TC, including their team's) and deals they were added to as an agent.
    const visibleTcIds = await getVisibleTcUserIds(userId);
    const [{ data: owned }, { data: asAgent }] = await Promise.all([
      supabaseServer
        .from('transactions')
        .select('id, file_number, property_address, closing_date, status')
        .in('tc_user_id', visibleTcIds.length ? visibleTcIds : [userId])
        .limit(500),
      supabaseServer.from('transaction_agents').select('transaction_id').eq('agent_user_id', userId).limit(500),
    ]);

    const ownedIds = new Set((owned || []).map((t) => t.id as string));
    const agentOnlyIds = (asAgent || []).map((r) => r.transaction_id as string).filter((id) => !ownedIds.has(id));

    let agentTx: { id: string; file_number: string; property_address: string; closing_date: string | null; status: string | null }[] = [];
    if (agentOnlyIds.length) {
      const { data } = await supabaseServer
        .from('transactions')
        .select('id, file_number, property_address, closing_date, status')
        .in('id', agentOnlyIds);
      agentTx = (data || []) as typeof agentTx;
    }

    const allTx = [...((owned || []) as typeof agentTx), ...agentTx];
    const txById = new Map(allTx.map((t) => [t.id, t]));
    const labelFor = (id: string) => {
      const t = txById.get(id);
      return t ? `${t.file_number} · ${t.property_address}` : 'Relay TC';
    };

    const events: FeedEvent[] = [];

    for (const t of allTx) {
      if (t.closing_date && t.closing_date >= since && t.status !== 'Closed') {
        events.push({
          uid: `closing-${t.id}@relaytc.com`,
          date: t.closing_date,
          summary: `Closing — ${t.property_address}`,
          description: `Closing for ${labelFor(t.id)}.`,
        });
      }
    }

    const allIds = allTx.map((t) => t.id);
    if (allIds.length) {
      const { data: keyDates } = await supabaseServer
        .from('transaction_key_dates')
        .select('id, transaction_id, label, due_date')
        .in('transaction_id', allIds)
        .eq('completed', false)
        .gte('due_date', since);
      for (const k of keyDates || []) {
        events.push({
          uid: `kd-${k.id}@relaytc.com`,
          date: k.due_date as string,
          summary: `${k.label} — ${labelFor(k.transaction_id as string)}`,
          description: `Critical date for ${labelFor(k.transaction_id as string)}, from Relay TC.`,
        });
      }
    }

    // Checklist due dates are the TC's working list, not something agents see.
    const ownedList = [...ownedIds];
    if (ownedList.length) {
      const { data: tasks } = await supabaseServer
        .from('tasks')
        .select('id, transaction_id, name, due_date')
        .in('transaction_id', ownedList)
        .eq('completed', false)
        .not('due_date', 'is', null)
        .gte('due_date', since);
      for (const task of tasks || []) {
        events.push({
          uid: `task-${task.id}@relaytc.com`,
          date: task.due_date as string,
          summary: `${task.name} — ${labelFor(task.transaction_id as string)}`,
          description: `Checklist task for ${labelFor(task.transaction_id as string)}, from Relay TC.`,
        });
      }
    }

    // Listings: a TC gets steps, dates, the go-live day and expiration; an agent gets the dates and expiration
    // of the listings shared with them.
    try {
      const { data: userData } = await supabaseServer.auth.admin.getUserById(userId);
      const email = userData?.user?.email;
      const { data: tcListings } = await supabaseServer
        .from('listings')
        .select('id, property_address, planned_list_date, expiration_date, status')
        .in('tc_user_id', visibleTcIds.length ? visibleTcIds : [userId])
        .in('status', ['preparing', 'active', 'under_offer'])
        .limit(500);
      const agentListings = (await getAgentListingRows(email)).filter((l) => ['preparing', 'active', 'under_offer'].includes(l.status as string));
      type L = { id: string; property_address: string; planned_list_date: string | null; expiration_date: string | null };
      const tcIds = new Set((tcListings || []).map((l) => l.id as string));
      const all: L[] = [...((tcListings || []) as L[]), ...(agentListings as L[]).filter((l) => !tcIds.has(l.id))];
      const addr = new Map(all.map((l) => [l.id, l.property_address]));
      for (const l of all) {
        if (l.planned_list_date && l.planned_list_date >= since) {
          events.push({ uid: `listing-go-${l.id}@relaytc.com`, date: l.planned_list_date, summary: `List date — ${l.property_address}`, description: `Planned go-live for the listing at ${l.property_address}.` });
        }
        if (l.expiration_date && l.expiration_date >= since) {
          events.push({ uid: `listing-exp-${l.id}@relaytc.com`, date: l.expiration_date, summary: `Listing expires — ${l.property_address}`, description: `The listing agreement for ${l.property_address} expires.` });
        }
      }
      const allIds = all.map((l) => l.id);
      if (allIds.length) {
        const { data: ld } = await supabaseServer.from('listing_dates').select('id, listing_id, label, due_date').in('listing_id', allIds).gte('due_date', since);
        for (const d of ld || []) {
          events.push({ uid: `listing-date-${d.id}@relaytc.com`, date: d.due_date as string, summary: `${d.label} — ${addr.get(d.listing_id as string)}`, description: `Listing date for ${addr.get(d.listing_id as string)}, from Relay TC.` });
        }
      }
      const tcIdList = [...tcIds];
      if (tcIdList.length) {
        const { data: lt } = await supabaseServer
          .from('listing_tasks')
          .select('id, listing_id, name, due_date')
          .in('listing_id', tcIdList)
          .eq('completed', false)
          .not('due_date', 'is', null)
          .gte('due_date', since);
        for (const t of lt || []) {
          events.push({ uid: `listing-task-${t.id}@relaytc.com`, date: t.due_date as string, summary: `${t.name} — Listing · ${addr.get(t.listing_id as string)}`, description: `Listing checklist step for ${addr.get(t.listing_id as string)}, from Relay TC.` });
        }
      }
    } catch (error) {
      console.error('Listings in calendar feed failed (ignored):', error);
    }

    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Relay TC//Calendar feed//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Relay TC',
      'X-WR-CALDESC:Critical dates and due dates from Relay TC',
      'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
      'X-PUBLISHED-TTL:PT1H',
    ];
    for (const e of events) {
      lines.push(
        'BEGIN:VEVENT',
        `UID:${e.uid}`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${compact(e.date)}`,
        `DTEND;VALUE=DATE:${compact(nextDay(e.date))}`,
        `SUMMARY:${esc(e.summary)}`,
        `DESCRIPTION:${esc(e.description)}`,
        'TRANSP:TRANSPARENT',
        'END:VEVENT'
      );
    }
    lines.push('END:VCALENDAR');

    return new NextResponse(lines.map(fold).join('\r\n') + '\r\n', {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="relay-tc.ics"',
        'Cache-Control': 'private, max-age=300',
        'X-Robots-Tag': 'noindex',
      },
    });
  } catch (error) {
    console.error('Error building calendar feed:', error);
    return new NextResponse('Something went wrong', { status: 500 });
  }
}
