// One-time migration: moves the security-relevant account fields (plan,
// is_admin, agent role) from Supabase Auth `user_metadata` -- which every
// signed-in user can edit themselves -- into `app_metadata`, which only the
// service-role key can write. The app now reads these from app_metadata
// only (src/lib/privileged.ts).
//
// Run from the project root (needs .env.local with
// NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY):
//
//   node scripts/migrate-privileged-metadata.mjs            # dry run: prints what it WOULD do
//   node scripts/migrate-privileged-metadata.mjs --apply    # copy into app_metadata
//   node scripts/migrate-privileged-metadata.mjs --scrub    # AFTER the new code is deployed:
//                                                           # delete plan/is_admin/role from user_metadata
//
// Order: run --apply BEFORE deploying the new code (old code keeps working
// because user_metadata is untouched), deploy, then run --scrub.
//
// Safe to re-run. Never prints keys or tokens.
//
// Admin is NOT copied from user_metadata (a user could have set that flag
// on themselves). Only ADMIN_EMAIL is granted admin; any other account that
// claims is_admin is listed so you can see it.

import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const ADMIN_EMAIL = 'abdiaziz.a.abdalla@gmail.com';
const VALID_PLANS = ['starter', 'pro', 'team', 'brokerage'];
const apply = process.argv.includes('--apply');
const scrub = process.argv.includes('--scrub');

const envText = fs.readFileSync('.env.local', 'utf8');
const envVar = (name) => {
  const m = envText.match(new RegExp(`^${name}=(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined;
};
const url = envVar('NEXT_PUBLIC_SUPABASE_URL');
const serviceKey = envVar('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const users = [];
for (let page = 1; ; page++) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  users.push(...data.users);
  if (data.users.length < 200) break;
}

const { data: stripeRows } = await supabase.from('stripe_customers').select('user_id, plan, subscription_status');
const stripeByUser = new Map((stripeRows || []).map((r) => [r.user_id, r]));

console.log(`${users.length} account(s). Mode: ${scrub ? 'SCRUB user_metadata' : apply ? 'APPLY' : 'DRY RUN'}\n`);

for (const u of users) {
  const um = u.user_metadata || {};
  const am = u.app_metadata || {};

  if (scrub) {
    const had = ['plan', 'is_admin', 'role'].filter((k) => k in um);
    if (had.length === 0) continue;
    console.log(`${u.email}: removing ${had.join(', ')} from user_metadata`);
    const cleaned = { ...um };
    for (const k of had) delete cleaned[k];
    const { error } = await supabase.auth.admin.updateUserById(u.id, { user_metadata: cleaned });
    if (error) throw error;
    continue;
  }

  const changes = {};
  if (typeof um.plan === 'string' && VALID_PLANS.includes(um.plan) && am.plan !== um.plan) changes.plan = um.plan;
  if (um.role === 'agent' && am.role !== 'agent') changes.role = 'agent';
  if (u.email === ADMIN_EMAIL && am.is_admin !== true) changes.is_admin = true;

  const stripe = stripeByUser.get(u.id);
  const note = [];
  if (um.is_admin === true && u.email !== ADMIN_EMAIL) note.push('CLAIMS is_admin in user_metadata (NOT copied)');
  if ((changes.plan || am.plan) && (changes.plan || am.plan) !== 'starter' && !stripe) note.push('non-starter plan with no stripe_customers row (team member or comped?)');
  if (stripe && stripe.plan && (changes.plan || am.plan || 'starter') !== stripe.plan) note.push(`stripe row says ${stripe.plan}`);

  if (Object.keys(changes).length === 0 && note.length === 0) continue;
  console.log(`${u.email}: ${Object.keys(changes).length ? 'set app_metadata ' + JSON.stringify(changes) : 'no change'}${note.length ? '   <-- ' + note.join('; ') : ''}`);

  if (apply && Object.keys(changes).length) {
    const { error } = await supabase.auth.admin.updateUserById(u.id, { app_metadata: { ...am, ...changes } });
    if (error) throw error;
  }
}
console.log(scrub ? '\nScrub done.' : apply ? '\nApplied.' : '\nDry run only -- nothing was changed. Re-run with --apply.');
