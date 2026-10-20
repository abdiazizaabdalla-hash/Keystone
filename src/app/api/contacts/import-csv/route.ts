import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isAgentUser } from '@/lib/agentPortal';
import { cleanContactInput } from '@/lib/contactsCrm';

const MAX_CONTACTS = 5000;
const MAX_PER_REQUEST = 1000;

// Adds contacts from a CSV the browser already read (rows of name/email/phone/company/role/tags).
// Duplicates (same email) are skipped, existing contacts are never changed, and nobody is
// subscribed to the newsletter by an import.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (isAgentUser(user)) return NextResponse.json({ error: 'Not available' }, { status: 403 });
    await assertTrialActive(user);

    const body = await request.json().catch(() => ({}));
    const rows: unknown[] = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) return NextResponse.json({ error: 'No rows to import' }, { status: 400 });
    if (rows.length > MAX_PER_REQUEST) {
      return NextResponse.json({ error: `Import up to ${MAX_PER_REQUEST} contacts at a time` }, { status: 400 });
    }

    const { data: existing } = await supabaseServer.from('contacts').select('email').eq('tc_user_id', user.id).limit(MAX_CONTACTS);
    const have = new Set((existing || []).map((r) => String(r.email || '').toLowerCase()).filter(Boolean));
    if ((existing || []).length >= MAX_CONTACTS) {
      return NextResponse.json({ error: `You have reached the ${MAX_CONTACTS} contact limit` }, { status: 400 });
    }

    const toAdd: Record<string, unknown>[] = [];
    let skippedDuplicate = 0;
    let skippedInvalid = 0;
    for (const r of rows) {
      if (!r || typeof r !== 'object') {
        skippedInvalid += 1;
        continue;
      }
      const cleaned = cleanContactInput({ ...(r as Record<string, unknown>), newsletter: false });
      if (!cleaned.ok) {
        skippedInvalid += 1;
        continue;
      }
      const email = cleaned.value.email;
      if (email) {
        if (have.has(email)) {
          skippedDuplicate += 1;
          continue;
        }
        have.add(email);
      }
      toAdd.push({ ...cleaned.value, tc_user_id: user.id, source: 'import' });
    }

    for (let i = 0; i < toAdd.length; i += 200) {
      const { error } = await supabaseServer.from('contacts').insert(toAdd.slice(i, i + 200));
      if (error) throw error;
    }
    return NextResponse.json({ added: toAdd.length, skippedDuplicate, skippedInvalid });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    console.error('Error importing contacts CSV:', error);
    return NextResponse.json({ error: 'Failed to import contacts' }, { status: 500 });
  }
}
