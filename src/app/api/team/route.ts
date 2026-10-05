import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { setUserPlan } from '@/lib/stripeCustomers';
import { computeAttentionSummary } from '@/lib/attentionSummary';
import { sendTeamAddedEmail, sendTeamInviteEmail, sendTeamRemovedEmail } from '@/lib/teamEmails';
import {
  TEAM_SEAT_LIMIT,
  getTeamForUser,
  ensureTeamForOwner,
  getTeamMemberUserIds,
  getTeamMemberCount,
  getPendingInviteCount,
  getTeamInvites,
  createInvite,
  addMemberToTeam,
  removeMemberFromTeam,
  findUserIdByEmail,
  getPaidSeatCount,
  addPaidSeat,
  removePaidSeat,
  getSeatInfo,
} from '@/lib/team';
import { isTeamPlan } from '@/lib/plans';
import { getUserPlan } from '@/lib/privileged';

interface UserInfo {
  email: string;
  name: string;
}

async function getUserInfo(userId: string): Promise<UserInfo> {
  const { data } = await supabaseServer.auth.admin.getUserById(userId);
  const email = data.user?.email || 'unknown';
  const name = typeof data.user?.user_metadata?.full_name === 'string' ? data.user.user_metadata.full_name : '';
  return { email, name };
}

// GET: the caller's team roster. Every member sees who else is on the
// team (name/role only). The owner additionally sees each member's
// pipeline specifics (active transaction count, agent count) and pending
// invites — regular members do NOT get that detail about their teammates,
// only the roster itself.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);

    let membership = await getTeamForUser(user.id);

    // Self-heal: a Team-plan user with no team yet (e.g. webhook hasn't
    // run, or an older account from before this feature existed) gets one
    // created on first visit here, as the owner.
    if (!membership && isTeamPlan(getUserPlan(user))) {
      const team = await ensureTeamForOwner(user.id);
      membership = { team, role: 'owner' };
    }

    if (!membership) {
      return NextResponse.json({ team: null, role: null, members: [], pendingInvites: [], seatLimit: TEAM_SEAT_LIMIT });
    }

    const isOwner = membership.role === 'owner';
    const memberIds = await getTeamMemberUserIds(membership.team.id);

    // One shared computation for the whole roster instead of a
    // per-member round trip for each count -- see lib/attentionSummary.ts
    // (same function the dashboard's "Needs Attention" widget uses).
    // This is what backs each member's overdue/due-today/waiting-on/
    // closing-soon counts below (the "TC workload" view on
    // /dashboard/collaborate); isOwner-gated since a regular member
    // doesn't get this breakdown for their teammates at all.
    const workload = isOwner ? await computeAttentionSummary(memberIds) : null;
    const workloadByTc = new Map((workload?.byTc || []).map((w) => [w.tcUserId, w]));

    const members = await Promise.all(
      memberIds.map(async (memberId) => {
        const { email, name } = await getUserInfo(memberId);
        const base = {
          userId: memberId,
          email,
          name,
          role: memberId === membership!.team.owner_id ? 'owner' : 'member',
          isYou: memberId === user.id,
        };

        if (!isOwner) return base;

        const { count: agentCount } = await supabaseServer
          .from('agents')
          .select('id', { count: 'exact', head: true })
          .eq('tc_user_id', memberId);

        const { count: total } = await supabaseServer
          .from('transactions')
          .select('id', { count: 'exact', head: true })
          .eq('tc_user_id', memberId);

        const tcWorkload = workloadByTc.get(memberId);

        return {
          ...base,
          stats: {
            agents: agentCount || 0,
            activeTransactions: tcWorkload?.activeTransactions || 0,
            totalTransactions: total || 0,
            overdueCount: tcWorkload?.overdueCount || 0,
            dueTodayCount: tcWorkload?.dueTodayCount || 0,
            waitingOnCount: tcWorkload?.waitingOnCount || 0,
            closingSoonCount: tcWorkload?.closingSoonCount || 0,
          },
        };
      })
    );

    const pendingInvites = isOwner ? await getTeamInvites(membership.team.id) : [];

    const seatLimit = await getPaidSeatCount(membership.team.owner_id);
    // Every member on a team is granted the SAME plan id as its owner
    // (see getTeamOwnerPlan / the invite-acceptance flows) -- 'team' or
    // 'brokerage' -- so the caller's own plan metadata already reflects
    // the right per-seat price, owner or member, without a second
    // lookup of the owner's row.
    const seatInfo = getSeatInfo(getUserPlan(user));

    return NextResponse.json({
      team: {
        id: membership.team.id,
        name: membership.team.name,
        defaultChecklistTemplateId: membership.team.default_checklist_template_id,
      },
      role: membership.role,
      // So the frontend can show Brokerage-only settings (workspace
      // defaults, the agent roster) without a second round trip -- every
      // member is granted the same plan id as the owner (see
      // getTeamOwnerPlan), so the caller's own metadata already reflects
      // it correctly whether they're the owner or not.
      planId: getUserPlan(user) || null,
      seatLimit,
      seatPriceLabel: seatInfo.pricePerSeatLabel,
      members,
      pendingInvites: pendingInvites.map((inv) => ({ id: inv.id, email: inv.email, createdAt: inv.created_at })),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching team:', error);
    return NextResponse.json({ error: 'Failed to fetch team' }, { status: 500 });
  }
}

