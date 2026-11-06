import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { isTeamPlan } from '@/lib/plans';
import { getUserPlan } from '@/lib/appMetadata';
import { accessFor, PilotError, type AccountRow } from '@/lib/brokeragePilot';
import { grantPilot, type AccountFull } from '@/lib/brokerageAccount';
import { findUserIdByEmail } from '@/lib/team';

// Admin: every brokerage account and its pilot, plus owners who already have agents but no account yet (so none is missed before
// the brokerage feature is turned on). POST { email, note? } starts the 30-day complimentary Pro pilot.
export async function GET(request: NextRequest) {
  try {
    const { isAdmin } = await getUserFromRequest(request);
    if (!isAdmin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    const { data: accounts, error } = await supabaseServer.from('brokerage_accounts').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    const { data: links } = await supabaseServer.from('brokerage_links').select('owner_user_id, status').in('status', ['active', 'pending']).limit(5000);
    const counts = new Map<string, { active: number; pending: number }>();
    for (const l of links ?? []) {
      const c = counts.get(l.owner_user_id as string) ?? { active: 0, pending: 0 };
      if (l.status === 'active') c.active += 1;
      else c.pending += 1;
      counts.set(l.owner_user_id as string, c);
    }
    const ids = new Set([...(accounts ?? []).map((a) => a.owner_user_id as string), ...counts.keys()]);
    const who = new Map<string, { email: string | null; name: string | null }>();
    await Promise.all([...ids].map(async (id) => {
      const { data } = await supabaseServer.auth.admin.getUserById(id);
      who.set(id, { email: data.user?.email ?? null, name: (data.user?.user_metadata?.full_name as string | undefined) ?? null });
    }));
    const today = new Date().toISOString().slice(0, 10);
    const rows = (accounts ?? []).map((a) => {
      const row = a as AccountFull;
      const access = accessFor(row as AccountRow, today);
      return { ownerId: row.owner_user_id, ...who.get(row.owner_user_id), status: access.status, tier: row.tier, startedOn: row.pilot_started_on, endsOn: row.pilot_ends_on, daysLeft: access.daysLeft, extensionUsed: row.extension_used, upgradeRequestedAt: row.upgrade_requested_at, notes: row.notes, agents: counts.get(row.owner_user_id) ?? { active: 0, pending: 0 }, seatLimit: access.seatLimit };
    });
    const have = new Set((accounts ?? []).map((a) => a.owner_user_id as string));
    const unmanaged = [...counts.entries()].filter(([id]) => !have.has(id)).map(([id, c]) => ({ ownerId: id, ...who.get(id), agents: c }));
    return NextResponse.json({ accounts: rows, unmanaged });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    const info = error as { code?: string } | null;
    if (info && (info.code === 'PGRST205' || info.code === '42P01')) {
      console.error('Admin brokerages: tables missing:', error);
      return NextResponse.json({ error: 'The brokerage tables are not in this database yet. Run add-brokerage-oversight.sql and add-brokerage-accounts.sql in Supabase.' }, { status: 503 });
    }
    console.error('Admin brokerages failed:', error);
    return NextResponse.json({ error: 'Failed to load brokerage accounts' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    if (!isAdmin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    const body = (await request.json().catch(() => ({}))) as { email?: unknown; note?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 1000) : null;
    if (!email) return NextResponse.json({ error: 'Enter the brokerage owner’s email.' }, { status: 400 });
    const ownerId = await findUserIdByEmail(email).catch(() => null);
    if (!ownerId) return NextResponse.json({ error: 'No Relay account has that email.' }, { status: 404 });
    const { data } = await supabaseServer.auth.admin.getUserById(ownerId);
    if (!isTeamPlan(getUserPlan(data.user as never))) return NextResponse.json({ error: 'Put this person on the Team plan first (Admin → plan). A brokerage owner works from a Team workspace.' }, { status: 400 });
    const account = await grantPilot(ownerId, user.id, note);
    await logAudit(request, user, 'admin.brokerage_grant_pilot', { entityType: 'user', entityId: ownerId });
    return NextResponse.json({ ownerId, endsOn: account.pilot_ends_on }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof PilotError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Admin grant pilot failed:', error);
    return NextResponse.json({ error: 'Failed to start the pilot' }, { status: 500 });
  }
}
