import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { checkRateLimit } from '@/lib/rateLimit';
import { logListingActivity, requireListingAccess } from '@/lib/listings';
import { addComment, loadComments } from '@/lib/listingComments';
import { queueAgentNotice } from '@/lib/listingNotify';

function fail(error: unknown, what: string) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
  console.error(`Error ${what} listing comments:`, error);
  return NextResponse.json({ error: `Failed to ${what} messages` }, { status: 500 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireListingAccess(request, id);
    return NextResponse.json(await loadComments(id));
  } catch (error) {
    return fail(error, 'load');
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, listing } = await requireListingAccess(request, id);
    await assertTrialActive(user);
    if (!(await checkRateLimit(`listing-comment:${user.id}`, 60, 60 * 60))) {
      return NextResponse.json({ error: 'You have sent a lot of messages. Try again a bit later.' }, { status: 429 });
    }
    const body = await request.json().catch(() => ({}));
    const label = (user.user_metadata?.full_name as string | undefined)?.trim() || user.email || 'Coordinator';
    const result = await addComment({ listingId: id, userId: user.id, role: 'tc', label, body: body.body });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    // The agent gets a plain "you have a message" email, only when the listing is shared with them.
    if (listing.share_with_agent === true && listing.agent_id) queueAgentNotice({ listingId: id, what: 'message', appUrl: request.nextUrl.origin });
    await logListingActivity(id, user, 'Message sent on the listing thread');
    return NextResponse.json(result.comment, { status: 201 });
  } catch (error) {
    return fail(error, 'send');
  }
}
