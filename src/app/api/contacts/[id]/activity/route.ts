import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { requireContactsUser, contactsFail, loadOwnedContact } from '@/lib/contactGuard';
import { ACTIVITY_KINDS, UUID_RE, type ActivityKind } from '@/lib/contactsCrm';

const MAX_PER_CONTACT = 1000;

// Notes and recorded interactions (call / email / text / meeting) for one contact.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireContactsUser(request);
    if (!(await loadOwnedContact(user.id, id))) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    const { data, error } = await supabaseServer
      .from('contact_activity')
      .select('id, contact_id, kind, body, occurred_at, created_at')
      .eq('contact_id', id)
      .eq('tc_user_id', user.id)
      .order('occurred_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    return NextResponse.json({ activity: data || [] });
  } catch (error) {
    return contactsFail(error, 'load activity');
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireContactsUser(request, { write: true });
    if (!(await loadOwnedContact(user.id, id))) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    const kind = ACTIVITY_KINDS.includes(body.kind) ? (body.kind as ActivityKind) : 'note';
    const text = typeof body.body === 'string' ? body.body.trim().slice(0, 4000) : '';
    if (!text) return NextResponse.json({ error: 'Write something first' }, { status: 400 });

    // The time the interaction happened (defaults to now); never in the future.
    let occurredAt = new Date();
    if (typeof body.occurredAt === 'string') {
      const t = new Date(body.occurredAt);
      if (!Number.isNaN(t.getTime()) && t.getTime() <= Date.now() + 60_000) occurredAt = t;
    }

    const { count } = await supabaseServer.from('contact_activity').select('id', { count: 'exact', head: true }).eq('contact_id', id);
    if ((count ?? 0) >= MAX_PER_CONTACT) return NextResponse.json({ error: 'This contact has reached the history limit' }, { status: 400 });

    const { data, error } = await supabaseServer
      .from('contact_activity')
      .insert({ contact_id: id, tc_user_id: user.id, kind, body: text, occurred_at: occurredAt.toISOString() })
      .select('id, contact_id, kind, body, occurred_at, created_at')
      .single();
    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return contactsFail(error, 'save activity');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireContactsUser(request, { write: true });
    const entry = new URL(request.url).searchParams.get('entry') || '';
    if (!UUID_RE.test(entry)) return NextResponse.json({ error: 'Entry id is required' }, { status: 400 });
    const { error } = await supabaseServer.from('contact_activity').delete().eq('id', entry).eq('contact_id', id).eq('tc_user_id', user.id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return contactsFail(error, 'delete activity');
  }
}
