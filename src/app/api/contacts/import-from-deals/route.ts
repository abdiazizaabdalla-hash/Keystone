import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isAgentUser } from '@/lib/agentPortal';
import { categoryForRole } from '@/lib/contactCategories';
import { cleanTags } from '@/lib/contactsCrm';
import { EMAIL_RE } from '@/lib/stepEmailTemplates';

// Builds the address book from what the TC has already entered: the agents they
// work with plus every person added to their deals (lender, title, buyer...).
// Safe to run again any time: it only adds people whose email isn't saved yet,
// and never touches contacts that already exist. Nobody is added to the
// newsletter automatically.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (isAgentUser(user)) return NextResponse.json({ error: 'Not available' }, { status: 403 });
    await assertTrialActive(user);

    const [{ data: existing }, { data: agents }, { data: txs }] = await Promise.all([
      supabaseServer.from('contacts').select('name, email').eq('tc_user_id', user.id).limit(5000),
      supabaseServer.from('agents').select('name, email, phone, brokerage').eq('tc_user_id', user.id),
      supabaseServer.from('transactions').select('id').eq('tc_user_id', user.id).limit(1000),
    ]);

    const have = new Set((existing || []).filter((r) => r.email).map((r) => String(r.email).toLowerCase()));
    const haveNames = new Set((existing || []).map((r) => String(r.name || '').trim().toLowerCase()).filter(Boolean));
    const toAdd = new Map<string, Record<string, unknown>>();
    const noEmail: Record<string, unknown>[] = [];

    const consider = (email: unknown, entry: Record<string, unknown>) => {
      const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
      if (!e || !EMAIL_RE.test(e) || have.has(e) || toAdd.has(e)) return;
      toAdd.set(e, { ...entry, tc_user_id: user.id, email: e, newsletter: false, source: 'deals' });
    };

    for (const a of agents || []) {
      const agentName = String(a.name || '').trim();
      const agentEmail = typeof a.email === 'string' ? a.email.trim().toLowerCase() : '';
      // An agent with no email is still someone you work with: add them by name (once), so every agent on your deals shows up.
      if ((!agentEmail || !EMAIL_RE.test(agentEmail)) && agentName) {
        const nameKey = agentName.toLowerCase();
        if (!haveNames.has(nameKey)) {
          haveNames.add(nameKey);
          noEmail.push({
            tc_user_id: user.id,
            name: agentName.slice(0, 120),
            email: null,
            phone: a.phone ? String(a.phone).slice(0, 40) : null,
            company: a.brokerage ? String(a.brokerage).slice(0, 120) : null,
            role: 'Agent',
            tags: ['Agent'],
            newsletter: false,
            source: 'deals',
          });
        }
        continue;
      }
      consider(a.email, {
        name: String(a.name || '').slice(0, 120),
        phone: a.phone ? String(a.phone).slice(0, 40) : null,
        company: a.brokerage ? String(a.brokerage).slice(0, 120) : null,
        role: 'Agent',
        tags: ['Agent'],
      });
    }

    const txIds = (txs || []).map((t) => t.id as string);
    for (let i = 0; i < txIds.length; i += 200) {
      const { data: parties } = await supabaseServer
        .from('transaction_contacts')
        .select('name, email, phone, role')
        .in('transaction_id', txIds.slice(i, i + 200));
      for (const p of parties || []) {
        const role = typeof p.role === 'string' ? p.role.trim().slice(0, 60) : '';
        consider(p.email, {
          name: String(p.name || '').slice(0, 120),
          phone: p.phone ? String(p.phone).slice(0, 40) : null,
          role: role || null,
          tags: cleanTags(categoryForRole(role) ? [categoryForRole(role)] : []),
        });
      }
    }

    const rows = [...toAdd.values(), ...noEmail];
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabaseServer.from('contacts').insert(rows.slice(i, i + 200));
      if (error) throw error;
    }
    return NextResponse.json({ added: rows.length, alreadyHad: have.size });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    console.error('Error importing contacts from deals:', error);
    return NextResponse.json({ error: 'Failed to import from your deals' }, { status: 500 });
  }
}
