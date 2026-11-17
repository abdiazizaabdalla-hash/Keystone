// Creates demo accounts in the relay-test database for local development, and writes the
// logins to .local-accounts.txt (git-ignored). Safe to re-run: existing demo accounts are reused.
// Refuses to run against anything other than relay-test.
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';

nextEnv.loadEnvConfig(process.cwd(), true);
const RELAY_TEST_URL = 'https://bmuaxlcaqqifybgheqiq.supabase.co';
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== RELAY_TEST_URL) {
  console.error('Refusing to seed: not the relay-test project.');
  process.exit(1);
}
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const ACCOUNTS = [
  { label: 'Coordinator (Pro plan)', email: 'tc@local.relay', app: { plan: 'pro' } },
  { label: 'Coordinator, second (Pro plan)', email: 'tc2@local.relay', app: { plan: 'pro' } },
  { label: 'Free invited agent', email: 'agent-free@local.relay', app: { role: 'agent', account_type: 'agent' } },
  { label: 'Agent with a workspace (a member of the brokerage below)', email: 'agent-workspace@local.relay', app: { role: 'agent', account_type: 'agent', agent_workspace: true, trial_ends_at: new Date(Date.now() + 30 * 86400000).toISOString() } },
  { label: 'Brokerage owner / broker (Team plan)', email: 'broker@local.relay', app: { plan: 'team' } },
  { label: 'Coordinator (Starter plan)', email: 'tc-starter@local.relay', app: { plan: 'starter' } },
  { label: 'Agent, Starter (own workspace)', email: 'agent-starter@local.relay', app: { role: 'agent', account_type: 'agent', agent_workspace: true, plan: 'starter', trial_ends_at: new Date(Date.now() + 14 * 86400000).toISOString() } },
  { label: 'Agent, Pro (own workspace)', email: 'agent-pro@local.relay', app: { role: 'agent', account_type: 'agent', agent_workspace: true, plan: 'pro' } },
  { label: 'Brokerage Basic owner (Team plan)', email: 'broker-basic@local.relay', app: { plan: 'team' } },
  { label: 'Brokerage Pro owner (Team plan)', email: 'broker-pro@local.relay', app: { plan: 'team' } },
  { label: 'Agent on a Brokerage Basic roster', email: 'agent-in-basic@local.relay', app: { role: 'agent', account_type: 'agent' } },
  { label: 'Agent on a Brokerage Pro roster', email: 'agent-in-pro@local.relay', app: { role: 'agent', account_type: 'agent' } },
  { label: 'Platform admin', email: 'admin@local.relay', app: { is_admin: true, plan: 'team' } },
];

const existing = {};
if (existsSync('.local-accounts.txt')) {
  for (const line of readFileSync('.local-accounts.txt', 'utf8').split('\n')) {
    const m = line.match(/^(\S+@local\.relay)\s+(\S+)/);
    if (m) existing[m[1]] = m[2];
  }
}

