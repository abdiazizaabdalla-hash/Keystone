import { supabaseServer } from './supabase';
import type { PlanId } from './plans';
import { DEFAULT_PLAN } from './plans';

export interface StripeCustomerRow {
  user_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string | null;
  plan: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
}

export async function getStripeCustomerByUserId(userId: string): Promise<StripeCustomerRow | null> {
  const { data, error } = await supabaseServer
    .from('stripe_customers')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getStripeCustomerByCustomerId(customerId: string): Promise<StripeCustomerRow | null> {
  const { data, error } = await supabaseServer
    .from('stripe_customers')
    .select('*')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertStripeCustomer(row: Partial<StripeCustomerRow> & { user_id: string }) {
  const { error } = await supabaseServer
    .from('stripe_customers')
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}

/**
 * Merge-updates a Supabase Auth user's metadata `plan` field. Always reads
 * the user first and spreads their existing metadata before writing, the
 * same pattern /api/auth/me PATCH uses — Supabase's updateUserById replaces
 * user_metadata wholesale, so a naive `{ user_metadata: { plan } }` call
 * would silently wipe out default_flat_fee/default_percent_fee/is_admin.
 */
export async function setUserPlan(userId: string, plan: PlanId | typeof DEFAULT_PLAN) {
  const { data: existing, error: getError } = await supabaseServer.auth.admin.getUserById(userId);
  if (getError) throw getError;
  if (!existing.user) throw new Error(`No auth user found for id ${userId}`);

  const { error: updateError } = await supabaseServer.auth.admin.updateUserById(userId, {
    user_metadata: { ...existing.user.user_metadata, plan },
  });
  if (updateError) throw updateError;
}
