// Runs before `npm run dev:local`. Relay has ONE database (the live one, from .env.local), so a local session
// reads and writes real data. This refuses to start unless it is pointed at that database and every outside
// service that could charge a card, email a customer or spend AI credit is switched off.
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd(), true);

const LIVE_URL = 'https://vjfttwkiaqrfaygrrrzf.supabase.co';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const problems = [];

if (url !== LIVE_URL) problems.push(`NEXT_PUBLIC_SUPABASE_URL is "${url ?? '(not set)'}", not the Relay database. Check .env.local, and remove any Supabase lines from .env.development.local.`);
if (process.env.RELAY_AUTO_CONFIRM_SIGNUP) problems.push('RELAY_AUTO_CONFIRM_SIGNUP is set. It would create pre-confirmed accounts in the live database.');
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) problems.push('SUPABASE_SERVICE_ROLE_KEY is missing.');
if ((process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live')) problems.push('A live Stripe key is loaded. Local development must not use one.');
if ((process.env.RESEND_API_KEY || '').startsWith('re_') && !process.env.RESEND_API_KEY.startsWith('re_local')) {
  problems.push('A real Resend key is loaded. Local development must not send real email.');
}

if (problems.length) {
  console.error('\nNot starting the local server:\n - ' + problems.join('\n - ') + '\n');
  console.error('Fix .env.local / .env.development.local (the second overrides the first) and try again.\n');
  process.exit(1);
}
console.log('Local dev: database = LIVE (real data, take care), Stripe and email disabled.');
console.log('Unreleased features on:', process.env.RELAY_FEATURES || '(none)');
