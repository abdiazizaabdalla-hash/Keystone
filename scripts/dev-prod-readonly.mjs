// Runs a LOCAL server (http://localhost:3001) against the LIVE database, for LOOKING only (e.g. the admin Activity tab).
//
//  - Reads the live Supabase URL/keys from .env.local (the file dev:local deliberately ignores).
//  - RELAY_PROD_READONLY=1 makes src/lib/supabase.ts refuse every server-side request that could change data.
//  - Stripe, email and AI keys are blanked, so nothing can be charged or sent.
//  - Sign in with your real admin login. Normal dev:local (relay-test, port 3000) is untouched and can run at the same time.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const RELAY_TEST_URL = 'https://bmuaxlcaqqifybgheqiq.supabase.co';
const parse = (file) => {
  const out = {};
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
  return out;
};

const live = parse('.env.local');
const dev = parse('.env.development.local');
const problems = [];
if (!live.NEXT_PUBLIC_SUPABASE_URL || !live.SUPABASE_SERVICE_ROLE_KEY || !live.NEXT_PUBLIC_SUPABASE_ANON_KEY) problems.push('.env.local needs the live NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.');
if (live.NEXT_PUBLIC_SUPABASE_URL === RELAY_TEST_URL) problems.push('.env.local points at relay-test, not the live database. Use `npm run dev:local` for that.');
if (problems.length) {
  console.error('\nNot starting:\n - ' + problems.join('\n - ') + '\n');
  process.exit(1);
}

console.log('\n==============================================================');
console.log(' LIVE DATABASE, READ-ONLY  ->  http://localhost:3001');
console.log(' Every write is blocked. Stripe, email and AI are switched off.');
console.log(' Sign in with your real admin account. Ctrl+C to stop.');
console.log('==============================================================\n');

const child = spawn('npx', ['next', 'dev', '-p', '3001'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: live.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: live.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: live.SUPABASE_SERVICE_ROLE_KEY,
    RELAY_PROD_READONLY: '1',
    NEXT_DIST_DIR: '.next-prod-readonly',
    // Same unreleased features as dev:local so the pages look like what you are building.
    RELAY_FEATURES: dev.RELAY_FEATURES || '',
    NEXT_PUBLIC_RELAY_FEATURES: dev.NEXT_PUBLIC_RELAY_FEATURES || '',
    // Nothing that can charge, email or call an outside service.
    STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
    STRIPE_CONNECT_WEBHOOK_SECRET: '',
    RESEND_API_KEY: '',
    RESEND_WEBHOOK_SECRET: '',
    ANTHROPIC_API_KEY: '',
    CRON_SECRET: '',
    RELAY_OUTBOX_ONLY: '1',
    RELAY_AUTO_CONFIRM_SIGNUP: '',
  },
});
child.on('exit', (code) => process.exit(code ?? 0));
