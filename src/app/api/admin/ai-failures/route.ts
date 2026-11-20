import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest } from '@/lib/auth';

// GET   /api/admin/ai-failures?status=open|resolved|all -> AI document reads that did not work for someone (newest first).
// PATCH { ids: string[], resolved: boolean }            -> mark them handled (or open again).
// Platform admins only. Reason, file name and size, and a short technical note; never document contents.
export async function GET(request: NextRequest) {
  try {
    const { isAdmin } = await getUserFromRequest(request);
    if (!isAdmin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

    const status = request.nextUrl.searchParams.get('status') ?? 'open';
    let query = supabaseServer
      .from('ai_read_failures')
      .select('id, created_at, user_id, feature, reason, detail, file_name, file_bytes, resolved_at')
      .order('created_at', { ascending: false })
      .limit(300);
    if (status === 'open') query = query.is('resolved_at', null);
    else if (status === 'resolved') query = query.not('resolved_at', 'is', null);
    const { data, error } = await query;
    if (error) {
      // The table is created by add-ai-failures.sql; say so instead of a bare failure.
      if (error.code === '42P01' || error.code === 'PGRST205' || /ai_read_failures/.test(error.message)) {
        return NextResponse.json({ failures: [], needsSetup: true });
      }
      throw error;
    }

    const ids = [...new Set((data ?? []).map((r) => r.user_id as string))];
    const people = new Map<string, { email: string | null; name: string | null }>();
    await Promise.all(
      ids.map(async (id) => {
        const { data: u } = await supabaseServer.auth.admin.getUserById(id);
        people.set(id, { email: u?.user?.email ?? null, name: (u?.user?.user_metadata?.full_name as string | undefined) ?? null });
      })
    );
    const failures = (data ?? []).map((r) => ({ ...r, email: people.get(r.user_id as string)?.email ?? null, name: people.get(r.user_id as string)?.name ?? null }));
    return NextResponse.json({ failures, needsSetup: false });
  } catch (error) {
    console.error('admin ai-failures failed:', error);
    return NextResponse.json({ error: 'Failed to load AI read problems' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { isAdmin } = await getUserFromRequest(request);
    if (!isAdmin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    const body = (await request.json().catch(() => ({}))) as { ids?: unknown; resolved?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === 'string').slice(0, 300) : [];
    if (ids.length === 0 || typeof body.resolved !== 'boolean') return NextResponse.json({ error: 'ids and resolved are required' }, { status: 400 });
    const { error } = await supabaseServer.from('ai_read_failures').update({ resolved_at: body.resolved ? new Date().toISOString() : null }).in('id', ids);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('admin ai-failures update failed:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
