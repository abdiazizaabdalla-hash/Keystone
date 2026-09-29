import { NextRequest, NextResponse } from 'next/server';
import { createAuthClient } from '@/lib/supabase';
import { getPendingInviteForEmail, addMemberToTeam, markInviteAccepted } from '@/lib/team';
import { setUserPlan } from '@/lib/stripeCustomers';
import { checkRateLimit } from '@/lib/rateLimit';

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

export async function POST(request: NextRequest) {
  try {
    const { email, password, redirectTo, fullName } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Looser than signin's limits -- a shared office/coworking IP can
    // have several legitimate signups in a short window -- but still
    // enough to stop scripted account-creation spam.
    const ip = getClientIp(request);
    const [ipOk, emailOk] = await Promise.all([
      checkRateLimit(`signup:ip:${ip}`, 10, 10 * 60),
      checkRateLimit(`signup:email:${email.toLowerCase()}`, 3, 10 * 60),
    ]);
    if (!ipOk || !emailOk) {
      return NextResponse.json(
        { error: 'Too many signup attempts. Please wait a few minutes and try again.' },
        { status: 429 }
      );
    }

    const trimmedName = typeof fullName === 'string' ? fullName.trim() : '';

    const { data, error } = await createAuthClient().auth.signUp({
      email,
      password,
      options: {
        ...(redirectTo ? { emailRedirectTo: redirectTo } : {}),
        ...(trimmedName ? { data: { full_name: trimmedName } } : {}),
      },
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // If someone invited this email to a Team workspace before they signed
    // up, join them to that team and grant Team-plan access immediately —
    // seats on a Team subscription are pre-paid by the owner, so an
    // invited teammate shouldn't have to pay or wait to be upgraded.
    if (data.user) {
      try {
        const invite = await getPendingInviteForEmail(email);
        if (invite) {
          await addMemberToTeam(invite.team_id, data.user.id, 'member');
          await markInviteAccepted(invite.id);
          await setUserPlan(data.user.id, 'team');
        }
      } catch (inviteError) {
        // Non-fatal — the account still exists on Starter; they can be
        // re-invited or added manually if this failed.
        console.error('Error applying team invite at signup:', inviteError);
      }
    }

    return NextResponse.json({
      user: data.user,
      session: data.session,
    });
  } catch (error) {
    console.error('Sign up error:', error);
    return NextResponse.json(
      { error: 'Sign up failed' },
      { status: 500 }
    );
  }
}
