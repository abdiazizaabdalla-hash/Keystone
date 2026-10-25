import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { requireContactsUser, contactsFail } from '@/lib/contactGuard';

// Open follow-ups across all of this TC's contacts, soonest first. Used by the
// "Follow-ups" panel on the Contacts page.
export async function GET(request: NextRequest) {
  try {
    const user = await requireContactsUser(request);
    const { data: reminders, error } = await supabaseServer
      .from('contact_reminders')
      .select('id, contact_id, due_on, note')
      .eq('tc_user_id', user.id)
      .is('done_at', null)
      .order('due_on', { ascending: true })
      .limit(200);
    if (error) throw error;

    const ids = [...new Set((reminders || []).map((r) => r.contact_id as string))];
    const names = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await supabaseServer.from('contacts').select('id, name, email').eq('tc_user_id', user.id).in('id', ids.slice(i, i + 200));
      for (const c of data || []) names.set(c.id as string, (c.name as string) || (c.email as string) || 'Contact');
    }
    return NextResponse.json({
      reminders: (reminders || []).map((r) => ({ ...r, contact_name: names.get(r.contact_id as string) || 'Contact' })),
    });
  } catch (error) {
    return contactsFail(error, 'load follow-ups');
  }
}
