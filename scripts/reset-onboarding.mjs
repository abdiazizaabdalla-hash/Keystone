// Resets a local demo account so it goes through onboarding again. relay-test only.
// Usage: node scripts/reset-onboarding.mjs broker-basic@local.relay
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';

nextEnv.loadEnvConfig(process.cwd(), true);
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://bmuaxlcaqqifybgheqiq.supabase.co') {
  console.error('Refusing to run: not the relay-test project.');
  process.exit(1);
}
const email = process.argv[2];
if (!email || !email.endsWith('@local.relay')) { console.error('Give a @local.relay email.'); process.exit(1); }
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
const user = data.users.find((u) => u.email === email);
if (!user) { console.error('No such account.'); process.exit(1); }
const meta = { ...(user.user_metadata ?? {}) };
for (const k of ['onboarding_completed', 'first_run_guide_done', 'first_run_listing_guide_done', 'seen_hints', 'payment_preference', 'due_date_workflow_enabled', 'due_date_workflow_steps']) delete meta[k];
await admin.auth.admin.updateUserById(user.id, { user_metadata: meta });
await admin.from('teams').update({ name: null }).eq('owner_id', user.id);
await admin.from('brokerage_file_requirements').delete().eq('owner_user_id', user.id);
await admin.from('brokerage_required_steps').delete().eq('owner_user_id', user.id);
await admin.from('brokerage_automations').delete().eq('owner_user_id', user.id);
await admin.from('brokerage_links').delete().eq('owner_user_id', user.id);
console.log(`Reset ${email}: onboarding will start again at /onboarding.`);
