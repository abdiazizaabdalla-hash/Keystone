import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { requireContactsUser, contactsFail, loadOwnedContact } from '@/lib/contactGuard';
import { loadContactRelations } from '@/lib/contactRelations';

// Everything the contact profile page shows: the contact, who they work for / who works for
// them, their deals and listings with counts, and the latest recorded interaction.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireContactsUser(request);
    const contact = await loadOwnedContact(user.id, id);
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

    const [relations, orgRes, peopleRes, lastRes, remindersRes] = await Promise.all([
      loadContactRelations(user.id, contact),
      contact.organization_id
        ? supabaseServer.from('contacts').select('id, name, email').eq('id', contact.organization_id).eq('tc_user_id', user.id).maybeSingle()
        : Promise.resolve({ data: null }),
      contact.contact_type === 'organization'
        ? supabaseServer.from('contacts').select('id, name, email, phone, role').eq('organization_id', id).eq('tc_user_id', user.id).order('name').limit(200)
        : Promise.resolve({ data: [] }),
      // "Last communicated" counts only recorded interactions, not private notes.
      supabaseServer.from('contact_activity').select('occurred_at').eq('contact_id', id).eq('tc_user_id', user.id).neq('kind', 'note').order('occurred_at', { ascending: false }).limit(1),
      supabaseServer.from('contact_reminders').select('due_on').eq('contact_id', id).eq('tc_user_id', user.id).is('done_at', null).order('due_on').limit(1),
    ]);

    // An agent with the same email as this contact is the same person: remember the link so
    // the Agents page and this profile always point at one record.
    if (!contact.agent_id && relations.agentIds.length > 0) {
      const { error } = await supabaseServer.from('contacts').update({ agent_id: relations.agentIds[0] }).eq('id', id).eq('tc_user_id', user.id);
      if (!error) contact.agent_id = relations.agentIds[0];
    }

    return NextResponse.json({
      contact,
      organization: orgRes.data || null,
      people: peopleRes.data || [],
      transactions: relations.transactions,
      listings: relations.listings,
      stats: relations.stats,
      lastInteractionAt: lastRes.data?.[0]?.occurred_at ?? null,
      nextFollowUpOn: remindersRes.data?.[0]?.due_on ?? null,
    });
  } catch (error) {
    return contactsFail(error, 'load contact profile');
  }
}
