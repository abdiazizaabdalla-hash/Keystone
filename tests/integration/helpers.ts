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

export interface Deal {
  agentId: string;
  transactionId: string;
  taskId: string;
  documentId: string;
  messageId: string;
  marker: string;
}

/** Seeds one complete deal (agent profile, transaction, task, document row, message) owned by `owner`. */
export async function seedDeal(owner: Actor, label: string): Promise<Deal> {
  const marker = `SECRET-${label}-${randomBytes(3).toString('hex')}`;
  const { data: agent, error: agentError } = await admin
    .from('agents')
    .insert({ tc_user_id: owner.id, name: `Agent ${marker}`, email: `${marker.toLowerCase()}@example.test`, flat_fee: 0, commission_percent: 0 })
    .select('id')
    .single();
  if (agentError || !agent) throw new Error(`seed agent failed: ${agentError?.message}`);
  const { data: tx, error: txError } = await admin
    .from('transactions')
    .insert({ agent_id: agent.id, tc_user_id: owner.id, file_number: marker, property_address: `${marker} Main St`, inbound_token: randomBytes(8).toString('hex') })
    .select('id')
    .single();
  if (txError || !tx) throw new Error(`seed transaction failed: ${txError?.message}`);
  const { data: task, error: taskError } = await admin.from('tasks').insert({ transaction_id: tx.id, name: `Task ${marker}` }).select('id').single();
  if (taskError || !task) throw new Error(`seed task failed: ${taskError?.message}`);
  const { data: doc, error: docError } = await admin
    .from('documents')
    .insert({ transaction_id: tx.id, file_name: `${marker}.pdf`, storage_path: `it/${marker}.pdf`, uploaded_by: owner.id })
    .select('id')
    .single();
  if (docError || !doc) throw new Error(`seed document failed: ${docError?.message}`);
  const { data: msg, error: msgError } = await admin
    .from('messages')
    .insert({ transaction_id: tx.id, sender_id: owner.id, sender_role: 'tc', body: `Message ${marker}` })
    .select('id')
    .single();
  if (msgError || !msg) throw new Error(`seed message failed: ${msgError?.message}`);
  return { agentId: agent.id, transactionId: tx.id, taskId: task.id, documentId: doc.id, messageId: msg.id, marker };
}

/** Adds a collaborator to a deal, as accepting an invite does. */
export async function addCollaboratorToDeal(deal: Deal, collaborator: Actor, invitedBy: Actor): Promise<void> {
  const { error } = await admin
    .from('transaction_agents')
    .insert({ transaction_id: deal.transactionId, agent_user_id: collaborator.id, invited_by: invitedBy.id });
  if (error) throw new Error(`addCollaboratorToDeal failed: ${error.message}`);
}

/** Removes everything the test actors created, then the users themselves. */
export async function cleanup(): Promise<void> {
  if (created.length === 0) return;
  const { data: txs } = await admin.from('transactions').select('id').in('tc_user_id', created);
  const txIds = (txs ?? []).map((t) => t.id as string);
  if (txIds.length > 0) {
    await admin.from('messages').delete().in('transaction_id', txIds);
    await admin.from('documents').delete().in('transaction_id', txIds);
    await admin.from('tasks').delete().in('transaction_id', txIds);
    await admin.from('transaction_agents').delete().in('transaction_id', txIds);
    await admin.from('agent_invites').delete().in('transaction_id', txIds);
  }
  // Agents' own invoices (the table may not exist yet on an older test database; errors are ignored).
  await admin.from('workspace_invoices').delete().in('owner_user_id', created);
  // Templates, their rules and runs, and any uploaded form files.
  for (const id of created) {
    const { data: files } = await admin.storage.from('transaction-documents').list(`templates/${id}`);
    if (files && files.length > 0) await admin.storage.from('transaction-documents').remove(files.map((f) => `templates/${id}/${f.name}`));
  }
  await admin.from('template_pins').delete().in('owner_user_id', created);
  await admin.from('email_outbox').delete().in('owner_user_id', created);
  await admin.from('template_runs').delete().in('owner_user_id', created);
  await admin.from('template_rules').delete().in('owner_user_id', created);
  await admin.from('doc_templates').delete().in('owner_user_id', created);
  await admin.from('contacts').delete().in('tc_user_id', created);
  await admin.from('transactions').delete().in('tc_user_id', created);
  await admin.from('agents').delete().in('tc_user_id', created);
  for (const id of created) await admin.auth.admin.deleteUser(id);
  created.length = 0;
}
