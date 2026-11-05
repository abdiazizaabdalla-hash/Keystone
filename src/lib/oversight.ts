import { supabaseServer } from './supabase';
import { isFeatureOn } from './features';
import { AuthError } from './auth';
import { isTeamPlan } from './plans';
import { getUserPlan, type WithAppMetadata } from './appMetadata';
import { getEntitlements } from './entitlements';
import { CLOSED_STAGE, normaliseEmail, dealHealth, nextStepFor, listingHealth, isOpenListing, type DealHealth, type ListingHealth, type NextStep, type OversightDeal, type OversightListing, type OversightTask } from './oversightMath';

export * from './oversightMath';

// Brokerage oversight. A brokerage owner (on a Team or Brokerage plan) invites agents who have their own workspace.
// When an agent accepts, the owner can:
//   - see every deal of that agent (read-only pages, built on the routes in /api/oversight),
//   - see deadlines, what needs attention, and production numbers,
//   - edit any of that agent's deals (status, key dates, checklist steps), and
//   - hear about updates on those deals in the notification bell.
// The agent's templates, contacts, messages and settings stay private: nothing here reads them.
// Everything is off (404) unless the `brokerage` feature is switched on.

export const MAX_LINKS_PER_OWNER = 200;

export type LinkStatus = 'pending' | 'active' | 'declined' | 'removed' | 'left';

export interface BrokerageLink {
  id: string;
  owner_user_id: string;
  agent_user_id: string | null;
  invited_email: string;
  status: LinkStatus;
  invited_at: string;
  responded_at: string | null;
  ended_at: string | null;
  default_split_type?: 'percent' | 'flat_agent' | 'flat_brokerage' | null;
  default_split_value?: number | string | null;
  default_fees?: unknown;
  cap_cents?: number | string | null;
  cap_reset?: string | null;
  cap_start?: string | null;
}

export const brokerageOn = () => isFeatureOn('brokerage');

/** What an agent is told, in plain words, before accepting. Shown on the agent's page and in the invite. */
export const OVERSIGHT_TERMS = {
  sees: [
    'Your name, email, phone, license number, the states you work in and what you focus on.',
    'Every deal in your workspace: address, stage, key dates and the checklist.',
    'Every listing in your workspace: address, status, price, dates, the checklist and the names of its documents (not the seller’s details or the offers themselves).',
    'Deadlines, overdue steps and which deals need attention.',
    'Production numbers: deals closed and sales volume.',
    'Updates on your deals in their notification bell (not your messages).',
  ],
  canDo: ['Confirm the commission on a closed deal and mark it paid. They cannot change your deals, dates, checklists or documents: they see a read-only copy.'],
  private: ['Your templates, contacts, messages with clients, invoices and settings stay private.'],
  leave: 'You can leave at any time from this page. Your deals stay yours.',
};

export function cleanEmail(value: unknown): string {
  const email = normaliseEmail(value);
  if (!email) throw new AuthError('Enter a valid email address.', 400);
  return email;
}

/** A brokerage owner: feature on, Team or Brokerage plan. Agents with a workspace and free logins are refused. */
export function assertBrokerageOwner(user: WithAppMetadata): void {
  if (!brokerageOn()) throw new AuthError('Not found', 404);
  if (!isTeamPlan(getUserPlan(user))) throw new AuthError('Brokerage oversight is part of the Team and Brokerage plans.', 403);
}

/** An agent who can join a brokerage: feature on and an agent workspace of their own. */
export function assertWorkspaceAgent(user: WithAppMetadata): void {
  if (!brokerageOn()) throw new AuthError('Not found', 404);
  if (getEntitlements(user).kind !== 'agent_workspace') throw new AuthError('Joining a brokerage needs an agent workspace of your own.', 403);
}

async function ownerStillOnTeamPlan(ownerId: string): Promise<boolean> {
  const { data } = await supabaseServer.auth.admin.getUserById(ownerId);
  return Boolean(data.user) && isTeamPlan(getUserPlan(data.user as WithAppMetadata));
}

