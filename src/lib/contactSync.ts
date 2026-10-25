import { supabaseServer } from '@/lib/supabase';
import { cleanTags, type ContactRow } from '@/lib/contactsCrm';

// Moving contacts between a TC's personal list and their team's shared list.
// Nothing is ever overwritten: a contact whose email (or, with no email, name) is already
// on the destination side is skipped.

export const MAX_CONTACTS = 5000;

const key = (c: { email: string | null; name: string }) => (c.email ? `e:${c.email.trim().toLowerCase()}` : `n:${(c.name || '').trim().toLowerCase()}`);

/** Shares some of the TC's own personal contacts with the team. */
export async function shareContactsToTeam(userId: string, teamId: string, ids: string[]): Promise<{ shared: number; skippedDuplicate: number }> {
  if (ids.length === 0) return { shared: 0, skippedDuplicate: 0 };
  const { data: teamRows } = await supabaseServer.from('contacts').select('email, name').eq('team_id', teamId).limit(10000);
  const taken = new Set((teamRows || []).map((r) => key(r as { email: string | null; name: string })));

  const candidates: Pick<ContactRow, 'id' | 'email' | 'name'>[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabaseServer
      .from('contacts')
      .select('id, email, name')
      .eq('tc_user_id', userId)
      .is('team_id', null)
      .in('id', ids.slice(i, i + 200));
    candidates.push(...((data || []) as Pick<ContactRow, 'id' | 'email' | 'name'>[]));
  }

  const toShare: string[] = [];
  let skippedDuplicate = 0;
  for (const c of candidates) {
    const k = key(c);
    if (!c.email && !c.name.trim()) continue;
    if (taken.has(k)) {
      skippedDuplicate += 1;
      continue;
    }
    taken.add(k);
    toShare.push(c.id);
  }

  const patch = { team_id: teamId, shared_at: new Date().toISOString() };
  let shared = 0;
  for (let i = 0; i < toShare.length; i += 200) {
    const chunk = toShare.slice(i, i + 200);
    const { error } = await supabaseServer.from('contacts').update(patch).in('id', chunk).eq('tc_user_id', userId);
    if (!error) {
      shared += chunk.length;
      continue;
    }
    // A teammate shared the same email a moment ago: fall back to one at a time and skip the clashes.
    for (const id of chunk) {
      const { error: oneError } = await supabaseServer.from('contacts').update(patch).eq('id', id).eq('tc_user_id', userId);
      if (!oneError) shared += 1;
      else if (oneError.code === '23505') skippedDuplicate += 1;
      else throw oneError;
    }
  }
  return { shared, skippedDuplicate };
}

/** Copies the contacts teammates shared into the TC's own personal list (as separate, private copies). */
export async function copyTeamContactsToMine(userId: string, teamId: string): Promise<{ copied: number; skippedDuplicate: number }> {
  const [{ data: theirs }, { data: mine }] = await Promise.all([
    supabaseServer.from('contacts').select('*').eq('team_id', teamId).neq('tc_user_id', userId).limit(MAX_CONTACTS),
    supabaseServer.from('contacts').select('email, name').eq('tc_user_id', userId).limit(MAX_CONTACTS),
  ]);
  const have = new Set((mine || []).map((r) => key(r as { email: string | null; name: string })));
  let room = MAX_CONTACTS - (mine || []).length;

  const rows: Record<string, unknown>[] = [];
  let skippedDuplicate = 0;
  for (const c of (theirs || []) as ContactRow[]) {
    const k = key(c);
    if (have.has(k)) {
      skippedDuplicate += 1;
      continue;
    }
    if (room <= 0) break;
    have.add(k);
    room -= 1;
    rows.push({
      tc_user_id: userId,
      name: c.name,
      email: c.email,
      phone: c.phone,
      company: c.company,
      role: c.role,
      notes: c.notes,
      tags: cleanTags(c.tags || []),
      contact_type: c.contact_type === 'organization' ? 'organization' : 'person',
      // never subscribed on someone else's say-so
      newsletter: false,
      source: 'team',
    });
  }

  let copied = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await supabaseServer.from('contacts').insert(chunk);
    if (!error) {
      copied += chunk.length;
      continue;
    }
    for (const row of chunk) {
      const { error: oneError } = await supabaseServer.from('contacts').insert(row);
      if (!oneError) copied += 1;
      else if (oneError.code === '23505') skippedDuplicate += 1;
      else throw oneError;
    }
  }
  return { copied, skippedDuplicate };
}
