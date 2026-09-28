import { NextRequest } from 'next/server';
import { supabase } from './supabase';

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export async function getUserFromRequest(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthError('Missing or invalid authorization token', 401);
  }

  const token = authHeader.substring(7);
  // IMPORTANT: validate the caller's token with the anon-key client, never
  // with `supabaseServer` (the service-role client). Calling
  // `.auth.getUser(token)` on a shared client instance updates that
  // client's internal session state, which then leaks into the
  // Authorization header of every later request made on that same
  // instance — including Storage uploads — silently downgrading them from
  // service-role to the logged-in user's own token. Keeping
  // `supabaseServer` untouched by any end-user token is what keeps it
  // reliably privileged for the rest of the request.
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    throw new AuthError('Unauthorized', 401);
  }

  const isAdmin = user.user_metadata?.is_admin === true;

  return { user, isAdmin };
}
