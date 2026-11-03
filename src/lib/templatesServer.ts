import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from './supabase';
import { getUserFromRequest, AuthError } from './auth';
import { isFeatureOn } from './features';
import { assertNotCollaborator } from './workspaceGuard';
import { isStateCode } from './usStates';

export const TEMPLATE_BUCKET = 'transaction-documents';
export const TEMPLATE_KINDS = ['email', 'letter', 'form'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export const TEMPLATE_CATEGORIES = ['general', 'welcome', 'post_closing', 'disclosure', 'offer', 'listing', 'closing'] as const;

/** Templates belong to a coordinator or an agent with a workspace. Off (404) until the feature is released. */
export async function requireTemplatesUser(request: NextRequest) {
  const { user, isAdmin } = await getUserFromRequest(request);
  if (!isFeatureOn('templates')) throw new AuthError('Not found', 404);
  assertNotCollaborator(user);
  return { user, isAdmin };
}

export function templateError(error: unknown, what: string) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  const info = error as { code?: string } | null;
  if (info && (info.code === 'PGRST205' || info.code === '42P01' || info.code === '42703')) {
    console.error(`Error ${what} templates (database not updated):`, error);
    return NextResponse.json({ error: 'The database needs one more update before templates work. Run add-templates-automation.sql in Supabase.' }, { status: 500 });
  }
  console.error(`Error ${what} templates:`, error);
  return NextResponse.json({ error: `Failed to ${what} templates` }, { status: 500 });
}

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Only the fields that were sent, cleaned. `forCreate` requires a valid kind and name. */
export function cleanTemplateInput(body: Record<string, unknown>, forCreate: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (forCreate || body.kind !== undefined) {
    if (!TEMPLATE_KINDS.includes(body.kind as TemplateKind)) throw new AuthError('Choose email, letter or form.', 400);
    out.kind = body.kind;
  }
  if (forCreate || body.name !== undefined) {
    const name = clip(body.name, 140);
    if (!name) throw new AuthError('Give the template a name.', 400);
    out.name = name;
  }
  if (body.description !== undefined) out.description = clip(body.description, 500) || null;
  if (body.category !== undefined) {
    const c = clip(body.category, 40).toLowerCase().replace(/[^a-z0-9_]/g, '_');
    out.category = c || 'general';
  }
  if (body.states !== undefined) {
    if (!Array.isArray(body.states)) throw new AuthError('States must be a list.', 400);
    const states = [...new Set(body.states.map((s) => (typeof s === 'string' ? s.toUpperCase() : '')))];
    if (states.some((s) => !isStateCode(s))) throw new AuthError('One of the states is not a US state code.', 400);
    out.states = states;
  }
  if (body.subject !== undefined) out.subject = clip(body.subject, 200) || null;
  if (body.body !== undefined) out.body = typeof body.body === 'string' ? body.body.slice(0, 20000) : null;
  if (body.archived !== undefined) out.archived = body.archived === true;
  return out;
}

export async function loadOwnTemplate(templateId: string, ownerId: string) {
  const { data } = await supabaseServer.from('doc_templates').select('*').eq('id', templateId).maybeSingle();
  if (!data || data.owner_user_id !== ownerId) throw new AuthError('Template not found', 404);
  return data;
}
