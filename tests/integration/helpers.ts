import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

export interface Actor {
  id: string;
  email: string;
  token: string;
}

const created: string[] = [];

/** Creates a confirmed user in relay-test and signs them in. `appMetadata` is server-only metadata (plan, role...). */
export async function createActor(label: string, appMetadata: Record<string, unknown> = {}): Promise<Actor> {
  const email = `it-${label}-${randomBytes(4).toString('hex')}@example.test`;
  const password = randomBytes(12).toString('hex') + 'Aa1!';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: appMetadata });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  created.push(data.user.id);
  const { data: session, error: signInError } = await anon.auth.signInWithPassword({ email, password });
  if (signInError || !session.session) throw new Error(`signIn failed: ${signInError?.message}`);
  return { id: data.user.id, email, token: session.session.access_token };
}

/** A free invited agent: an agent portal login, not a workspace owner. */
export const createCollaborator = (label: string) => createActor(label, { role: 'agent' });

type Handler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

export async function call(
  handler: Handler,
  actor: Actor | null,
  opts: { method: string; path: string; body?: unknown; params?: Record<string, string> }
): Promise<{ status: number; json: Record<string, unknown> | unknown[] | null }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (actor) headers.authorization = `Bearer ${actor.token}`;
  const request = new NextRequest(`http://localhost${opts.path}`, {
    method: opts.method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const response = await handler(request, { params: Promise.resolve(opts.params ?? {}) });
  const text = await response.text();
  let json: Record<string, unknown> | unknown[] | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

/** Removes everything the test actors created, then the users themselves. */
export async function cleanup(): Promise<void> {
  if (created.length === 0) return;
  await admin.from('transactions').delete().in('tc_user_id', created);
  await admin.from('agents').delete().in('tc_user_id', created);
  for (const id of created) await admin.auth.admin.deleteUser(id);
  created.length = 0;
}
