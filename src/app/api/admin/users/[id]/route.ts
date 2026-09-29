import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';

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

    if (targetUserId === caller.id) {
      return NextResponse.json({ error: "You can't suspend your own account" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
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
    if (action === 'suspend' && targetData.user.user_metadata?.is_admin === true) {
      return NextResponse.json({ error: "Can't suspend another admin account from here" }, { status: 400 });
    }

    const { error: updateError } = await supabaseServer.auth.admin.updateUserById(targetUserId, {
      ban_duration: action === 'suspend' ? INDEFINITE_BAN : 'none',
    });
    if (updateError) throw updateError;

    return NextResponse.json({ id: targetUserId, suspended: action === 'suspend' });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error updating user suspension state:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}
