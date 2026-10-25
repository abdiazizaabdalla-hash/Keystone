import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { requireContactsUser, contactsFail } from '@/lib/contactGuard';
import { UUID_RE, cleanTags, escapeLike } from '@/lib/contactsCrm';
import { EMAIL_RE } from '@/lib/stepEmailTemplates';

// The Contacts record for an agent profile: one person, one record. Finds the contact
// already linked to the agent, else the contact with the same email, else creates one;
// then links it so the Agents page and the contact profile always open the same page.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    const user = await requireContactsUser(request, { write: true });

    const { data: agent } = await supabaseServer.from('agents').select('id, name, email, phone, brokerage').eq('id', id).eq('tc_user_id', user.id).maybeSingle();
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    const linked = await supabaseServer.from('contacts').select('id').eq('tc_user_id', user.id).eq('agent_id', id).maybeSingle();
    if (linked.data) return NextResponse.json({ contactId: linked.data.id });

    const email = (agent.email || '').trim().toLowerCase();
    const hasEmail = !!email && email.length <= 254 && EMAIL_RE.test(email);
    let existingId: string | null = null;
    if (hasEmail) {
      const { data } = await supabaseServer.from('contacts').select('id, agent_id').eq('tc_user_id', user.id).ilike('email', escapeLike(email)).limit(1);
      if (data?.[0] && !data[0].agent_id) existingId = data[0].id as string;
    } else if ((agent.name || '').trim()) {
      const { data } = await supabaseServer.from('contacts').select('id, agent_id').eq('tc_user_id', user.id).eq('contact_type', 'person').ilike('name', escapeLike(agent.name.trim())).limit(5);
      const free = (data || []).find((c) => !c.agent_id);
      if (free) existingId = free.id as string;
    }

    if (existingId) {
      const { error } = await supabaseServer.from('contacts').update({ agent_id: id }).eq('id', existingId).eq('tc_user_id', user.id);
      if (error) throw error;
      return NextResponse.json({ contactId: existingId });
    }

    const { data: created, error } = await supabaseServer
      .from('contacts')
      .insert({
        tc_user_id: user.id,
        name: (agent.name || '').trim().slice(0, 120),
        email: hasEmail ? email : null,
        phone: agent.phone ? String(agent.phone).trim().slice(0, 40) || null : null,
        company: agent.brokerage ? String(agent.brokerage).trim().slice(0, 120) || null : null,
        role: 'Agent',
        tags: cleanTags(['Agent']),
        newsletter: false,
        source: 'deals',
        agent_id: id,
      })
      .select('id')
      .single();
    if (error) throw error;
    return NextResponse.json({ contactId: created.id }, { status: 201 });
  } catch (error) {
    return contactsFail(error, 'open agent profile');
  }
}
