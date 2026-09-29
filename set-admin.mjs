// One-time admin audit + fix: ensures abdiaziz.a.abdalla@gmail.com is the
// ONLY account with is_admin: true in user_metadata, and revokes it from
// anyone else who has it.
//
// Run from the project root (needs .env.local for
// NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, both already
// there):
//   node set-admin.mjs
//
// Safe to run more than once -- it's idempotent. Delete this file once
// you've confirmed the output looks right; it's a one-off operational
// script, not something the app needs at runtime.

import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const ADMIN_EMAIL = 'abdiaziz.a.abdalla@gmail.com';

const envText = fs.readFileSync('.env.local', 'utf8');
function envVar(name) {
  const m = envText.match(new RegExp(`^${name}=(.*)$`, 'm'));
  return m ? m[1].trim() : undefined;
}

const url = envVar('NEXT_PUBLIC_SUPABASE_URL');
const serviceKey = envVar('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(url, serviceKey);

async function listAllUsers() {
  const users = [];
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 200) break;
    page++;
  }
  return users;
}

const users = await listAllUsers();
console.log(`Found ${users.length} total account(s).\n`);

const currentAdmins = users.filter((u) => u.user_metadata?.is_admin === true);
if (currentAdmins.length === 0) {
  console.log('No account currently has is_admin: true.');
} else {
  console.log('Currently admin:');
  for (const u of currentAdmins) console.log(`  - ${u.email} (${u.id})`);
}

const target = users.find((u) => u.email === ADMIN_EMAIL);
if (!target) {
  console.error(`\n${ADMIN_EMAIL} was not found among accounts -- aborting, nothing changed.`);
  process.exit(1);
}

console.log('');
if (target.user_metadata?.is_admin === true) {
  console.log(`${ADMIN_EMAIL} already has is_admin: true -- no change needed.`);
} else {
  console.log(`Granting admin to ${ADMIN_EMAIL}...`);
  const { error } = await supabase.auth.admin.updateUserById(target.id, {
    user_metadata: { ...target.user_metadata, is_admin: true },
  });
  if (error) throw error;
  console.log('  Done.');
}

const toRevoke = currentAdmins.filter((u) => u.email !== ADMIN_EMAIL);
if (toRevoke.length === 0) {
  console.log('\nNo other account has admin access. Nothing to revoke.');
} else {
  console.log(`\nRevoking admin from ${toRevoke.length} other account(s)...`);
  for (const u of toRevoke) {
    const meta = { ...u.user_metadata };
    delete meta.is_admin;
    const { error } = await supabase.auth.admin.updateUserById(u.id, { user_metadata: meta });
    if (error) {
      console.error(`  FAILED for ${u.email}: ${error.message}`);
    } else {
      console.log(`  Revoked admin from ${u.email}`);
    }
  }
}

console.log('\nFinal state:');
const finalUsers = await listAllUsers();
const finalAdmins = finalUsers.filter((u) => u.user_metadata?.is_admin === true);
if (finalAdmins.length === 0) {
  console.log('  (no admin accounts -- something is wrong, re-check)');
} else {
  for (const u of finalAdmins) console.log(`  ADMIN: ${u.email}`);
}
