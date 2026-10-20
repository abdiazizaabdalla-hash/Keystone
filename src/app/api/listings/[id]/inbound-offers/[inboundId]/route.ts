import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { logListingActivity, requireListingAccess } from '@/lib/listings';
import { closeInbound, isUuid } from '@/lib/listingInbound';

// DELETE: dismiss a held offer email (its files are deleted).
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; inboundId: string }> }) {
  try {
    const { id, inboundId } = await params;
    const { user } = await requireListingAccess(request, id);
    await assertTrialActive(user);
    if (!isUuid(inboundId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!(await closeInbound(id, inboundId, 'dismissed'))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await logListingActivity(id, user, 'Dismissed an offer email');
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    console.error('Error dismissing inbound offer:', error);
    return NextResponse.json({ error: 'Failed to dismiss' }, { status: 500 });
  }
}
