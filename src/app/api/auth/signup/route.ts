import { NextRequest, NextResponse } from 'next/server';
import { createAuthClient } from '@/lib/supabase';
import { applyPendingTeamInvite, sameOriginRedirect } from '@/lib/teamInvites';
import { checkRateLimit } from '@/lib/rateLimit';
import { mergeAppMetadata } from '@/lib/privileged';
import { LEGAL_VERSION } from '@/lib/site';
import { logAudit } from '@/lib/audit';

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

export async function POST(request: NextRequest) {
  try {
    const { email, password, redirectTo, fullName, acceptedTerms } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    if (acceptedTerms !== true) {
      return NextResponse.json(
        { error: 'Please accept the Terms of Service and Privacy Policy to create an account.' },
        { status: 400 }
      );
    }
    if (typeof password !== 'string' || password.length < 10) {
      return NextResponse.json({ error: 'Password must be at least 10 characters.' }, { status: 400 });
    }
    if (password.length > 200 || /^\d+$/.test(password) || password.toLowerCase() === String(email).toLowerCase()) {
      return NextResponse.json({ error: 'Choose a stronger password (not only digits, and not your email).' }, { status: 400 });
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
        ...(sameOriginRedirect(redirectTo, request.nextUrl.origin) ? { emailRedirectTo: sameOriginRedirect(redirectTo, request.nextUrl.origin) } : {}),
        ...(trimmedName ? { data: { full_name: trimmedName } } : {}),
      },
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // If someone invited this email to a Team workspace before they signed
    // up, join them to it -- but only for a brand-new account whose email is
    // already confirmed (see applyPendingTeamInvite). Signing up with an
    // email that already has an account returns a stub user with no
    // identities, which must not consume anyone's invite. Otherwise the
    // invite is applied at their first confirmed sign-in.
    if (data.user && (data.user.identities?.length ?? 0) > 0) {
      // Record when (and which version of) the terms were accepted. Stored
      // in app_metadata so a user can't edit it.
      await logAudit(request, data.user, 'auth.signup', { entityType: 'user', entityId: data.user.id, metadata: { termsVersion: LEGAL_VERSION } });
      try {
        await mergeAppMetadata(data.user.id, {
          terms_accepted_at: new Date().toISOString(),
          terms_version: LEGAL_VERSION,
        });
      } catch (consentError) {
        console.error('Error recording terms acceptance (non-fatal):', consentError);
      }
      try {
        await applyPendingTeamInvite(data.user);
      } catch (inviteError) {
        // Non-fatal -- the account still exists on Starter; the invite is
        // retried at sign-in.
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
