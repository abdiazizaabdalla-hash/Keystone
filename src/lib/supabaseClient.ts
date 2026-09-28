import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Browser-safe client only (anon key). Does NOT import src/lib/supabase.ts,
// because that module also eagerly constructs a service-role client at
// import time, which throws ("supabaseKey is required") the moment it's
// pulled into a client bundle where the service role key is undefined.
export const supabaseBrowser = createClient(supabaseUrl, supabaseAnonKey);
