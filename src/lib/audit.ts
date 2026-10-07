import type { NextRequest } from 'next/server';
import { supabaseServer } from './supabase';

/**
 * Appends one row to the audit_log table (see add-audit-log.sql): who did
 * what, to which record, from which IP. Never throws and never blocks the
 * request on failure -- an audit hiccup must not break the user's action --
 * so if the table hasn't been created yet this just logs a console error.
 *
 * Don't put document contents, passwords or tokens in `metadata`; ids,
 * counts and names of things are fine.
 */
export async function logAudit(
  request: NextRequest | null,
  actor: { id?: string | null; email?: string | null } | null,
  action: string,
  details: { entityType?: string; entityId?: string | null; metadata?: Record<string, unknown> } = {}
): Promise<void> {
  try {
    const forwarded = request?.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0].trim() : request?.headers.get('x-real-ip') || null;
    const { error } = await supabaseServer.from('audit_log').insert({
      actor_id: actor?.id ?? null,
      actor_email: actor?.email ?? null,
      action,
      entity_type: details.entityType ?? null,
      entity_id: details.entityId ?? null,
      ip,
      user_agent: request?.headers.get('user-agent')?.slice(0, 300) ?? null,
      metadata: details.metadata ?? {},
    });
    if (error) console.error('Audit log write failed:', error.message);
  } catch (err) {
    console.error('Audit log write failed:', err);
  }
}
