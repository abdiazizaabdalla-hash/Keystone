import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { brokerageOn } from '@/lib/oversight';
import { oversightError } from '@/lib/oversightServer';
import { assertBrokerageManageable, getAccount } from '@/lib/brokerageAccount';
import { requireBrokerageOwnerOnly } from '@/lib/brokerageAdminsServer';
import { adminLimit, allowedRoles, isAdminRole, looksLikeEmail, normaliseAdminEmail } from '@/lib/brokerageAdmins';

// The brokerage owner's administrators. Only the owner manages them (an administrator cannot add or remove administrators).
//   GET                  -> the people, how many the plan allows, which roles it allows
//   POST { email, role } -> add one; they sign in with that email
//   DELETE ?id=          -> remove one; their access ends at once
async function tierFor(ownerId: string) {
  const account = await getAccount(ownerId);
  return account?.tier === 'pro' ? ('pro' as const) : ('basic' as const);
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!brokerageOn()) throw new AuthError('Not found', 404);
    await requireBrokerageOwnerOnly(user);
    const tier = await tierFor(user.id);
    const { data, error } = await supabaseServer.from('brokerage_admins').select('id, invited_email, admin_user_id, role, created_at').eq('owner_user_id', user.id).eq('status', 'active').order('created_at', { ascending: true });
    // Before add-brokerage-admins.sql has run there are simply no administrators.
    if (error && error.code !== 'PGRST205' && error.code !== '42P01') throw error;
    return NextResponse.json({
      tier,
      limit: adminLimit(tier),
      roles: allowedRoles(tier),
      admins: (data ?? []).map((a) => ({ id: a.id, email: a.invited_email, role: a.role, signedIn: Boolean(a.admin_user_id), addedAt: a.created_at })),
      ready: !error,
    });
  } catch (error) {
    return oversightError(error, 'load administrators');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!brokerageOn()) throw new AuthError('Not found', 404);
    await requireBrokerageOwnerOnly(user);
    await assertBrokerageManageable(user.id);
    const body = (await request.json().catch(() => ({}))) as { email?: unknown; role?: unknown };
    const email = normaliseAdminEmail(typeof body.email === 'string' ? body.email : '');
    if (!looksLikeEmail(email)) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    if (email === (user.email ?? '').toLowerCase()) return NextResponse.json({ error: 'You already have full access as the owner.' }, { status: 400 });
    const tier = await tierFor(user.id);
    const role = isAdminRole(body.role) ? body.role : null;
    if (!role || !allowedRoles(tier).includes(role)) {
      return NextResponse.json({ error: tier === 'basic' ? 'Scoped roles are part of Brokerage Pro. On Basic, an administrator is a Manager.' : 'Choose a role.' }, { status: 400 });
    }
    const { count, error: countError } = await supabaseServer.from('brokerage_admins').select('id', { count: 'exact', head: true }).eq('owner_user_id', user.id).eq('status', 'active');
    if (countError) throw countError;
    if ((count ?? 0) >= adminLimit(tier)) {
      return NextResponse.json({ error: `Your plan includes ${adminLimit(tier)} extra administrator${adminLimit(tier) === 1 ? '' : 's'}.` }, { status: 403 });
    }
    // One brokerage per administrator login keeps "which brokerage am I acting for" unambiguous.
    const { data: elsewhere } = await supabaseServer.from('brokerage_admins').select('id').ilike('invited_email', email).eq('status', 'active').limit(1);
    if ((elsewhere ?? []).length > 0) return NextResponse.json({ error: 'That email is already an administrator of a brokerage.' }, { status: 409 });
    const { data, error } = await supabaseServer.from('brokerage_admins').insert({ owner_user_id: user.id, invited_email: email, role }).select('id').single();
    if (error) throw error;
    await logAudit(request, user, 'brokerage.admin_add', { entityType: 'brokerage', entityId: user.id, metadata: { email, role } });
    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (error) {
    return oversightError(error, 'add the administrator');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (!brokerageOn()) throw new AuthError('Not found', 404);
    await requireBrokerageOwnerOnly(user);
    const id = request.nextUrl.searchParams.get('id') ?? '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { data, error } = await supabaseServer.from('brokerage_admins').update({ status: 'removed', removed_at: new Date().toISOString() }).eq('id', id).eq('owner_user_id', user.id).eq('status', 'active').select('id, invited_email').maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await logAudit(request, user, 'brokerage.admin_remove', { entityType: 'brokerage', entityId: user.id, metadata: { email: data.invited_email } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return oversightError(error, 'remove the administrator');
  }
}
