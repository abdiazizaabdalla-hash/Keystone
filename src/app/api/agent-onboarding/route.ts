import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { mergeUserMetadata } from '@/lib/userMetadata';
import { mergeAppMetadata } from '@/lib/privileged';
import { isCoordinationMode } from '@/lib/accountType';
import { isCollaboratorOnly } from '@/lib/agentPortal';
import { getEntitlements } from '@/lib/entitlements';
import { logAudit } from '@/lib/audit';
import { isFeatureOn } from '@/lib/features';
import { isStateCode } from '@/lib/usStates';
import { agentSelfServeEnabled, AGENT_SELF_SERVE_OFF_MESSAGE } from '@/lib/agentSelfServe';

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
    // Public agent signup is off; an agent the admin gave a workspace still finishes setup.
    if (!agentSelfServeEnabled() && getEntitlements(user).kind !== 'agent_workspace') {
      return NextResponse.json({ error: AGENT_SELF_SERVE_OFF_MESSAGE }, { status: 403 });
    }
    // Free portal logins have no workspace to set up.
    if (isCollaboratorOnly(user)) {
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

    await mergeAppMetadata(user.id, { account_type: 'agent' });
    await mergeUserMetadata(user.id, {
      coordination_mode: mode,
      full_name: name,
      onboarding_completed: true,
    });

    // The states they work in become their "My states" on the Templates screen. Nothing is assumed: only what they tick.
    // This never fails the setup, and does nothing until the templates feature is released.
    if (isFeatureOn('templates') && Array.isArray(body.states)) {
      const codes = [...new Set((body.states as unknown[]).filter((c): c is string => typeof c === 'string' && isStateCode(c)))].slice(0, 51);
      if (codes.length > 0) {
        const { error: pinError } = await supabaseServer
          .from('template_pins')
          .upsert(codes.map((ref) => ({ owner_user_id: user.id, kind: 'folder', ref })), { onConflict: 'owner_user_id,kind,ref', ignoreDuplicates: true });
        if (pinError) console.error('Could not save onboarding states:', pinError);
      }
    }

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
