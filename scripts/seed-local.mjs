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
  { label: 'Agent to give a workspace', email: 'agent-workspace@local.relay', app: { role: 'agent', account_type: 'agent' } },
  { label: 'Brokerage owner (Team plan)', email: 'broker@local.relay', app: { plan: 'team' } },
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
console.log(`Wrote ${ACCOUNTS.length} accounts to .local-accounts.txt`);
