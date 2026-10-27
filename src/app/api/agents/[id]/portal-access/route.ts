import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { grantAgentPortalAccess } from '@/lib/agentInvite';
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