export async function listOwnerLinks(ownerId: string): Promise<BrokerageLink[]> {
  const { data, error } = await supabaseServer.from('brokerage_links').select('*').eq('owner_user_id', ownerId).in('status', ['pending', 'active']).order('invited_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as BrokerageLink[];
}

export async function activeAgentIds(ownerId: string): Promise<string[]> {
  const { data, error } = await supabaseServer.from('brokerage_links').select('agent_user_id').eq('owner_user_id', ownerId).eq('status', 'active');
  if (error) throw error;
  return (data ?? []).map((r) => r.agent_user_id as string).filter(Boolean);
}

export async function activeLinkForAgent(agentUserId: string): Promise<BrokerageLink | null> {
  const { data, error } = await supabaseServer.from('brokerage_links').select('*').eq('agent_user_id', agentUserId).eq('status', 'active').maybeSingle();
  if (error) throw error;
  return (data as BrokerageLink | null) ?? null;
}

/** Open invites addressed to this agent, found by account or by the email they were sent to. */
export async function pendingInvitesFor(agentUserId: string, email: string | null | undefined): Promise<BrokerageLink[]> {
  const byId = await supabaseServer.from('brokerage_links').select('*').eq('agent_user_id', agentUserId).eq('status', 'pending');
  if (byId.error) throw byId.error;
  const rows = [...((byId.data ?? []) as BrokerageLink[])];
  if (email) {
    const byEmail = await supabaseServer.from('brokerage_links').select('*').ilike('invited_email', email.trim().toLowerCase()).eq('status', 'pending');
    if (byEmail.error) throw byEmail.error;
    for (const r of (byEmail.data ?? []) as BrokerageLink[]) if (!rows.some((x) => x.id === r.id)) rows.push(r);
  }
  return rows;
}

/** Brokerage owners whose shared templates this person may use: the brokerage they joined as an agent, or the team they are on. */
export async function brokerageOwnersFor(userId: string): Promise<string[]> {
  if (!brokerageOn()) return [];
  // The two ways in (a joined agent's link, a team membership) are looked up together, then the owners' plans together.
  const [link, member] = await Promise.all([
    activeLinkForAgent(userId),
    supabaseServer.from('team_members').select('team_id').eq('user_id', userId).maybeSingle().then(async ({ data }) => {
      if (!data) return null;
      const { data: team } = await supabaseServer.from('teams').select('owner_id').eq('id', data.team_id).maybeSingle();
      return team && team.owner_id !== userId ? (team.owner_id as string) : null;
    }),
  ]);
  const owners = new Set<string>();
  if (link) owners.add(link.owner_user_id);
  if (member) owners.add(member);
  const checked = await Promise.all([...owners].map(async (id) => ((await ownerStillOnTeamPlan(id)) ? id : null)));
  return checked.filter((id): id is string => id !== null);
}

/** Does this brokerage owner currently oversee this agent? (Active link and the owner is still on a team plan.) */
export async function overseesAgent(ownerId: string, agentUserId: string): Promise<boolean> {
  const { data } = await supabaseServer.from('brokerage_links').select('id').eq('owner_user_id', ownerId).eq('agent_user_id', agentUserId).eq('status', 'active').maybeSingle();
  if (!data) return false;
  return ownerStillOnTeamPlan(ownerId);
}

/** May this person see and edit this deal as the owner of the agent's brokerage? */
export async function canOverseeDeal(userId: string, transactionId: string): Promise<boolean> {
  if (!brokerageOn()) return false;
  const { data: tx } = await supabaseServer.from('transactions').select('tc_user_id').eq('id', transactionId).maybeSingle();
  const dealOwner = tx?.tc_user_id as string | null | undefined;
  if (!dealOwner || dealOwner === userId) return false;
  return overseesAgent(userId, dealOwner);
}

/** True when this listing belongs to an agent the owner oversees. */
export async function canOverseeListing(userId: string, listingId: string): Promise<boolean> {
  if (!brokerageOn()) return false;
  const { data } = await supabaseServer.from('listings').select('tc_user_id').eq('id', listingId).maybeSingle();
  const listingOwner = data?.tc_user_id as string | null | undefined;
  if (!listingOwner || listingOwner === userId) return false;
  return overseesAgent(userId, listingOwner);
}

/** Brokerage owners who should hear about updates on this deal. Empty unless the feature is on. */
export async function brokerageOwnersForDeal(transactionId: string): Promise<string[]> {
  if (!brokerageOn()) return [];
  const { data: tx } = await supabaseServer.from('transactions').select('tc_user_id').eq('id', transactionId).maybeSingle();
  const dealOwner = tx?.tc_user_id as string | null | undefined;
  if (!dealOwner) return [];
  const { data } = await supabaseServer.from('brokerage_links').select('owner_user_id').eq('agent_user_id', dealOwner).eq('status', 'active');
  const owners: string[] = [];
  for (const row of data ?? []) if (await ownerStillOnTeamPlan(row.owner_user_id as string)) owners.push(row.owner_user_id as string);
  return owners;
}

export interface AgentLabel {
  id: string;
  name: string;
  email: string | null;
}

export async function agentLabels(ids: string[]): Promise<Map<string, AgentLabel>> {
  const out = new Map<string, AgentLabel>();
  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const { data } = await supabaseServer.auth.admin.getUserById(id);
      const u = data.user;
      if (!u) return;
      const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
      const name = typeof meta.full_name === 'string' && meta.full_name.trim() ? meta.full_name.trim() : (u.email ?? 'Agent');
      out.set(id, { id, name, email: u.email ?? null });
    })
  );
  return out;
}