// PATCH: update the team/brokerage's own settings. Owner-only. `name`
// applies to Team and Brokerage alike. defaultChecklistTemplateId is
// Brokerage-only (standardizing the checklist/workflow across the
// brokerage's TCs) -- there's deliberately no fee/invoicing default
// here, see the comment on TeamRow in lib/team.ts.
export async function PATCH(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const body = await request.json();

    const membership = await getTeamForUser(user.id);
    if (!membership || membership.role !== 'owner') {
      return NextResponse.json({ error: 'Only the team owner can update team settings' }, { status: 403 });
    }

    const updateFields: Record<string, unknown> = {};

    if (typeof body.name === 'string') {
      const trimmed = body.name.trim();
      updateFields.name = trimmed.length > 0 ? trimmed : null;
    }

    const isBrokerage = getUserPlan(user) === 'brokerage';
    if (isBrokerage && body.defaultChecklistTemplateId !== undefined) {
      updateFields.default_checklist_template_id = body.defaultChecklistTemplateId;
    }

    if (Object.keys(updateFields).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { error } = await supabaseServer.from('teams').update(updateFields).eq('id', membership.team.id);
    if (error) throw error;

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error updating team settings:', error);
    return NextResponse.json({ error: 'Failed to update team settings' }, { status: 500 });
  }
}

// POST: invite a teammate by email. Owner-only. If the email already has
// an account, they're added immediately and granted Team-plan access
// (seats are pre-paid by the owner's subscription). Otherwise a pending
// invite is stored and gets consumed automatically at signup. Either way
// we email the person letting them know — non-fatal if it fails (e.g. the
// Resend account is still in sandbox mode), since the membership/invite
// itself already succeeded by that point.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
    }

    const membership = await getTeamForUser(user.id);
    if (!membership || membership.role !== 'owner') {
      return NextResponse.json({ error: 'Only the team owner can invite teammates' }, { status: 403 });
    }

    const [memberCount, pendingCount, paidSeats] = await Promise.all([
      getTeamMemberCount(membership.team.id),
      getPendingInviteCount(membership.team.id),
      getPaidSeatCount(user.id),
    ]);

    // The owner's subscription already covers `paidSeats` seats (3 by
    // default). Adding a teammate beyond that buys one more seat right
    // now — Stripe charges the prorated $19 immediately and rolls the
    // extra seat into the next monthly invoice going forward.
    let addedPaidSeat = false;
    if (memberCount + pendingCount >= paidSeats) {
      try {
        await addPaidSeat(user.id);
        addedPaidSeat = true;
      } catch (seatError) {
        console.error('Error adding paid seat:', seatError);
        return NextResponse.json(
          { error: 'Could not charge your card for an additional seat. Please check your billing and try again.' },
          { status: 402 }
        );
      }
    }

    const ownerLabel = user.user_metadata?.full_name || user.email || 'Your team owner';
    const appUrl = request.nextUrl.origin;

    const existingUserId = await findUserIdByEmail(email);

    if (existingUserId) {
      const existingMembership = await getTeamForUser(existingUserId);
      if (existingMembership) {
        return NextResponse.json({ error: 'That person is already on a team.' }, { status: 409 });
      }
      await addMemberToTeam(membership.team.id, existingUserId, 'member');
      // Grant the SAME plan id as the team owner -- 'team' or
      // 'brokerage' -- not a hardcoded 'team', since the caller here (an
      // owner adding someone directly) may be a Brokerage owner.
      await setUserPlan(existingUserId, isTeamPlan(getUserPlan(user)) ? (getUserPlan(user) as 'team' | 'brokerage') : 'team');

      let emailSent = true;
      try {
        await sendTeamAddedEmail({ toEmail: email, ownerLabel, appUrl });
      } catch (emailError) {
        emailSent = false;
        console.error('Error sending team-added email:', emailError);
      }

      return NextResponse.json({ status: 'added', email, emailSent, addedPaidSeat });
    }

    try {
      await createInvite(membership.team.id, email, user.id);
    } catch (inviteError: unknown) {
      const code = (inviteError as { code?: string })?.code;
      if (code === '23505') {
        return NextResponse.json({ error: 'That email has already been invited.' }, { status: 409 });
      }
      throw inviteError;
    }

    let emailSent = true;
    try {
      await sendTeamInviteEmail({ toEmail: email, ownerLabel, appUrl });
    } catch (emailError) {
      emailSent = false;
      console.error('Error sending team-invite email:', emailError);
    }

    return NextResponse.json({ status: 'invited', email, emailSent, addedPaidSeat });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error inviting teammate:', error);
    return NextResponse.json({ error: 'Failed to send invite' }, { status: 500 });
  }
}

