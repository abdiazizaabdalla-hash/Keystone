import { supabaseServer } from '@/lib/supabase';
import { cleanTags } from '@/lib/contactsCrm';
import { categoryForRole } from '@/lib/contactCategories';
import { EMAIL_RE } from '@/lib/stepEmailTemplates';

// Keeps a TC's Contacts directory filled in as they work: whenever a person with an
// email is added to a deal (or an agent is created), they are saved to the directory
// if that email isn't there yet. Existing contacts are never changed, and nobody is
// ever added to the newsletter automatically. Best effort: it never blocks the save
// that triggered it.
export async function autoAddContact(
  tcUserId: string,
  person: { name?: string | null; email?: string | null; phone?: string | null; role?: string | null; company?: string | null }
): Promise<void> {
  try {
    const email = (person.email || '').trim().toLowerCase();
    const name = (person.name || '').trim();
    const hasEmail = !!email && email.length <= 254 && EMAIL_RE.test(email);
    // Everyone needs an email to be saved, except an agent, who is saved by name.
    if (!hasEmail && !((person.role || '').trim() === 'Agent' && name)) return;

    if (hasEmail) {
      const { data: existing } = await supabaseServer
        .from('contacts')
        .select('id')
        .eq('tc_user_id', tcUserId)
        .ilike('email', email)
        .limit(1);
      if (existing && existing.length > 0) return;
    } else {
      const { data: sameName } = await supabaseServer
        .from('contacts')
        .select('id')
        .eq('tc_user_id', tcUserId)
        .ilike('name', name.replace(/[%_]/g, '\\$&'))
        .limit(1);
      if (sameName && sameName.length > 0) return;
    }

    const role = (person.role || '').trim().slice(0, 60);
    await supabaseServer.from('contacts').insert({
      tc_user_id: tcUserId,
      name: (person.name || '').trim().slice(0, 120),
      email: hasEmail ? email : null,
      phone: person.phone ? String(person.phone).trim().slice(0, 40) || null : null,
      company: person.company ? String(person.company).trim().slice(0, 120) || null : null,
      role: role || null,
      tags: cleanTags(categoryForRole(role) ? [categoryForRole(role)] : []),
      newsletter: false,
      source: 'deals',
    });
  } catch (error) {
    console.error('autoAddContact failed (ignored):', error);
  }
}