// A real name for each demo account, so screens show a person's name instead of their email address.
const NAMES = {
  'agent-in-basic@local.relay': 'Avery Basic',
  'agent-in-pro@local.relay': 'Alex Pro',
  'agent-workspace@local.relay': 'Wendy Workspace',
  'agent-free@local.relay': 'Frankie Free',
  'agent-starter@local.relay': 'Sam Starter',
  'agent-pro@local.relay': 'Parker Pro',
};
const nameFor = (email) => NAMES[email] || email.split('@')[0].split(/[-_.]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
const lines = ['# Local demo logins (relay-test database only). Not for production.', ''];
for (const a of ACCOUNTS) {
  // One easy-to-type password for every local demo account (relay-test only, never production).
  const password = process.env.LOCAL_DEMO_PASSWORD || 'LocalRelay-2026!';
  const found = list.users.find((u) => u.email === a.email);
  if (found) {
    await admin.auth.admin.updateUserById(found.id, { password, app_metadata: { ...found.app_metadata, ...a.app }, user_metadata: { ...found.user_metadata, full_name: found.user_metadata?.full_name || nameFor(a.email) }, email_confirm: true });
  } else {
    const { error } = await admin.auth.admin.createUser({ email: a.email, password, email_confirm: true, app_metadata: a.app, user_metadata: { full_name: nameFor(a.email) } });
    if (error) throw error;
  }
  lines.push(`${a.email}  ${password}  # ${a.label}`);
}
writeFileSync('.local-accounts.txt', lines.join('\n') + '\n');

// Brokerage demo: the agent with a workspace joins the broker's brokerage and has one deal for the broker to look at.
// (Locally the link is created directly; in the app an agent has to accept an invitation first.)
const { data: after } = await admin.auth.admin.listUsers({ perPage: 1000 });
const broker = after.users.find((u) => u.email === 'broker@local.relay');
const member = after.users.find((u) => u.email === 'agent-workspace@local.relay');
if (broker && member) {
  const { data: open } = await admin.from('brokerage_links').select('id').eq('agent_user_id', member.id).eq('status', 'active').maybeSingle();
  if (!open) {
    await admin.from('brokerage_links').delete().eq('owner_user_id', broker.id).ilike('invited_email', member.email).in('status', ['pending', 'active']);
    const { error } = await admin.from('brokerage_links').insert({ owner_user_id: broker.id, agent_user_id: member.id, invited_email: member.email, status: 'active', responded_at: new Date().toISOString() });
    if (error) console.warn('Could not link the agent to the brokerage (is add-brokerage-oversight.sql run?):', error.message);
  }
  // A proposed commission on the demo deal, with a default split for the agent, so the Commission box and ledger have something to show.
  await admin.from('brokerage_links').update({ default_split_type: 'percent', default_split_value: 80 }).eq('owner_user_id', broker.id).eq('agent_user_id', member.id).eq('status', 'active').is('default_split_type', null);
  {
    const { data: demoDeal } = await admin.from('transactions').select('id').eq('tc_user_id', member.id).eq('file_number', 'DEMO-BROKERAGE-1').maybeSingle();
    if (demoDeal) {
      const { data: haveCommission } = await admin.from('deal_commissions').select('id').eq('transaction_id', demoDeal.id).maybeSingle();
      if (!haveCommission) {
        // $385,000 at 3% = $11,550 gross; agent keeps 80%, less a $395 transaction fee: agent $8,845, brokerage $2,705.
        const { error } = await admin.from('deal_commissions').insert({ transaction_id: demoDeal.id, owner_user_id: broker.id, agent_user_id: member.id, statement_number: 'COMM-0001', gross_cents: 1155000, split_type: 'percent', split_value: 80, deductions: [{ label: 'Transaction fee', amount: 395 }], agent_net_cents: 884500, brokerage_net_cents: 270500, status: 'proposed' });
        if (error) console.warn('Could not add the demo commission (is add-brokerage-oversight.sql run?):', error.message);
      }
    }
  }
  // A few messages so the new screens are not empty: a private thread between the broker and the agent, and two posts on the team board.
  const { count: threadCount } = await admin.from('brokerage_messages').select('id', { count: 'exact', head: true }).eq('owner_user_id', broker.id).eq('agent_user_id', member.id);
  if (!threadCount) {
    const t = Date.now();
    await admin.from('brokerage_messages').insert([
      { owner_user_id: broker.id, agent_user_id: member.id, sender_id: broker.id, body: 'Welcome to the brokerage. Can you send me the Live Oak Dr contract when it is fully signed?', created_at: new Date(t - 3 * 3600000).toISOString(), read_at: new Date(t - 2 * 3600000).toISOString() },
      { owner_user_id: broker.id, agent_user_id: member.id, sender_id: member.id, body: 'Will do. Option period ends Friday, inspection is booked for Thursday morning.', created_at: new Date(t - 2 * 3600000).toISOString() },
    ]);
  }
  let { data: brokerTeam } = await admin.from('teams').select('id').eq('owner_id', broker.id).maybeSingle();
  if (!brokerTeam) {
    const created = await admin.from('teams').insert({ owner_id: broker.id }).select('id').single();
    brokerTeam = created.data;
    if (brokerTeam) await admin.from('team_members').insert({ team_id: brokerTeam.id, user_id: broker.id, role: 'owner' });
  }
  if (brokerTeam) {
    const { count: posts } = await admin.from('team_messages').select('id', { count: 'exact', head: true }).eq('team_id', brokerTeam.id).is('recipient_id', null);
    if (!posts) {
      const t = Date.now();
      await admin.from('team_messages').insert([
        { team_id: brokerTeam.id, sender_id: broker.id, recipient_id: null, body: 'Reminder: month-end production numbers are due Friday.', created_at: new Date(t - 26 * 3600000).toISOString() },
        { team_id: brokerTeam.id, sender_id: broker.id, recipient_id: null, body: 'New IABS is in the Templates tab. Please use it on every new listing and buyer agreement.', created_at: new Date(t - 5 * 3600000).toISOString() },
      ]);
    }
  }
  const { data: deal } = await admin.from('transactions').select('id').eq('tc_user_id', member.id).eq('file_number', 'DEMO-BROKERAGE-1').maybeSingle();
  if (!deal) {
    const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    const { data: agentRow } = await admin.from('agents').insert({ tc_user_id: member.id, name: 'Demo Seller', email: 'demo-seller@example.test', flat_fee: 0, commission_percent: 0 }).select('id').single();
    const { data: tx } = await admin
      .from('transactions')
      .insert({ agent_id: agentRow.id, tc_user_id: member.id, file_number: 'DEMO-BROKERAGE-1', property_address: '412 Live Oak Dr, Austin, TX 78704', property_state: 'TX', purchase_price: 385000, status: 'Contract & File Setup', acceptance_date: day(-5), closing_date: day(25), inbound_token: Math.random().toString(16).slice(2, 14) })
      .select('id')
      .single();
    if (tx) {
      const steps = [['Earnest money received', day(-2), false], ['Option fee delivered', day(-1), true], ['Order title commitment', day(3), false], ['Schedule inspection', day(6), false]];
      await admin.from('tasks').insert(steps.map(([name, due, done], i) => ({ transaction_id: tx.id, name, due_date: due, completed: done, sort_order: i })));
    }
  }
  // The broker's IABS, shared with the brokerage (a one-page placeholder PDF, so there is a real file to open).
  const iabsName = 'Brokerage IABS (Information About Brokerage Services)';
  const { data: haveIabs } = await admin.from('doc_templates').select('id').eq('owner_user_id', broker.id).eq('name', iabsName).maybeSingle();
  if (!haveIabs) {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 78>>stream\nBT /F1 18 Tf 72 700 Td (Demo brokerage IABS - replace with your own form) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
    const path = `templates/${broker.id}/demo-brokerage-iabs.pdf`;
    await admin.storage.from('transaction-documents').upload(path, pdf, { contentType: 'application/pdf', upsert: true });
    const { error } = await admin.from('doc_templates').insert({ owner_user_id: broker.id, kind: 'form', name: iabsName, description: 'Our brokerage’s IABS. Give it to every client at first contact.', category: 'disclosure', states: [], file_name: 'demo-brokerage-iabs.pdf', storage_path: path, content_type: 'application/pdf', file_size: pdf.length, brokerage_shared: true });
    if (error) console.warn('Could not add the demo IABS (is add-brokerage-oversight.sql run?):', error.message);
  }
  console.log('Brokerage demo ready: broker@local.relay oversees agent-workspace@local.relay.');
}
// Two separate brokerages for testing the tiers: one on Brokerage Basic, one on Brokerage Pro. Each has one agent on its roster.
// Brokerage Pro agents work on Agent Pro; Brokerage Basic agents work on Agent Basic.
{
  const { data: all } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const find = (e) => all.users.find((u) => u.email === e);
  const today = new Date().toISOString().slice(0, 10);
  for (const [ownerEmail, agentEmail, tier] of [['broker-basic@local.relay', 'agent-in-basic@local.relay', 'basic'], ['broker-pro@local.relay', 'agent-in-pro@local.relay', 'pro']]) {
    const owner = find(ownerEmail);
    const agent = find(agentEmail);
    if (!owner || !agent) continue;
    const { error: accErr } = await admin.from('brokerage_accounts').upsert({ owner_user_id: owner.id, tier, status: 'converted', extra_seats: 0, converted_on: today }, { onConflict: 'owner_user_id' });
    if (accErr) console.warn(`Could not create the ${tier} brokerage account (is add-brokerage-accounts.sql run?):`, accErr.message);
    const { data: open } = await admin.from('brokerage_links').select('id').eq('agent_user_id', agent.id).eq('status', 'active').maybeSingle();
    if (!open) {
      const { error } = await admin.from('brokerage_links').insert({ owner_user_id: owner.id, agent_user_id: agent.id, invited_email: agent.email, status: 'active', responded_at: new Date().toISOString() });
      if (error) console.warn(`Could not link the ${tier} brokerage agent:`, error.message);
    }
    const { data: team } = await admin.from('teams').select('id').eq('owner_id', owner.id).maybeSingle();
    if (!team) {
      const created = await admin.from('teams').insert({ owner_id: owner.id }).select('id').single();
      if (created.data) await admin.from('team_members').insert({ team_id: created.data.id, user_id: owner.id, role: 'owner' });
    }
  }
  console.log('Brokerage tiers ready: broker-basic@local.relay (Basic) and broker-pro@local.relay (Pro).');
}
// A listing fee a coordinator has invoiced, so the free invited agent has one on their Invoices page and on the listing.
{
  const tcUser = after.users.find((u) => u.email === 'tc@local.relay');
  const free = after.users.find((u) => u.email === 'agent-free@local.relay');
  if (tcUser && free) {
    let { data: row } = await admin.from('agents').select('id').eq('tc_user_id', tcUser.id).ilike('email', free.email).maybeSingle();
    if (!row) {
      const ins = await admin.from('agents').insert({ tc_user_id: tcUser.id, name: 'Free Demo Agent', email: free.email, flat_fee: 395, commission_percent: 0, listing_fee: 250 }).select('id').single();
      row = ins.data;
    }
    if (row) {
      let { data: listing } = await admin.from('listings').select('id').eq('tc_user_id', tcUser.id).eq('property_address', '88 Listing Fee Ln, Austin, TX 78702').maybeSingle();
      if (!listing) {
        const ins = await admin.from('listings').insert({ tc_user_id: tcUser.id, agent_id: row.id, property_address: '88 Listing Fee Ln, Austin, TX 78702', list_price: 450000, share_with_agent: true }).select('id').single();
        listing = ins.data;
      }
      if (listing) {
        const { data: have } = await admin.from('invoices').select('id').eq('listing_id', listing.id).eq('agent_id', row.id).maybeSingle();
        if (!have) {
          const now = new Date();
          const { error } = await admin.from('invoices').insert({ agent_id: row.id, transaction_id: null, kind: 'listing', listing_id: listing.id, amount_owed: 250, invoice_number: `DEMO-LIST-${now.getTime().toString().slice(-6)}`, invoice_date: now.toISOString(), due_date: new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10), paid: false, flat_fee: 250, percent_fee: 0 });
          if (error) console.warn('Could not add the demo listing invoice (is add-listing-invoices.sql run?):', error.message);
        }
        console.log('Listing fee demo ready: log in as agent-free@local.relay at /agent/login to see the invoice.');
      }
    }
  }
}
console.log(`Wrote ${ACCOUNTS.length} accounts to .local-accounts.txt`);
