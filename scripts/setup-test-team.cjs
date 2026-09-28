// One-off dev/test helper: forces a specific pair of accounts into a
// Team relationship directly in Supabase, bypassing Stripe Checkout, so
// you can test the Team roster/drill-down UI without running a real
// subscription through it. Run from the project root with your own
// terminal (not through an AI assistant's sandboxed shell, which may not
// have network access to Supabase):
//
//   node scripts/setup-test-team.cjs
//
// Safe to re-run -- it no-ops on anything already in the desired state.
// Delete this file (or just never run it) once you're done testing; it
// is not meant to ship or run in production.
const fs = require('fs');
const path = require('path');
const { createClient } = require(path.join(process.cwd(), 'node_modules/@supabase/supabase-js'));

const envPath = path.join(process.cwd(), '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  env[key] = value;
}

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing Supabase URL or service role key in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserByEmailFragment(fragment) {
  let page = 1;
  const perPage = 200;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find((u) => (u.email || '').toLowerCase().includes(fragment.toLowerCase()));
    if (match) return match;
    if (data.users.length < perPage) return null;
    page++;
  }
}

async function printAllEmails() {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) {
    console.error('(also failed to list users for debugging)', error.message);
    return;
  }
  console.error('\nAccounts that exist in this Supabase project:');
  for (const u of data.users) console.error(' -', u.email);
}

async function main() {
  const ownerFragment = 'abdiaziz.a.abdalla';
  const memberEmail = 'aabdiaziz47@gmail.com';

  const ownerUser = await findUserByEmailFragment(ownerFragment);
  if (!ownerUser) {
    console.error(`No user found with email containing "${ownerFragment}"`);
    await printAllEmails();
    process.exit(1);
  }
  console.log('Owner found:', ownerUser.email, ownerUser.id);

  const memberUser = await findUserByEmailFragment(memberEmail);
  if (!memberUser) {
    console.error(`No user found with email "${memberEmail}"`);
    await printAllEmails();
    process.exit(1);
  }
  console.log('Member found:', memberUser.email, memberUser.id);

  for (const u of [ownerUser, memberUser]) {
    const { error } = await supabase.auth.admin.updateUserById(u.id, {
      user_metadata: { ...u.user_metadata, plan: 'team' },
    });
    if (error) throw error;
    console.log(`Set plan=team for ${u.email}`);
  }

  async function getMembership(userId) {
    const { data, error } = await supabase
      .from('team_members')
      .select('team_id, role')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  let ownerMembership = await getMembership(ownerUser.id);
  let teamId;

  if (ownerMembership) {
    if (ownerMembership.role !== 'owner') {
      console.error(`${ownerUser.email} already belongs to a team as a MEMBER (team_id=${ownerMembership.team_id}). Remove that membership first if you want them to own a fresh team.`);
      process.exit(1);
    }
    teamId = ownerMembership.team_id;
    console.log(`Owner already owns team ${teamId}`);
  } else {
    const { data: team, error: teamError } = await supabase
      .from('teams')
      .insert({ owner_id: ownerUser.id })
      .select()
      .single();
    if (teamError) throw teamError;
    teamId = team.id;
    const { error: memberInsertError } = await supabase
      .from('team_members')
      .insert({ team_id: teamId, user_id: ownerUser.id, role: 'owner' });
    if (memberInsertError) throw memberInsertError;
    console.log(`Created team ${teamId} owned by ${ownerUser.email}`);
  }

  const memberMembership = await getMembership(memberUser.id);
  if (memberMembership && memberMembership.team_id !== teamId) {
    console.error(`${memberUser.email} already belongs to a DIFFERENT team (team_id=${memberMembership.team_id}). Remove that membership first.`);
    process.exit(1);
  }
  if (!memberMembership) {
    const { error: addError } = await supabase
      .from('team_members')
      .insert({ team_id: teamId, user_id: memberUser.id, role: 'member' });
    if (addError) throw addError;
    console.log(`Added ${memberUser.email} to team ${teamId} as a member`);
  } else {
    console.log(`${memberUser.email} is already a member of team ${teamId}`);
  }

  const { error: inviteCleanupError } = await supabase
    .from('team_invites')
    .delete()
    .eq('team_id', teamId)
    .ilike('email', memberEmail);
  if (inviteCleanupError) console.warn('Warning: could not clean up stale invite row:', inviteCleanupError.message);

  console.log('\nDone. Final state:');
  const { data: finalMembers } = await supabase
    .from('team_members')
    .select('user_id, role')
    .eq('team_id', teamId);
  console.log(finalMembers);
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