const chunk = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

/** Every deal of these agents with its checklist health. */
export async function loadOversightDeals(agentIds: string[], today: string) {
  if (agentIds.length === 0) return [] as (OversightDeal & { health: DealHealth; nextStep: NextStep | null; tasksTotal: number; tasksDone: number })[];
  const { data, error } = await supabaseServer
    .from('transactions')
    .select('id, tc_user_id, property_address, file_number, status, purchase_price, acceptance_date, closing_date, updated_at')
    .in('tc_user_id', agentIds)
    .order('updated_at', { ascending: false })
    .limit(2000);
  if (error) throw error;
  const deals = (data ?? []) as OversightDeal[];
  const tasks: OversightTask[] = [];
  for (const ids of chunk(deals.map((d) => d.id), 80)) {
    const { data: rows, error: tErr } = await supabaseServer.from('tasks').select('transaction_id, name, sort_order, completed, due_date').in('transaction_id', ids);
    if (tErr) throw tErr;
    tasks.push(...((rows ?? []) as OversightTask[]));
  }
  const byDeal = new Map<string, OversightTask[]>();
  for (const t of tasks) byDeal.set(t.transaction_id, [...(byDeal.get(t.transaction_id) ?? []), t]);
  return deals.map((d) => {
    const mine = byDeal.get(d.id) ?? [];
    return { ...d, health: dealHealth(d, mine, today), nextStep: d.status === CLOSED_STAGE ? null : nextStepFor(mine), tasksTotal: mine.length, tasksDone: mine.filter((t) => t.completed).length };
  });
}


type ListingTask = Omit<OversightTask, 'transaction_id'> & { listing_id: string };

export type OversightListingRow = OversightListing & { health: ListingHealth; nextStep: NextStep | null; tasksTotal: number; tasksDone: number; openOffers: number };

/** Every listing of these agents with its checklist health and how many offers are waiting. Seller details are not read. */
export async function loadOversightListings(agentIds: string[], today: string): Promise<OversightListingRow[]> {
  if (agentIds.length === 0) return [];
  const { data, error } = await supabaseServer
    .from('listings')
    .select('id, tc_user_id, property_address, status, list_price, planned_list_date, listed_on, expiration_date, mls_number, updated_at')
    .in('tc_user_id', agentIds)
    .order('updated_at', { ascending: false })
    .limit(2000);
  if (error) throw error;
  const listings = (data ?? []) as OversightListing[];
  const tasks: ListingTask[] = [];
  const offers: { listing_id: string; status: string }[] = [];
  for (const ids of chunk(listings.map((l) => l.id), 80)) {
    const [{ data: t, error: tErr }, { data: o, error: oErr }] = await Promise.all([
      supabaseServer.from('listing_tasks').select('listing_id, name, sort_order, completed, due_date').in('listing_id', ids),
      supabaseServer.from('listing_offers').select('listing_id, status').in('listing_id', ids),
    ]);
    if (tErr) throw tErr;
    if (oErr) throw oErr;
    tasks.push(...((t ?? []) as ListingTask[]));
    offers.push(...((o ?? []) as { listing_id: string; status: string }[]));
  }
  const byListing = new Map<string, ListingTask[]>();
  for (const t of tasks) byListing.set(t.listing_id, [...(byListing.get(t.listing_id) ?? []), t]);
  return listings.map((l) => {
    const mine = byListing.get(l.id) ?? [];
    return {
      ...l,
      health: listingHealth(l, mine, today),
      nextStep: isOpenListing(l.status) ? nextStepFor(mine) : null,
      tasksTotal: mine.length,
      tasksDone: mine.filter((x) => x.completed).length,
      openOffers: offers.filter((o) => o.listing_id === l.id && (o.status === 'received' || o.status === 'countered')).length,
    };
  });
}
