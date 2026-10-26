import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isAgentUser } from '@/lib/agentPortal';
import { cleanContactInput, cleanTags } from '@/lib/contactsCrm';
import { CONTACT_CATEGORIES, tidyTags } from '@/lib/contactCategories';

const MAX_CONTACTS = 5000;
const MAX_PER_REQUEST = 1000;

// A company name is a decent hint at what a contact does when the CSV has no role or tags column.
const COMPANY_HINTS: [string, RegExp][] = [
  ['Title', /\btitle\b|escrow/i],
  ['Lender', /mortgage|lending|\bloans?\b|\bbank\b|credit union/i],
  ['Inspector', /inspect/i],
  ['Insurance', /insur/i],
  ['Attorney', /\blaw\b|attorney|legal/i],
  ['Agent', /realty|real estate|properties|\bhomes?\b|re\/max|remax|keller|compass|century 21|coldwell|exp realty/i],
];

const CATEGORY_KEYS = new Set(CONTACT_CATEGORIES.map((c) => c.toLowerCase()));

// Tags for one imported contact: whatever the CSV listed, plus the broad category worked out from the role
// (Agent, Lender, Title...) or, with no role, from the company name.
function autoTags(role: string | null | undefined, company: string | null | undefined, tags: string[]): string[] {
  let out = tidyTags(role, tags);
  if (!out.some((t) => CATEGORY_KEYS.has(t.toLowerCase()))) {
    const hint = COMPANY_HINTS.find(([, re]) => re.test(company || ''));
    if (hint) out = [...out, hint[0]];
  }
  return cleanTags(out);
}

// Adds contacts from a CSV the browser already read (rows of name/email/phone/company/role/tags).
// Duplicates (same email) are skipped, existing contacts are never changed, and nobody is
// subscribed to the newsletter by an import. Tags come from the CSV and are filled in automatically
// from each contact's role or company. The ids of what was added are returned so the import can be
// undone for a couple of minutes (see ./undo/route.ts).
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
    let autoTagged = 0;
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
      const tags = autoTags(cleaned.value.role, cleaned.value.company, cleaned.value.tags || []);
      if (tags.length > (cleaned.value.tags || []).length) autoTagged += 1;
      toAdd.push({ ...cleaned.value, tags, tc_user_id: user.id, source: 'import' });
    }

    const ids: string[] = [];
    for (let i = 0; i < toAdd.length; i += 200) {
      const { data, error } = await supabaseServer.from('contacts').insert(toAdd.slice(i, i + 200)).select('id');
      if (error) throw error;
      for (const r of data || []) ids.push(r.id as string);
    }
    return NextResponse.json({ added: toAdd.length, ids, autoTagged, skippedDuplicate, skippedInvalid });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    console.error('Error importing contacts CSV:', error);
    return NextResponse.json({ error: 'Failed to import contacts' }, { status: 500 });
  }
}
