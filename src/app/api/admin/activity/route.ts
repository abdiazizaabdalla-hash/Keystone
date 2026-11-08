import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest } from '@/lib/auth';
import { hasAgentRole } from '@/lib/privileged';
import { loadActivity, loadActivityDetail } from '@/lib/adminActivity';

// GET /api/admin/activity            -> every coordinator with when they last used Relay and how much of each feature they use.
// GET /api/admin/activity?userId=ID  -> one account in detail (recent actions, deals, document file names).
// Platform admins only. Counts and dates; never message text, document contents, client names or prices.
export async function GET(request: NextRequest) {
  try {
    const { isAdmin } = await getUserFromRequest(request);
    if (!isAdmin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

    const userId = request.nextUrl.searchParams.get('userId');
    if (userId) return NextResponse.json(await loadActivityDetail(userId));

    const { data, error } = await supabaseServer.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw error;
    const tcUsers = data.users.filter((u) => !hasAgentRole(u));
    const activity = await loadActivity(new Map(tcUsers.map((u) => [u.id, u.last_sign_in_at || null])));
    const rows = tcUsers.map((u) => {
      const a = activity.get(u.id);
      return {
        id: u.id,
        email: u.email,
        name: (u.user_metadata?.full_name as string) || null,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at || null,
        onboarded: u.user_metadata?.onboarding_completed === true,
        ...(a || { lastActiveAt: u.last_sign_in_at || null, lastActiveWhat: 'Signed in' }),
      };
    });
    rows.sort((x, y) => (y.lastActiveAt || '').localeCompare(x.lastActiveAt || ''));
    return NextResponse.json({ users: rows });
  } catch (error) {
    console.error('admin activity failed:', error);
    return NextResponse.json({ error: 'Failed to load activity' }, { status: 500 });
  }
}
