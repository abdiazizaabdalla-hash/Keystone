import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from './supabase';
import { getUserFromRequest, AuthError } from './auth';
import { isFeatureOn } from './features';
import { assertNotCollaborator } from './workspaceGuard';
import { isStateCode } from './usStates';
import { CONTACT_CATEGORIES } from './contactCategories';
import { brokerageOwnersFor } from './oversight';
import { assertAgentHas } from './agentGates';
import { isValidCategory, isValidDocumentType, resolveDocumentPlacement } from './documentTaxonomy';
import type { AgentFeature } from './tiers';

export const TEMPLATE_BUCKET = 'transaction-documents';
export const TEMPLATE_KINDS = ['email', 'letter', 'form'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export const TEMPLATE_CATEGORIES = ['general', 'welcome', 'post_closing', 'disclosure', 'offer', 'listing', 'closing'] as const;

/** Templates belong to a coordinator or an agent with a workspace. Off (404) until the feature is released. */
export async function requireTemplatesUser(request: NextRequest, needs?: AgentFeature) {
  const { user, isAdmin } = await getUserFromRequest(request);
  if (!isFeatureOn('templates')) throw new AuthError('Not found', 404);
  assertNotCollaborator(user);
  // Saving templates and building rules is not part of a brokerage-provided workspace (Agent Basic); using them is.
  if (needs) assertAgentHas(user, needs);
  return { user, isAdmin };
}

export function templateError(error: unknown, what: string) {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  const info = error as { code?: string } | null;
  if (info && (info.code === 'PGRST205' || info.code === '42P01' || info.code === '42703')) {
    console.error(`Error ${what} templates (database not updated):`, error);
    return NextResponse.json({ error: 'The database needs one more update before templates work. Run add-templates-automation.sql and add-templates-last-used.sql in Supabase.' }, { status: 500 });
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
  // Where a PDF template files itself in a deal's Documents (the deal Documents categories, not the email categories above).
  if (body.documentCategory !== undefined) {
    const key = typeof body.documentCategory === 'string' ? body.documentCategory : '';
    if (!isValidCategory(key)) throw new AuthError('Choose a document category from the list.', 400);
    out.document_category = key;
    const type = typeof body.documentType === 'string' ? body.documentType : '';
    out.document_type = type && isValidDocumentType(key, type) ? type : resolveDocumentPlacement(key, null).documentType;
  }
  if (body.archived !== undefined) out.archived = body.archived === true;
  if (body.brokerageShared !== undefined) out.brokerage_shared = body.brokerageShared === true;
  return out;
}

export async function loadOwnTemplate(templateId: string, ownerId: string) {
  const { data } = await supabaseServer.from('doc_templates').select('*').eq('id', templateId).maybeSingle();
  if (!data || data.owner_user_id !== ownerId) throw new AuthError('Template not found', 404);
  return data;
}

/** Your own template, or one a brokerage owner shared with the brokerage you belong to (read and use, never change). */
export async function loadUsableTemplate(templateId: string, userId: string) {
  const { data } = await supabaseServer.from('doc_templates').select('*').eq('id', templateId).maybeSingle();
  if (!data) throw new AuthError('Template not found', 404);
  if (data.owner_user_id === userId) return { ...data, from_brokerage: false };
  if (data.brokerage_shared === true && !data.archived && (await brokerageOwnersFor(userId)).includes(data.owner_user_id as string)) return { ...data, from_brokerage: true };
  throw new AuthError('Template not found', 404);
}

export const RULE_TRIGGERS = ['deal_closed', 'closing_date', 'acceptance_date'] as const;

/** Only the rule fields that were sent, cleaned. `forCreate` requires a trigger. */
export function cleanRuleInput(body: Record<string, unknown>, forCreate: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (forCreate || body.trigger_event !== undefined) {
    if (!RULE_TRIGGERS.includes(body.trigger_event as (typeof RULE_TRIGGERS)[number])) throw new AuthError('Choose when this should happen.', 400);
    out.trigger_event = body.trigger_event;
  }
  if (body.offset_days !== undefined) {
    const n = Number(body.offset_days);
    if (!Number.isInteger(n) || n < -365 || n > 3650) throw new AuthError('Days must be a whole number between -365 and 3650.', 400);
    out.offset_days = n;
  }
  if (body.repeat_yearly !== undefined) out.repeat_yearly = body.repeat_yearly === true;
  if (body.repeat_years !== undefined) {
    const n = Number(body.repeat_years);
    if (!Number.isInteger(n) || n < 1 || n > 20) throw new AuthError('Repeat for between 1 and 20 years.', 400);
    out.repeat_years = n;
  }
  if (body.enabled !== undefined) out.enabled = body.enabled === true;
  if (body.recipient_roles !== undefined) {
    if (!Array.isArray(body.recipient_roles)) throw new AuthError('Recipients must be a list.', 400);
    const roles = body.recipient_roles.filter((r): r is string => typeof r === 'string').map((r) => CONTACT_CATEGORIES.find((c) => c.toLowerCase() === r.trim().toLowerCase()));
    if (roles.some((r) => !r)) throw new AuthError('One of the recipient roles is not recognised.', 400);
    out.recipient_roles = [...new Set(roles as string[])];
  }
  return out;
}

export async function loadOwnRule(ruleId: string, ownerId: string) {
  const { data } = await supabaseServer.from('template_rules').select('*').eq('id', ruleId).maybeSingle();
  if (!data || data.owner_user_id !== ownerId) throw new AuthError('Rule not found', 404);
  return data;
}

/** Remembers that a template was just used, for the "recently used" shortcuts. Never fails the request it is part of. */
export async function markTemplateUsed(templateId: string, ownerId: string): Promise<void> {
  try {
    const { data } = await supabaseServer.from('doc_templates').select('use_count').eq('id', templateId).eq('owner_user_id', ownerId).maybeSingle();
    await supabaseServer
      .from('doc_templates')
      .update({ last_used_at: new Date().toISOString(), use_count: ((data?.use_count as number | undefined) ?? 0) + 1 })
      .eq('id', templateId)
      .eq('owner_user_id', ownerId);
  } catch (error) {
    console.error('Could not note template use:', error);
  }
}
