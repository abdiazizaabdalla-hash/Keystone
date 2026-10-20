import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';
import { getAgentListingRows } from '@/lib/agentListings';
import { checkRateLimit } from '@/lib/rateLimit';
import { addComment, loadComments } from '@/lib/listingComments';
import { queueTcCommentNotice } from '@/lib/listingNotify';
import { supabaseServer } from '@/lib/supabase';

// The listing agent's side of the message thread. Same sharing rule as the rest of the agent view: only
// listings the TC shared with the agent whose login email matches the listing's agent record.
async function requireAgentListing(request: NextRequest, id: string) {
  const { user } = await getUserFromRequest(request);
  if (!isAgentUser(user)) throw new AuthError('This endpoint is for agent accounts only', 403);
  const listing = (await getAgentListingRows(user.email)).find((l) => l.id === id);
  if (!listing) throw new AuthError('Listing not found', 404);
  return { user, listing };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireAgentListing(request, id);
    return NextResponse.json(await loadComments(id));
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error loading agent listing messages:', error);
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await requireAgentListing(request, id);
    if (!(await checkRateLimit(`agent-listing-comment:${user.id}`, 30, 60 * 60))) {
      return NextResponse.json({ error: 'You have sent a lot of messages. Try again a bit later.' }, { status: 429 });
    }
    const body = await request.json().catch(() => ({}));
    // The label comes from the agent's own record when there is one, never from the request.
    const { data: agent } = await supabaseServer.from('agents').select('name').ilike('email', (user.email || '').replace(/[\\%_]/g, (c) => `\\${c}`)).limit(1).maybeSingle();
    const label = (agent?.name as string | undefined) || (user.user_metadata?.full_name as string | undefined) || user.email || 'Listing agent';
    const result = await addComment({ listingId: id, userId: user.id, role: 'agent', label, body: body.body });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    queueTcCommentNotice({ listingId: id, appUrl: request.nextUrl.origin, fromLabel: label });
    await supabaseServer.from('listing_activity').insert({ listing_id: id, actor_label: label, summary: 'Message from the listing agent' });
    return NextResponse.json(result.comment, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error sending agent listing message:', error);
    return NextResponse.json({ error: 'Failed to send the message' }, { status: 500 });
  }
}
