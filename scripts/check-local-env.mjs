// Runs before `npm run dev:local`. Refuses to start the dev server unless it is pointed at the
// relay-test database, and shows which unreleased features are on. This stops a local session
// from ever touching production data, production Stripe, or real customer email.
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd(), true);

const RELAY_TEST_URL = 'https://bmuaxlcaqqifybgheqiq.supabase.co';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const problems = [];

if (url !== RELAY_TEST_URL) problems.push(`NEXT_PUBLIC_SUPABASE_URL is "${url ?? '(not set)'}", not the relay-test project.`);
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) problems.push('SUPABASE_SERVICE_ROLE_KEY is missing.');
if ((process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live')) problems.push('A live Stripe key is loaded. Local development must not use one.');
if ((process.env.RESEND_API_KEY || '').startsWith('re_') && !process.env.RESEND_API_KEY.startsWith('re_local')) {
  problems.push('A real Resend key is loaded. Local development must not send real email.');
}

if (problems.length) {
  console.error('\nNot starting the local server:\n - ' + problems.join('\n - ') + '\n');
  console.error('Fix .env.development.local (it overrides .env.local) and try again.\n');
  process.exit(1);
}
console.log('Local dev: database = relay-test, Stripe and email disabled.');
console.log('Unreleased features on:', process.env.RELAY_FEATURES || '(none)');
