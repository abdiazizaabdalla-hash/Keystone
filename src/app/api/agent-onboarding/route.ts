import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { mergeUserMetadata } from '@/lib/userMetadata';
import { isCoordinationMode } from '@/lib/accountType';
import { isAgentUser } from '@/lib/agentPortal';
import { logAudit } from '@/lib/audit';

// Finishes the short setup an agent who signed up for Relay goes through:
// how they want to work, and who they are. It creates the one `agents` row
// that represents the agent themselves, so every existing deal, listing and
// checklist path (which all hang off an agent profile) works for them
// unchanged, and records their choices in user_metadata.
//
// Only presentation settings live in user_metadata -- see lib/accountType.ts.
// Nothing here grants access to anything.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    // Free portal logins have no workspace to set up.
    if (isAgentUser(user)) {
      return NextResponse.json({ error: 'This account is a portal login, not a workspace account.' }, { status: 403 });
    }
    await assertTrialActive(user);

    const body = await request.json();
    const mode = body.mode;
    if (!isCoordinationMode(mode)) {
      return NextResponse.json({ error: 'Choose how you want to work.' }, { status: 400 });
    }
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
    const brokerage = typeof body.brokerage === 'string' ? body.brokerage.trim().slice(0, 160) : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim().slice(0, 40) : '';
    if (!name) {
      return NextResponse.json({ error: 'Your name is required.' }, { status: 400 });
    }

    const email = (user.email || '').trim().toLowerCase();

    // Reuse the profile if this runs twice (a reload or a double click).
    const { data: existing, error: findError } = await supabaseServer
      .from('agents')
      .select('id')
      .eq('tc_user_id', user.id)
      .ilike('email', email)
      .limit(1);
    if (findError) throw findError;

    if (existing && existing.length > 0) {
      const { error: updateError } = await supabaseServer
        .from('agents')
        .update({ name, brokerage: brokerage || null, phone: phone || null })
        .eq('id', existing[0].id)
        .eq('tc_user_id', user.id);
      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await supabaseServer.from('agents').insert({
        tc_user_id: user.id,
        name,
        brokerage: brokerage || null,
        email: email || null,
        phone: phone || null,
        // An agent is not billing themselves a coordination fee.
        flat_fee: 0,
        commission_percent: 0,
      });
      if (insertError) throw insertError;
    }

    await mergeUserMetadata(user.id, {
      account_type: 'agent',
      coordination_mode: mode,
      full_name: name,
      onboarding_completed: true,
    });

    await logAudit(request, user, 'agent.onboarding_completed', { entityType: 'user', entityId: user.id, metadata: { mode } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof TrialExpiredError) {
      return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: 402 });
    }
    console.error('Error finishing agent onboarding:', error);
    return NextResponse.json({ error: 'Failed to finish setup' }, { status: 500 });
  }
}
