import { supabaseServer } from './supabase';
import { AuthError } from './auth';
import { assertBrokerageOwner, brokerageOn } from './oversight';
import type { WithAppMetadata } from './appMetadata';
import { roleAllows, type AdminRole, type AdminScope, isAdminRole } from './brokerageAdmins';

// Who is acting for a brokerage. The owner acts as themselves. An administrator the owner added acts on the owner's brokerage,
// limited to what their role allows. Every brokerage route that used to require the owner calls resolveBrokerageActor instead,
// and then works with the OWNER's user, so all of its queries stay keyed on the owner exactly as before.

type CallerUser = WithAppMetadata & { id: string; email?: string | null };
export type BrokerageOwnerUser = WithAppMetadata & { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null };

export interface AdminLink { id: string; ownerId: string; role: AdminRole }

/** The active administrator link for this person's email, if the owner added them. Tolerates a database without the table. */
export async function findAdminLink(user: { id: string; email?: string | null }): Promise<AdminLink | null> {
  const email = (user.email ?? '').trim().toLowerCase();
  if (!email) return null;
  const { data, error } = await supabaseServer.from('brokerage_admins').select('id, owner_user_id, role, admin_user_id').ilike('invited_email', email).eq('status', 'active').limit(1).maybeSingle();
  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01') return null;
    throw error;
  }
  if (!data || !isAdminRole(data.role)) return null;
  // First use: remember which login this is, so the record shows who accepted.
  if (!data.admin_user_id) await supabaseServer.from('brokerage_admins').update({ admin_user_id: user.id }).eq('id', data.id);
  else if (data.admin_user_id !== user.id) return null;
  return { id: data.id as string, ownerId: data.owner_user_id as string, role: data.role as AdminRole };
}

/**
 * The brokerage owner whose data this request may use. The owner themselves pass straight through. Anyone else needs an
 * administrator link whose role allows `scope`. Returns the owner's user, so callers keep using `owner.id` as before.
 */
export async function resolveBrokerageActor(caller: CallerUser, scope: AdminScope): Promise<{ owner: BrokerageOwnerUser; delegated: boolean; role: AdminRole | null }> {
  if (!brokerageOn()) throw new AuthError('Not found', 404);
  try {
    await assertBrokerageOwner(caller);
    return { owner: caller as BrokerageOwnerUser, delegated: false, role: null };
  } catch (ownerError) {
    const link = await findAdminLink(caller);
    if (!link) throw ownerError;
    if (!roleAllows(link.role, scope)) throw new AuthError('Your administrator role does not include this.', 403);
    const { data } = await supabaseServer.auth.admin.getUserById(link.ownerId);
    if (!data.user) throw new AuthError('This brokerage is no longer available.', 404);
    const owner = data.user as unknown as BrokerageOwnerUser;
    await assertBrokerageOwner(owner);
    return { owner, delegated: true, role: link.role };
  }
}

/** Owner-only actions (their plan, upgrade requests, administrators): no delegation. */
export async function requireBrokerageOwnerOnly(caller: CallerUser): Promise<void> {
  await assertBrokerageOwner(caller);
}
