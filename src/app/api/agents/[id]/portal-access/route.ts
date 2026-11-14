import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { grantAgentPortalAccess } from '@/lib/agentInvite';
import { listAgentAccess, setAgentAccess } from '@/lib/agentPortalSelect';
import { UUID_RE } from '@/lib/contactsCrm';

// POST: give this agent portal access to all of their open deals and shared listings that they do not have yet.
// One summary email goes to the agent. Safe to press twice: anything already granted is skipped.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    await assertTrialActive(user);
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    let query = supabaseServer.from('agents').select('id').eq('id', id);
    if (!isAdmin) query = query.eq('tc_user_id', user.id);
    const { data: agent } = await query.maybeSingle();
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    const result = await grantAgentPortalAccess({ agentId: id, user, appUrl: request.nextUrl.origin });
    if (!result.ok && result.reason === 'no_email') {
      return NextResponse.json({ error: 'This agent has no email on file. Add one first.' }, { status: 400 });
    }
    if (!result.ok) return NextResponse.json({ error: 'Could not give this agent access' }, { status: 500 });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) {
      return NextResponse.json({ error: error.message, code: 'trial_expired', trialEndsAt: error.trialEndsAt }, { status: error.status });
    }
    console.error('Error giving agent portal access:', error);
    return NextResponse.json({ error: 'Could not give this agent access' }, { status: 500 });
  }
}

// Shared by GET and PUT: the agent must be this coordinator's (or the caller is an admin).
async function ownAgent(request: NextRequest, params: Promise<{ id: string }>, needsTrial: boolean) {
  const { user, isAdmin } = await getUserFromRequest(request);
  if (needsTrial) await assertTrialActive(user);
  const { id } = await params;
  if (!UUID_RE.test(id)) throw new AuthError('Agent not found', 404);
  let query = supabaseServer.from('agents').select('id').eq('id', id);
  if (!isAdmin) query = query.eq('tc_user_id', user.id);
  const { data: agent } = await query.maybeSingle();
  if (!agent) throw new AuthError('Agent not found', 404);
  return { user, id };
}

function failure(error: unknown, what: string) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired', trialEndsAt: error.trialEndsAt }, { status: error.status });
  console.error(`Error ${what}:`, error);
  return NextResponse.json({ error: `Could not ${what}` }, { status: 500 });
}

// GET: this agent's open deals and shared listings, and which of them the agent can see in the portal.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ownAgent(request, params, false);
    const list = await listAgentAccess(id);
    if (!list) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    return NextResponse.json(list);
  } catch (error) {
    return failure(error, 'load portal access');
  }
}

// PUT { dealIds, listingIds }: the agent can see exactly these (of their open deals and listings). Others are removed.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, id } = await ownAgent(request, params, true);
    const body = await request.json().catch(() => ({}));
    const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)).slice(0, 200) : []);
    const result = await setAgentAccess({ agentId: id, dealIds: ids(body.dealIds), listingIds: ids(body.listingIds), user, appUrl: request.nextUrl.origin });
    if (!result.ok && result.reason === 'no_email') return NextResponse.json({ error: 'This agent has no email on file. Add one first.' }, { status: 400 });
    if (!result.ok) return NextResponse.json({ error: 'Could not save portal access' }, { status: 500 });
    return NextResponse.json(result);
  } catch (error) {
    return failure(error, 'save portal access');
  }
}
