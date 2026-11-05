import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { PilotError } from '@/lib/brokeragePilot';
import { applyAdminAction, type AdminAction } from '@/lib/brokerageAccount';

// Admin: POST { action: 'extend' | 'convert' | 'terminate', note? } on one brokerage. Extend is allowed once (15 days). Convert only
// records that Relay now treats the account as Brokerage Pro; it never charges or creates a subscription. Terminate pauses
// management and keeps every record.
export async function POST(request: NextRequest, { params }: { params: Promise<{ ownerId: string }> }) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    if (!isAdmin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    const { ownerId } = await params;
    const body = (await request.json().catch(() => ({}))) as { action?: unknown; note?: unknown };
    if (body.action !== 'extend' && body.action !== 'convert' && body.action !== 'terminate') return NextResponse.json({ error: 'Choose extend, convert or terminate.' }, { status: 400 });
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 1000) : null;
    const account = await applyAdminAction(ownerId, user.id, body.action as AdminAction, note);
    await logAudit(request, user, `admin.brokerage_${body.action}`, { entityType: 'user', entityId: ownerId });
    return NextResponse.json({ status: account.status, endsOn: account.pilot_ends_on });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof PilotError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Admin brokerage action failed:', error);
    return NextResponse.json({ error: 'Failed to update the brokerage account' }, { status: 500 });
  }
}
