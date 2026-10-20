import { NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { isAgentUser } from '@/lib/agentPortal';
import { getVisibleTcUserIds } from '@/lib/team';

// Shared pieces of the Listings feature (see add-listings.sql).

export * from './listingsShared';
import { DEFAULT_LISTING_STEPS, type TemplateStep } from './listingsShared';

/** A TC (or their team) is signed in and may see this listing. Agents never reach these routes. */
export async function requireListingAccess(request: NextRequest, listingId: string) {
  const { user, isAdmin } = await getUserFromRequest(request);
  if (isAgentUser(user)) throw new AuthError('Not available', 403);
  const { data: listing } = await supabaseServer.from('listings').select('*').eq('id', listingId).maybeSingle();
  if (!listing) throw new AuthError('Listing not found', 404);
  if (!isAdmin) {
    const visible = await getVisibleTcUserIds(user.id);
    if (!visible.includes(listing.tc_user_id as string)) throw new AuthError('You do not have permission to view this listing', 403);
  }
  return { user, isAdmin, listing };
}

/** The checklist a new listing starts with: this TC's saved steps, else the starter set. */
export async function loadTemplateSteps(tcUserId: string): Promise<TemplateStep[]> {
  const { data } = await supabaseServer
    .from('listing_template_steps')
    .select('name, offset_days')
    .eq('tc_user_id', tcUserId)
    .order('sort_order', { ascending: true });
  if (data && data.length > 0) return data.map((r) => ({ name: r.name as string, offsetDays: Number(r.offset_days) || 0 }));
  return DEFAULT_LISTING_STEPS;
}

/** One line in the listing's history. Best effort: never blocks or fails the action it describes. */
export async function logListingActivity(
  listingId: string,
  actor: { email?: string | null; user_metadata?: Record<string, unknown> | null } | null,
  summary: string
): Promise<void> {
  try {
    const name = (actor?.user_metadata?.full_name as string | undefined)?.trim() || actor?.email || null;
    await supabaseServer.from('listing_activity').insert({ listing_id: listingId, actor_label: name, summary: summary.slice(0, 500) });
  } catch (error) {
    console.error('logListingActivity failed (ignored):', error);
  }
}
