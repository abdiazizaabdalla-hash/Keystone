import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { requireListingAccess } from '@/lib/listings';
import { sendListingPortalInvite, type ListingInviteOutcome } from '@/lib/agentInvite';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAudit } from '@/lib/audit';

const MESSAGE: Record<Exclude<ListingInviteOutcome, 'sent' | 'already'>, { status: number; error: string }> = {
  no_agent: { status: 400, error: 'Choose an agent for this listing first.' },
  no_email: { status: 400, error: "This agent doesn't have an email on file. Add one to the agent, then try again." },
  not_shared: { status: 400, error: 'Turn on "Share with the agent" first. The agent only sees listings that are shared.' },
  other_account: { status: 409, error: 'That email already belongs to a coordinator login, which cannot be used as an agent. Use a different email on the agent.' },
  failed: { status: 502, error: 'Could not send the invite. Please try again.' },
};

// GET: has this listing's agent been invited to the agent portal, and when? (from the listing's activity log)
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { listing } = await requireListingAccess(request, id);
    const { data: agent } = listing.agent_id
      ? await supabaseServer.from('agents').select('name, email').eq('id', listing.agent_id as string).maybeSingle()
      : { data: null };
    const { data: last } = await supabaseServer
      .from('listing_activity')
      .select('created_at')
      .eq('listing_id', id)
      .like('summary', `Invited % (${String(agent?.email || '').trim().toLowerCase()}) to the agent portal`)
      .order('created_at', { ascending: false })
      .limit(1);
    return NextResponse.json({
      hasAgent: Boolean(agent),
      agentName: agent?.name ?? null,
      agentEmail: agent?.email ?? null,
      shared: listing.share_with_agent === true,
      invitedAt: last?.[0]?.created_at ?? null,
    });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// POST: send (or resend) the agent their portal login for this listing.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, listing } = await requireListingAccess(request, id);
    if (!(await checkRateLimit(`listing-invite:${id}`, 5, 60 * 60))) {
      return NextResponse.json({ error: 'Too many invites for this listing. Please wait a bit and try again.' }, { status: 429 });
    }
    const outcome = await sendListingPortalInvite({ listing, user, appUrl: request.nextUrl.origin });
    if (outcome !== 'sent' && outcome !== 'already') return NextResponse.json({ error: MESSAGE[outcome].error }, { status: MESSAGE[outcome].status });
    await logAudit(request, user, 'listing.invite_agent', { entityType: 'listing', entityId: id });
    return NextResponse.json({ status: 'sent' });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error inviting the listing agent:', error);
    return NextResponse.json({ error: 'Failed to send the invite' }, { status: 500 });
  }
}
