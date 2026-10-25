import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { requireContactsUser, contactsFail, loadAccessibleContact } from '@/lib/contactGuard';
import { UUID_RE, isIsoDate } from '@/lib/contactsCrm';

const MAX_OPEN = 50;

// Follow-up reminders for one contact.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireContactsUser(request);
    if (!(await loadAccessibleContact(user.id, id))) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    const { data, error } = await supabaseServer
      .from('contact_reminders')
      .select('id, contact_id, due_on, note, done_at, created_at')
      .eq('contact_id', id)
      .eq('tc_user_id', user.id)
      .order('due_on', { ascending: true })
      .limit(200);
    if (error) throw error;
    return NextResponse.json({ reminders: data || [] });
  } catch (error) {
    return contactsFail(error, 'load reminders');
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireContactsUser(request, { write: true });
    if (!(await loadAccessibleContact(user.id, id))) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    if (!isIsoDate(body.dueOn)) return NextResponse.json({ error: 'Pick a date for the reminder' }, { status: 400 });
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) || null : null;

    const { count } = await supabaseServer
      .from('contact_reminders')
      .select('id', { count: 'exact', head: true })
      .eq('contact_id', id)
      .is('done_at', null);
    if ((count ?? 0) >= MAX_OPEN) return NextResponse.json({ error: 'Finish some reminders before adding more' }, { status: 400 });

    const { data, error } = await supabaseServer
      .from('contact_reminders')
      .insert({ contact_id: id, tc_user_id: user.id, due_on: body.dueOn, note })
      .select('id, contact_id, due_on, note, done_at, created_at')
      .single();
    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return contactsFail(error, 'save reminder');
  }
}

// PATCH { reminderId, done } marks a reminder done or open again.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireContactsUser(request, { write: true });
    const body = await request.json().catch(() => ({}));
    if (typeof body.reminderId !== 'string' || !UUID_RE.test(body.reminderId)) return NextResponse.json({ error: 'Reminder id is required' }, { status: 400 });
    const { data, error } = await supabaseServer
      .from('contact_reminders')
      .update({ done_at: body.done === false ? null : new Date().toISOString() })
      .eq('id', body.reminderId)
      .eq('contact_id', id)
      .eq('tc_user_id', user.id)
      .select('id, contact_id, due_on, note, done_at, created_at')
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Reminder not found' }, { status: 404 });
    return NextResponse.json(data);
  } catch (error) {
    return contactsFail(error, 'update reminder');
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireContactsUser(request, { write: true });
    const reminder = new URL(request.url).searchParams.get('reminder') || '';
    if (!UUID_RE.test(reminder)) return NextResponse.json({ error: 'Reminder id is required' }, { status: 400 });
    const { error } = await supabaseServer.from('contact_reminders').delete().eq('id', reminder).eq('contact_id', id).eq('tc_user_id', user.id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return contactsFail(error, 'delete reminder');
  }
}
