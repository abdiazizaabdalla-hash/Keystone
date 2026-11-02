// The only database these tests may touch.
const RELAY_TEST_URL = 'https://bmuaxlcaqqifybgheqiq.supabase.co';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (url !== RELAY_TEST_URL) {
  throw new Error(
    `Refusing to run integration tests: NEXT_PUBLIC_SUPABASE_URL is "${url ?? '(not set)'}", not the relay-test project. ` +
      'Fill in .env.test with the relay-test keys.'
  );
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY.startsWith('PASTE')) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY in .env.test is missing or still a placeholder.');
}
