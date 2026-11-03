import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isPlatformAdmin, hasAgentRole } from '@/lib/privileged';
import { hasAgentWorkspace } from '@/lib/entitlements';
import { logAudit } from '@/lib/audit';
import { isValidPlan, isTeamPlan, DEFAULT_PLAN } from '@/lib/plans';
import { setUserPlan } from '@/lib/stripeCustomers';
import { getTrialStatus } from '@/lib/trial';
import { mergeAppMetadata } from '@/lib/privileged';
import { ensureTeamForOwner, dissolveTeamMembership } from '@/lib/team';
import { deleteUserCompletely, DeleteAccountError } from '@/lib/deleteAccount';

// Indefinite suspension, Supabase-native: setting `banned_until` far in the
// future blocks the account at the Auth/GoTrue level (sign-in itself
// fails), not just a cosmetic flag the rest of the app would have to
// remember to check on every route. ~100 years out is Supabase's own
// documented pattern for "banned until reactivated by an admin" since the
// API has no literal "forever" value. `ban_duration: 'none'` is the
// documented way to clear it again.
const INDEFINITE_BAN = '876000h';

type Action = 'suspend' | 'reactivate';

function isAction(value: unknown): value is Action {
  return value === 'suspend' || value === 'reactivate';
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user: caller, isAdmin } = await getUserFromRequest(request);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { id: targetUserId } = await params;
    const body = await request.json().catch(() => ({}));

    // Change a user's plan by hand (comps, support fixes, testing). This
    // only changes what Relay grants -- it does NOT touch Stripe billing, so
    // a user with a live subscription is still billed for what they bought,
    // and a later Stripe event for that subscription can set the plan again.
    if (body?.action === 'set_plan') {
      if (!isValidPlan(body.plan)) {
        return NextResponse.json({ error: 'Unknown plan' }, { status: 400 });
      }
      const newPlan = body.plan;
      const { data: planTarget, error: planTargetError } = await supabaseServer.auth.admin.getUserById(targetUserId);
      if (planTargetError || !planTarget.user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
      const oldPlan = (planTarget.user.app_metadata as { plan?: string } | null)?.plan || DEFAULT_PLAN;

      if (isTeamPlan(oldPlan) && !isTeamPlan(newPlan)) {
        await dissolveTeamMembership(targetUserId, (memberId) => setUserPlan(memberId, DEFAULT_PLAN));
      }
      if (isTeamPlan(newPlan)) {
        await ensureTeamForOwner(targetUserId);
      }
      await setUserPlan(targetUserId, newPlan);
      await logAudit(request, caller, 'admin.set_plan', {
        entityType: 'user',
        entityId: targetUserId,
        metadata: { from: oldPlan, to: newPlan },
      });
      return NextResponse.json({ id: targetUserId, plan: newPlan });
    }

    // Set (or clear) a user's trial end date by hand -- for testing what
    // happens when a free trial ends, or to extend one. `trialEndsAt` is an
    // ISO date/time; null resets to the normal 30-days-from-signup clock.
    if (body?.action === 'set_trial_end') {
      const { data: trialTarget, error: trialTargetError } = await supabaseServer.auth.admin.getUserById(targetUserId);
      if (trialTargetError || !trialTarget.user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
      let newValue: string | null = null;
      if (body.trialEndsAt !== null && body.trialEndsAt !== undefined && body.trialEndsAt !== '') {
        const parsed = new Date(body.trialEndsAt);
        if (Number.isNaN(parsed.getTime())) {
          return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
        }
        newValue = parsed.toISOString();
      }
      const oldValue = (trialTarget.user.app_metadata as { trial_ends_at?: string } | null)?.trial_ends_at || null;
      const meta = await mergeAppMetadata(targetUserId, { trial_ends_at: newValue });
      const status = await getTrialStatus(targetUserId, trialTarget.user.created_at, meta);
      await logAudit(request, caller, 'admin.set_trial_end', {
        entityType: 'user',
        entityId: targetUserId,
        metadata: { from: oldValue, to: newValue },
      });
      return NextResponse.json({
        id: targetUserId,
        trial: { applies: status.applies, expired: status.expired, trialEndsAt: status.trialEndsAt ? status.trialEndsAt.toISOString() : null },
      });
    }

    // Give an agent login (or take away) a workspace of their own: their own transactions,
    // checklists, documents and client portals, on top of working the deals coordinators
    // added them to. Admin-granted only for now; no billing is involved. Switching it off puts
    // them back to a free collaborator and keeps their access to the deals they were added to.
    // Granting also starts a trial (default 30 days) unless a longer one is already running.
    if (body?.action === 'set_agent_workspace') {
      if (typeof body.enabled !== 'boolean') {
        return NextResponse.json({ error: 'enabled must be true or false' }, { status: 400 });
      }
      const { data: wsTarget, error: wsTargetError } = await supabaseServer.auth.admin.getUserById(targetUserId);
      if (wsTargetError || !wsTarget.user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
      if (!hasAgentRole(wsTarget.user) || isPlatformAdmin(wsTarget.user)) {
        return NextResponse.json({ error: 'Only agent portal logins can be given an agent workspace' }, { status: 400 });
      }
      const wasEnabled = hasAgentWorkspace(wsTarget.user);
      const changes: Record<string, unknown> = { agent_workspace: body.enabled };
      let trialEndsAt = (wsTarget.user.app_metadata as { trial_ends_at?: string } | null)?.trial_ends_at || null;
      if (body.enabled) {
        const days = Number.isInteger(body.trialDays) && body.trialDays > 0 && body.trialDays <= 365 ? body.trialDays : 30;
        const proposed = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        const existing = trialEndsAt ? new Date(trialEndsAt) : null;
        if (!existing || Number.isNaN(existing.getTime()) || existing < proposed) {
          trialEndsAt = proposed.toISOString();
          changes.trial_ends_at = trialEndsAt;
        }
      }
      await mergeAppMetadata(targetUserId, changes);
      await logAudit(request, caller, body.enabled ? 'admin.grant_agent_workspace' : 'admin.revoke_agent_workspace', {
        entityType: 'user',
        entityId: targetUserId,
        metadata: { was_enabled: wasEnabled, trial_ends_at: trialEndsAt },
      });
      return NextResponse.json({ id: targetUserId, workspace: body.enabled, trialEndsAt });
    }

    if (targetUserId === caller.id) {
      return NextResponse.json({ error: "You can't suspend your own account" }, { status: 400 });
    }

    const action = body?.action;
    if (!isAction(action)) {
      return NextResponse.json({ error: "action must be 'suspend' or 'reactivate'" }, { status: 400 });
    }

    const { data: targetData, error: targetError } = await supabaseServer.auth.admin.getUserById(targetUserId);
    if (targetError || !targetData.user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Refuse suspending another admin from this UI -- that's a
    // deliberately rare action (revoking an operator, not a customer)
    // that shouldn't be one accidental click away in the same table as
    // every regular customer.
    if (action === 'suspend' && isPlatformAdmin(targetData.user)) {
      return NextResponse.json({ error: "Can't suspend another admin account from here" }, { status: 400 });
    }

    const { error: updateError } = await supabaseServer.auth.admin.updateUserById(targetUserId, {
      ban_duration: action === 'suspend' ? INDEFINITE_BAN : 'none',
    });
    if (updateError) throw updateError;

    await logAudit(request, caller, action === 'suspend' ? 'admin.suspend_user' : 'admin.reactivate_user', { entityType: 'user', entityId: targetUserId });
    return NextResponse.json({ id: targetUserId, suspended: action === 'suspend' });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error updating user suspension state:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

// DELETE: permanently remove an account and all of its data. The caller must
// send the account's email as `confirmEmail` so a stray click or a wrong row
// can't remove the wrong person. Admins can't delete themselves or each other.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user: caller, isAdmin } = await getUserFromRequest(request);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { id: targetUserId } = await params;
    if (targetUserId === caller.id) {
      return NextResponse.json({ error: "You can't delete your own account" }, { status: 400 });
    }

    const { data: targetData, error: targetError } = await supabaseServer.auth.admin.getUserById(targetUserId);
    if (targetError || !targetData.user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (isPlatformAdmin(targetData.user)) {
      return NextResponse.json({ error: "Can't delete another admin account from here" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const targetEmail = (targetData.user.email || '').toLowerCase();
    if (!targetEmail || String(body?.confirmEmail || '').trim().toLowerCase() !== targetEmail) {
      return NextResponse.json({ error: "Type the account's email to confirm deletion" }, { status: 400 });
    }

    // Logged first: the account (and its own audit trail pointers) won't be
    // around afterwards, and the log itself is kept.
    await logAudit(request, caller, 'admin.delete_user', {
      entityType: 'user',
      entityId: targetUserId,
      metadata: { email: targetEmail },
    });

    const result = await deleteUserCompletely(targetUserId);
    return NextResponse.json({ deleted: true, id: targetUserId, ...result });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof DeleteAccountError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error deleting user:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to delete user' }, { status: 500 });
  }
}
