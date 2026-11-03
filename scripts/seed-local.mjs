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
  { label: 'Platform admin', email: 'admin@local.relay', app: { is_admin: true, plan: 'team' } },
];

const existing = {};
if (existsSync('.local-accounts.txt')) {
  for (const line of readFileSync('.local-accounts.txt', 'utf8').split('\n')) {
    const m = line.match(/^(\S+@local\.relay)\s+(\S+)/);
    if (m) existing[m[1]] = m[2];
  }
}

const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
const lines = ['# Local demo logins (relay-test database only). Not for production.', ''];
for (const a of ACCOUNTS) {
  // One easy-to-type password for every local demo account (relay-test only, never production).
  const password = process.env.LOCAL_DEMO_PASSWORD || 'LocalRelay-2026!';
  const found = list.users.find((u) => u.email === a.email);
  if (found) {
    await admin.auth.admin.updateUserById(found.id, { password, app_metadata: { ...found.app_metadata, ...a.app }, email_confirm: true });
  } else {
    const { error } = await admin.auth.admin.createUser({ email: a.email, password, email_confirm: true, app_metadata: a.app });
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
  console.log('Brokerage demo ready: broker@local.relay oversees agent-workspace@local.relay.');
}
console.log(`Wrote ${ACCOUNTS.length} accounts to .local-accounts.txt`);