// DELETE: remove a teammate from the team. Owner-only, and an owner can't
// remove themselves this way (cancel the subscription instead, which
// dissolves the team for everyone via the Stripe webhook).
export async function DELETE(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('userId');

    if (!targetUserId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const membership = await getTeamForUser(user.id);
    if (!membership || membership.role !== 'owner') {
      return NextResponse.json({ error: 'Only the team owner can remove teammates' }, { status: 403 });
    }
    if (targetUserId === user.id) {
      return NextResponse.json({ error: "You can't remove yourself as the team owner." }, { status: 400 });
    }

    // Confirm targetUserId is actually a member of THIS owner's team
    // before touching their plan. Without this check, removeMemberFromTeam
    // below silently no-ops for a non-member (its delete is scoped to
    // this team_id, so it just matches no rows) but setUserPlan would
    // still run unconditionally -- letting any team owner downgrade an
    // arbitrary, unrelated paying customer to Starter just by passing
    // their user id. Found during the 2026-09 security audit.
    const currentMemberIds = await getTeamMemberUserIds(membership.team.id);
    if (!currentMemberIds.includes(targetUserId)) {
      return NextResponse.json({ error: 'That person is not on your team' }, { status: 404 });
    }

    // Downgrade the plan BEFORE removing the membership row, not after.
    // Every feature gate in this app checks the plan in app_metadata (getUserPlan)
    // live on each request (see getPlanLimits(getUserPlan(user))
    // in the agents/transactions/checklist-template routes) -- that
    // field, not the membership row, is what actually grants Team-tier
    // access. If setUserPlan threw AFTER the membership row was already
    // deleted, this person would be off the team but permanently stuck
    // with plan: 'team' in their own metadata -- free, unpaid Team
    // access forever, since nothing else would ever downgrade them
    // again. Doing the downgrade first means a failure here aborts
    // before anything changes, and it's safe for the owner to just
    // retry the removal (setUserPlan is a plain overwrite, idempotent
    // either way).
    await setUserPlan(targetUserId, 'starter');
    await removeMemberFromTeam(membership.team.id, targetUserId);

    try {
      await removePaidSeat(user.id);
    } catch (seatError) {
      // Non-fatal: the member is already removed from the team either
      // way. Worst case the owner's seat count doesn't shrink until
      // they contact support, rather than the removal itself failing.
      console.error('Error releasing paid seat:', seatError);
    }

    // Let the removed person know -- their account just silently lost
    // Team access and dropped to Starter, so this is their only signal
    // unless they happen to notice next time they log in. Non-fatal,
    // same as the invite/add emails above: the removal itself already
    // succeeded by this point.
    let emailSent = true;
    try {
      const { email } = await getUserInfo(targetUserId);
      const ownerLabel = user.user_metadata?.full_name || user.email || 'Your team owner';
      const appUrl = request.nextUrl.origin;
      await sendTeamRemovedEmail({ toEmail: email, ownerLabel, appUrl });
    } catch (emailError) {
      emailSent = false;
      console.error('Error sending team-removed email:', emailError);
    }

    return NextResponse.json({ status: 'removed', emailSent });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error removing teammate:', error);
    return NextResponse.json({ error: 'Failed to remove teammate' }, { status: 500 });
  }
}
