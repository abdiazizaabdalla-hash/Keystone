import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { requireContactsUser, contactsFail } from '@/lib/contactGuard';

// Likely duplicate contacts, found by the same name or the same phone number.
// (The same email can't happen: emails are unique per address book.) Read-only;
// merging is a separate, explicit step.
export async function GET(request: NextRequest) {
  try {
    const user = await requireContactsUser(request);
    const { data, error } = await supabaseServer
      .from('contacts')
      .select('id, name, email, phone, company, role, contact_type, created_at')
      .eq('tc_user_id', user.id)
      .limit(5000);
    if (error) throw error;
    const rows = data || [];

    // Union-find so a name match and a phone match that share a contact end up in one group.
    const parent = new Map<string, string>(rows.map((r) => [r.id as string, r.id as string]));
    const find = (x: string): string => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r) as string;
      parent.set(x, r);
      return r;
    };
    const reasons = new Map<string, Set<string>>();
    const link = (ids: string[], reason: string) => {
      for (let i = 1; i < ids.length; i++) parent.set(find(ids[i]), find(ids[0]));
      for (const id of ids) {
        const set = reasons.get(id) || new Set<string>();
        set.add(reason);
        reasons.set(id, set);
      }
    };

    const byName = new Map<string, string[]>();
    const byPhone = new Map<string, string[]>();
    for (const r of rows) {
      const name = String(r.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (name.length >= 3) {
        const key = `${r.contact_type || 'person'}:${name}`;
        byName.set(key, [...(byName.get(key) || []), r.id as string]);
      }
      const digits = String(r.phone || '').replace(/\D/g, '').slice(-10);
      if (digits.length >= 10) byPhone.set(digits, [...(byPhone.get(digits) || []), r.id as string]);
    }
    for (const ids of byName.values()) if (ids.length > 1) link(ids, 'same name');
    for (const ids of byPhone.values()) if (ids.length > 1) link(ids, 'same phone number');

    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!reasons.has(r.id as string)) continue;
      const root = find(r.id as string);
      groups.set(root, [...(groups.get(root) || []), r]);
    }
    const out = [...groups.values()]
      .filter((g) => g.length > 1)
      .slice(0, 50)
      .map((g) => ({
        contacts: g,
        reasons: [...new Set(g.flatMap((c) => [...(reasons.get(c.id as string) || [])]))],
      }));
    return NextResponse.json({ groups: out });
  } catch (error) {
    return contactsFail(error, 'find duplicates');
  }
}
