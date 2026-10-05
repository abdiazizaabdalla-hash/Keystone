import { supabaseServer } from './supabase';
import { mergeAppMetadata } from './privileged';
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
 * Sets a Supabase Auth user's metadata `plan` field. Goes through
 * mergeUserMetadata (see lib/userMetadata.ts) rather than spreading a
 * metadata object this function already has in hand, since this is the
 * plan grant the Stripe webhook calls immediately on
 * checkout.session.completed -- exactly the kind of write that's most
 * likely to race against something else touching user_metadata at the
 * same moment (e.g. the onboarding wizard's own PATCH /api/auth/me
 * calls), and the one where losing the race is most costly (a customer
 * who just paid silently not getting what they paid for).
 */
export async function setUserPlan(userId: string, plan: PlanId | typeof DEFAULT_PLAN) {
  await mergeAppMetadata(userId, { plan });
}
