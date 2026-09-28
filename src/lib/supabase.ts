import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Client-side (public)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server-side (service role). `persistSession`/`autoRefreshToken` are
// disabled so nothing can ever attach a real user's session to this
// singleton — every server module imports the SAME instance, so if any
// call site ever validated a user's token against it (as auth.ts used to),
// its Authorization header would silently downgrade from the service role
// key to that user's token for every later call in the process.
export const supabaseServer = createClient(supabaseUrl, serviceRoleKey, {
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
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
