import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { getEntitlements } from '@/lib/entitlements';
import { checkRateLimit } from '@/lib/rateLimit';
import { acceptedCoordinator, inviteCoordinatorToListing } from '@/lib/listingCoordinators';

// The agent who owns a listing invites a coordinator onto it (and sees who has accepted). Owner only, and only an agent with a workspace.
async function requireOwnerAgent(request: NextRequest, id: string) {
  const { user } = await getUserFromRequest(request);
  if (getEntitlements(user).kind !== 'agent_workspace') throw new AuthError('Only an agent with a workspace invites a coordinator', 403);
  const { data: listing } = await supabaseServer.from('listings').select('id, tc_user_id, property_address').eq('id', id).maybeSingle();
  if (!listing) throw new AuthError('Listing not found', 404);
  if (listing.tc_user_id !== user.id) throw new AuthError('Only the agent who owns this listing can invite a coordinator', 403);
  return { user, listing };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireOwnerAgent(request, id);
    const { data, error } = await supabaseServer.from('listing_coordinators').select('email, status, created_at, accepted_at').eq('listing_id', id).order('created_at', { ascending: false });
    return NextResponse.json({ invites: error ? [] : data || [], coordinator: await acceptedCoordinator(id) });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, listing } = await requireOwnerAgent(request, id);
    const body = await request.json().catch(() => ({}));
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email.includes('@')) return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
    const resend = body.resend === true;
    if (resend && !(await checkRateLimit(`listing-tc-invite-resend:${user.id}:${id}:${email}`, 3, 86400))) {
      return NextResponse.json({ error: 'That invitation was already sent again a few times today. Please wait and try tomorrow.' }, { status: 429 });
    }
    const outcome = await inviteCoordinatorToListing({ listing, user, appUrl: request.nextUrl.origin, email, usesRelay: body.usesRelay !== false, resend });
    if (outcome === 'already') return NextResponse.json({ error: 'This person has already been invited to this listing.' }, { status: 400 });
    if (outcome === 'self') return NextResponse.json({ error: 'Enter your coordinator’s email, not your own.' }, { status: 400 });
    if (outcome === 'agent_account') return NextResponse.json({ error: 'That email belongs to an agent account. Invite a coordinator here.' }, { status: 400 });
    if (outcome === 'not_pending') return NextResponse.json({ error: 'There is no waiting invitation for that address on this listing.' }, { status: 404 });
    if (outcome === 'email_failed') return NextResponse.json({ status: 'invited', email, inviteEmailSent: false });
    if (outcome !== 'sent') return NextResponse.json({ error: 'Failed to send invite' }, { status: 500 });
    return NextResponse.json({ status: resend ? 'resent' : 'invited', email, inviteEmailSent: true });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error inviting a coordinator to a listing:', error);
    return NextResponse.json({ error: 'Failed to send invite' }, { status: 500 });
  }
}
