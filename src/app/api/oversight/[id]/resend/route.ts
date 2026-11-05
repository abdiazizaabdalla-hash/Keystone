import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rateLimit';
import { assertBrokerageOwner } from '@/lib/oversight';
import { assertBrokerageManageable } from '@/lib/brokerageAccount';
import { oversightError, sendBrokerageInvite } from '@/lib/oversightServer';

// POST: send a pending invitation again (the email may have been missed or gone to spam). Owner only, pending links only,
// and at most 3 sends per invitation per day so it cannot be used to pester someone.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await getUserFromRequest(request);
    assertBrokerageOwner(user);
    await assertBrokerageManageable(user.id);
    const { data: link, error } = await supabaseServer.from('brokerage_links').select('id, invited_email').eq('id', id).eq('owner_user_id', user.id).eq('status', 'pending').maybeSingle();
    if (error) throw error;
    if (!link || !link.invited_email) throw new AuthError('Not found', 404);
    if (!(await checkRateLimit(`brokerage-resend:${id}`, 3, 24 * 60 * 60))) {
      return NextResponse.json({ error: 'That invitation was already sent a few times today. Give them a day, or ask them to check their spam folder.' }, { status: 429 });
    }
    const ownerLabel = (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()) || user.email || 'A brokerage owner';
    const delivery = await sendBrokerageInvite({ ownerUserId: user.id, ownerLabel, toEmail: link.invited_email as string });
    await logAudit(request, user, 'brokerage.resend_invite', { entityType: 'brokerage_link', entityId: id, metadata: { delivery } });
    if (delivery === 'failed') return NextResponse.json({ error: 'The email could not be sent. Try again in a moment.' }, { status: 502 });
    return NextResponse.json({ success: true, delivery });
  } catch (error) {
    return oversightError(error, 'resend that invitation');
  }
}
