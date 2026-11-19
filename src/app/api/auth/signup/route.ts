import { NextRequest, NextResponse } from 'next/server';
import { createAuthClient, supabaseServer } from '@/lib/supabase';
import { applyPendingTeamInvite, sameOriginRedirect } from '@/lib/teamInvites';
import { checkRateLimit } from '@/lib/rateLimit';
import { mergeAppMetadata } from '@/lib/privileged';
import { LEGAL_VERSION } from '@/lib/site';
import { logAudit } from '@/lib/audit';
import { notifyNewSignup } from '@/lib/signupNotification';
import { agentSelfServeEnabled, AGENT_SELF_SERVE_OFF_MESSAGE } from '@/lib/agentSelfServe';

// Local testing only: skip the confirmation email. Needs RELAY_AUTO_CONFIRM_SIGNUP=1
// (set only in .env.development.local), a non-production build, and a
// Supabase project that is not production. Anything else leaves signup alone.
function autoConfirmEnabled(): boolean {
  if (process.env.RELAY_AUTO_CONFIRM_SIGNUP !== '1') return false;
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) return false;
  if ((process.env.NEXT_PUBLIC_SUPABASE_URL || '').includes('vjfttwkiaqrfaygrrrzf')) return false;
  return true;
}

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

export async function POST(request: NextRequest) {
  try {
    const { email, password, redirectTo, fullName, acceptedTerms, accountType } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    if (accountType === 'agent' && !agentSelfServeEnabled()) {
      return NextResponse.json({ error: AGENT_SELF_SERVE_OFF_MESSAGE }, { status: 403 });
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

    const signUp = await createAuthClient().auth.signUp({
      email,
      password,
      options: {
        ...(sameOriginRedirect(redirectTo, request.nextUrl.origin) ? { emailRedirectTo: sameOriginRedirect(redirectTo, request.nextUrl.origin) } : {}),
        ...(trimmedName ? { data: { full_name: trimmedName } } : {}),
      },
    });

    const { error } = signUp;
    let { data } = signUp;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (autoConfirmEnabled() && data.user && !data.session && (data.user.identities?.length ?? 0) > 0) {
      const { error: confirmError } = await supabaseServer.auth.admin.updateUserById(data.user.id, { email_confirm: true });
      if (confirmError) {
        console.error('Local auto-confirm failed:', confirmError);
      } else {
        const signedIn = await createAuthClient().auth.signInWithPassword({ email, password });
        if (signedIn.data.session && signedIn.data.user) {
          data = { user: signedIn.data.user, session: signedIn.data.session };
        }
      }
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
        // account_type goes in app_metadata (server-only), not user_metadata,
        // so it cannot be set by calling Supabase Auth directly.
        await mergeAppMetadata(data.user.id, {
          terms_accepted_at: new Date().toISOString(),
          terms_version: LEGAL_VERSION,
          ...(accountType === 'agent' ? { account_type: 'agent' } : {}),
        });
      } catch (consentError) {
        console.error('Error recording terms acceptance (non-fatal):', consentError);
      }
      await notifyNewSignup({
        email: String(email),
        fullName: trimmedName,
        emailConfirmed: Boolean(data.user.email_confirmed_at),
      });
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
