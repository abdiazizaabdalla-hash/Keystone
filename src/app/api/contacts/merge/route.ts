import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { requireContactsUser, contactsFail } from '@/lib/contactGuard';
import { UUID_RE, cleanTags, type ContactRow } from '@/lib/contactsCrm';

// POST { keepId, mergeIds: [...] }: folds the other contacts into the one you keep.
// Blank fields on the kept contact are filled from the others (the kept contact always
// wins when both have a value), tags are combined, notes are appended, and the notes,
// interactions, reminders, and "works at" links move over. The merged contacts are
// then removed. Nothing is merged unless every id is in this TC's address book.
export async function POST(request: NextRequest) {
  try {
    const user = await requireContactsUser(request, { write: true });
    const body = await request.json().catch(() => ({}));
    const keepId = typeof body.keepId === 'string' ? body.keepId : '';
    const mergeIds: string[] = Array.isArray(body.mergeIds) ? [...new Set<string>(body.mergeIds.filter((v: unknown): v is string => typeof v === 'string'))] : [];
    if (!UUID_RE.test(keepId) || mergeIds.length === 0 || mergeIds.length > 10 || mergeIds.some((m) => !UUID_RE.test(m)) || mergeIds.includes(keepId)) {
      return NextResponse.json({ error: 'Pick one contact to keep and up to 10 to merge into it' }, { status: 400 });
    }

    const { data: found, error: loadErr } = await supabaseServer
      .from('contacts')
      .select('*')
      .eq('tc_user_id', user.id)
      .in('id', [keepId, ...mergeIds]);
    if (loadErr) throw loadErr;
    const keep = (found || []).find((c) => c.id === keepId) as ContactRow | undefined;
    const others = ((found || []) as ContactRow[]).filter((c) => c.id !== keepId);
    if (!keep || others.length !== mergeIds.length) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    if (keep.team_id || others.some((o) => o.team_id)) {
      return NextResponse.json({ error: 'Stop sharing these contacts with your team before merging them' }, { status: 400 });
    }

    const pick = <K extends 'name' | 'email' | 'phone' | 'company' | 'role'>(key: K): string | null =>
      (keep[key] && String(keep[key]).trim() ? keep[key] : others.map((o) => o[key]).find((v) => v && String(v).trim())) || null;

    const mergedNotes = [keep.notes, ...others.map((o) => o.notes)].filter((n): n is string => !!n && !!n.trim());
    const email = pick('email');
    const fields = {
      name: pick('name') || '',
      phone: pick('phone'),
      company: pick('company'),
      role: pick('role'),
      notes: mergedNotes.length ? [...new Set(mergedNotes)].join('\n\n').slice(0, 2000) : null,
      tags: cleanTags([...(keep.tags || []), ...others.flatMap((o) => o.tags || [])]),
      newsletter: Boolean(keep.newsletter || others.some((o) => o.newsletter)) && Boolean(email),
      organization_id:
        keep.contact_type === 'organization' ? null : keep.organization_id || others.map((o) => o.organization_id).find((v) => v && v !== keepId) || null,
      agent_id: keep.agent_id || others.map((o) => o.agent_id).find(Boolean) || null,
      updated_at: new Date().toISOString(),
    };

    // 1. Move everything that points at the merged contacts onto the kept one.
    for (const table of ['contact_activity', 'contact_reminders'] as const) {
      const { error } = await supabaseServer.from(table).update({ contact_id: keepId }).in('contact_id', mergeIds).eq('tc_user_id', user.id);
      if (error) throw error;
    }
    {
      const { error } = await supabaseServer.from('contacts').update({ organization_id: keepId }).in('organization_id', mergeIds).eq('tc_user_id', user.id).neq('id', keepId);
      if (error) throw error;
    }
    // 2. Fill in the kept contact (not the email or agent link yet: those are unique and the old rows still hold them).
    {
      const { agent_id: _agent, ...rest } = fields;
      void _agent;
      const { error } = await supabaseServer.from('contacts').update(rest).eq('id', keepId).eq('tc_user_id', user.id);
      if (error) throw error;
    }
    // 3. Remove the merged contacts.
    {
      const { error } = await supabaseServer.from('contacts').delete().in('id', mergeIds).eq('tc_user_id', user.id);
      if (error) throw error;
    }
    // 4. Now the freed-up unique values can move over.
    {
      const patch: Record<string, unknown> = {};
      if (email && email !== keep.email) patch.email = email;
      if (fields.agent_id && fields.agent_id !== keep.agent_id) patch.agent_id = fields.agent_id;
      if (Object.keys(patch).length > 0) {
        const { error } = await supabaseServer.from('contacts').update(patch).eq('id', keepId).eq('tc_user_id', user.id);
        if (error) throw error;
      }
    }

    await supabaseServer.from('contact_activity').insert({
      contact_id: keepId,
      tc_user_id: user.id,
      kind: 'note',
      body: `Merged ${others.length} duplicate contact${others.length === 1 ? '' : 's'} into this one: ${others.map((o) => o.name || o.email).join(', ')}.`.slice(0, 4000),
    });

    const { data: merged } = await supabaseServer.from('contacts').select('*').eq('id', keepId).eq('tc_user_id', user.id).maybeSingle();
    return NextResponse.json({ contact: merged, merged: others.length });
  } catch (error) {
    return contactsFail(error, 'merge contacts');
  }
}
