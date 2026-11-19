import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// `npm run dev:prod-readonly` points a local server at the LIVE database so the admin can look at real accounts. In that mode
// every server-side request that could change anything is refused here, at the one place all server database access goes through.
// (Reads, and the password sign-in request, still work.) The flag is never set on Vercel or in dev:local.
const readOnlyProd = process.env.RELAY_PROD_READONLY === '1';
const readOnlyFetch: typeof fetch = async (input, init) => {
  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (method !== 'GET' && method !== 'HEAD' && !url.includes('/auth/v1/token')) {
    throw new Error(`Read-only mode: blocked ${method} ${new URL(url).pathname}`);
  }
  return fetch(input, init);
};
const globalOptions = readOnlyProd ? { global: { fetch: readOnlyFetch } } : {};

// Client-side (public)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server-side (service role). `persistSession`/`autoRefreshToken` are
// disabled so nothing can ever attach a real user's session to this
// singleton — every server module imports the SAME instance, so if any
// call site ever validated a user's token against it (as auth.ts used to),
// its Authorization header would silently downgrade from the service role
// key to that user's token for every later call in the process.
export const supabaseServer = createClient(supabaseUrl, serviceRoleKey, {
  ...globalOptions,
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

// For one-off auth operations that must set a session on the client
// (signInWithPassword, signUp) — NEVER reuse supabase/supabaseServer for
// these. Both are shared singletons imported by every server module; any
// call that sets a session on a shared client silently overwrites its
// Authorization header for every other concurrent/later request on that
// same instance for the rest of the process (this has already bitten this
// codebase twice — see the comment above). A fresh throwaway client per
// request has no shared state to poison.
export function createAuthClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    ...globalOptions,
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
