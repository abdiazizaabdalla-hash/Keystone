import { supabaseServer } from './supabase';
import { getAccount } from './brokerageAccount';
import { getTeamForUser, getTeamMemberUserIds } from './team';
import { listOwnerLinks } from './oversight';

// Whose files a Team-plan owner watches, and which kind of owner they are.
//   brokerage: has a brokerage account (the pilot) or has invited agents. They watch the agents who joined.
//   team: a coordinator who runs a team of TCs. They watch their team members, by status only.
// An owner starts as a team; a brokerage account or an invited agent makes them a brokerage.

export type OversightMode = 'brokerage' | 'team';

const missingTable = (e: { code?: string } | null | undefined) => e?.code === 'PGRST205' || e?.code === '42P01';

export async function ownerKind(ownerId: string): Promise<OversightMode> {
  if (await getAccount(ownerId)) return 'brokerage';
  const { count, error } = await supabaseServer.from('brokerage_links').select('id', { count: 'exact', head: true }).eq('owner_user_id', ownerId).in('status', ['pending', 'active']);
  if (error && !missingTable(error)) throw error;
  return (count ?? 0) > 0 ? 'brokerage' : 'team';
}

export interface Roster {
  mode: OversightMode;
  /** The people whose files are watched: joined agents, or team members (not the owner). */
  userIds: string[];
  /** Everyone whose new files get the default checklist: the watched people, plus the owner of a team. */
  checklistIds: string[];
}

export async function rosterFor(ownerId: string): Promise<Roster> {
  const mode = await ownerKind(ownerId);
  if (mode === 'brokerage') {
    const ids = (await listOwnerLinks(ownerId)).filter((l) => l.status === 'active' && l.agent_user_id).map((l) => l.agent_user_id as string);
    return { mode, userIds: ids, checklistIds: ids };
  }
  const membership = await getTeamForUser(ownerId);
  if (!membership || membership.role !== 'owner') return { mode, userIds: [], checklistIds: [ownerId] };
  const members = (await getTeamMemberUserIds(membership.team.id)).filter((id) => id !== ownerId);
  return { mode, userIds: members, checklistIds: [ownerId, ...members] };
}

/** The owner of the team this person belongs to (owner or member), when they are on a TC team and not a brokerage. */
export async function teamOwnerFor(userId: string): Promise<string | null> {
  const membership = await getTeamForUser(userId);
  if (!membership) return null;
  const ownerId = membership.team.owner_id;
  return (await ownerKind(ownerId)) === 'team' ? ownerId : null;
}
