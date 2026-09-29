import { supabaseServer } from './supabase';

/**
 * Atomic fixed-window rate limiter backed by Postgres (see
 * add-rate-limits.sql for the table + check_rate_limit() function this
 * calls). Works correctly across Vercel's serverless invocations --
 * state lives in the database, not in any one function instance's
 * memory, which is the failure mode of a naive in-memory counter here.
 *
 * Returns true if the call should be ALLOWED, false if it should be
 * rejected with a 429. Fails OPEN (returns true) if the check itself
 * errors -- a transient Supabase hiccup should degrade to "no rate
 * limiting" rather than locking every real user out of signing in.
 */
export async function checkRateLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  try {
    const { data, error } = await supabaseServer.rpc('check_rate_limit', {
      p_key: key,
      p_max: max,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;
    return data === true;
  } catch (err) {
    console.error('Rate limit check failed (allowing request):', err);
    return true;
  }
}
