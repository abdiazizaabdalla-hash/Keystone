// One-off dev/test helper: forces a specific account onto the Brokerage
// plan as the owner of its own team, directly in Supabase, bypassing
// Stripe Checkout entirely -- so you can test the Brokerage admin
// dashboard/roster/workspace-defaults work without running a real
// subscription through it. Run from the project root with your own
// terminal (not through an AI assistant's sandboxed shell, which has no
// network access to Supabase):
//
//   node scripts/set-brokerage-admin.cjs
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

const TARGET_EMAIL = 'relaytesting4@proton.me';

async function findUserByEmail(email) {
  let page = 1;
  const perPage = 200;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < perPage) return null;
    page++;
  }
}

async function main() {
  const user = await findUserByEmail(TARGET_EMAIL);
  if (!user) {
    console.error(`No user found with email "${TARGET_EMAIL}"`);
    process.exit(1);
  }
  console.log('Found:', user.email, user.id);

  // If this account already owns or belongs to a team, don't silently
  // move it to a different one -- bail with the existing state instead,
  // same guardrail as setup-test-team.cjs.
  const { data: existingMembership, error: membershipError } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (membershipError) throw membershipError;

  if (existingMembership && existingMembership.role !== 'owner') {
    console.error(
      `${user.email} already belongs to a team as a MEMBER (team_id=${existingMembership.team_id}). Remove that membership first if you want them to own a fresh Brokerage team.`
    );
    process.exit(1);
  }

  // Fresh read-then-write of user_metadata -- same race-safety pattern as
  // lib/userMetadata.ts's mergeUserMetadata, just inlined here since this
  // script can't import the app's own TS modules directly.
  const { data: freshUser, error: getUserError } = await supabase.auth.admin.getUserById(user.id);
  if (getUserError) throw getUserError;

  const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
    user_metadata: { ...freshUser.user.user_metadata, plan: 'brokerage' },
  });
  if (updateError) throw updateError;
  console.log(`Set plan=brokerage for ${user.email}`);

  let teamId;
  if (existingMembership) {
    teamId = existingMembership.team_id;
    console.log(`Already owns team ${teamId}`);
  } else {
    const { data: team, error: teamError } = await supabase
      .from('teams')
      .insert({ owner_id: user.id })
      .select()
      .single();
    if (teamError) throw teamError;
    teamId = team.id;

    const { error: memberInsertError } = await supabase
      .from('team_members')
      .insert({ team_id: teamId, user_id: user.id, role: 'owner' });
    if (memberInsertError) throw memberInsertError;
    console.log(`Created team ${teamId} owned by ${user.email}`);
  }

  console.log('\nDone. Final state:');
  const { data: finalTeam } = await supabase.from('teams').select('*').eq('id', teamId).single();
  console.log(finalTeam);
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
