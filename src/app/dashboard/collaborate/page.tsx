'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';

interface MemberStats {
  agents: number;
  activeTransactions: number;
  totalTransactions: number;
}

interface Member {
  userId: string;
  email: string;
  name: string;
  role: 'owner' | 'member';
  isYou: boolean;
  stats?: MemberStats;
}

interface PendingInvite {
  id: string;
  email: string;
  createdAt: string;
}

interface TeamInfo {
  id: string;
  name: string | null;
  defaultChecklistTemplateId: string | null;
}

interface TeamResponse {
  team: TeamInfo | null;
  role: 'owner' | 'member' | null;
  planId: string | null;
  seatLimit: number;
  seatPriceLabel?: string;
  members: Member[];
  pendingInvites: PendingInvite[];
}

interface RosterAgent {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  team_id: string | null;
}

export default function CollaboratePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TeamResponse | null>(null);
  const [error, setError] = useState('');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteMessage, setInviteMessage] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Team/brokerage settings -- just the name for now. (No fee/invoicing
  // defaults here: a brokerage isn't charging its own in-house agents a
  // coordination fee, so there's nothing to default. A Brokerage-only
  // default checklist template picker belongs here once template
  // team-scoping has real UI -- see checklist_templates.team_id.)
  const [teamName, setTeamName] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');

  // Brokerage-wide agent roster.
  const [rosterAgents, setRosterAgents] = useState<RosterAgent[]>([]);
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentEmail, setNewAgentEmail] = useState('');
  const [addingAgent, setAddingAgent] = useState(false);
  const [rosterMessage, setRosterMessage] = useState('');

  const loadRoster = async (teamId: string) => {
    try {
      const res = await authFetch('/api/agents');
      const json = await res.json();
      if (!res.ok) return;
      setRosterAgents((json as RosterAgent[]).filter((a) => a.team_id === teamId));
    } catch {
      // Non-fatal -- the roster section just stays empty.
    }
  };

  const load = async () => {
    try {
      const res = await authFetch('/api/team');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load team');
      setData(json);
      setTeamName(json.team?.name || '');
      if (json.role === 'owner' && json.planId === 'brokerage' && json.team?.id) {
        await loadRoster(json.team.id);
      }
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load team');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setInviteMessage('');
    try {
      const res = await authFetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to invite');
      const emailNote = json.emailSent === false ? ' (the notification email failed to send — let them know directly.)' : '';
      setInviteMessage(
        json.status === 'added'
          ? `${inviteEmail} was added to your team.${emailNote}`
          : `Invite sent to ${inviteEmail} — they'll join the team automatically when they sign up.${emailNote}`
      );
      setInviteEmail('');
      await load();
    } catch (err) {
      setInviteMessage(err instanceof Error ? err.message : 'Failed to invite');
    } finally {
      setInviting(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsMessage('');
    try {
      const payload: Record<string, unknown> = { name: teamName };
      const res = await authFetch('/api/team', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save settings');
      setSettingsMessage('Saved.');
      await load();
    } catch (err) {
      setSettingsMessage(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAddRosterAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddingAgent(true);
    setRosterMessage('');
    try {
      const res = await authFetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newAgentName, email: newAgentEmail || undefined, teamWide: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to add agent');
      setNewAgentName('');
      setNewAgentEmail('');
      setRosterMessage(`${json.name} added to the brokerage roster.`);
      if (data?.team?.id) await loadRoster(data.team.id);
    } catch (err) {
      setRosterMessage(err instanceof Error ? err.message : 'Failed to add agent');
    } finally {
      setAddingAgent(false);
    }
  };

  const handleRemove = async (userId: string) => {
    setRemovingId(userId);
    try {
      const res = await authFetch(`/api/team?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to remove teammate');
      // The backend already downgraded them off the Team plan and cut off
      // their access to this team's data before returning -- see DELETE
      // /api/team. This message just confirms that to the owner.
      setInviteMessage(
        json.emailSent === false
          ? 'Removed from your team and moved to the Starter plan (the notification email failed to send — let them know directly).'
          : "Removed from your team and moved to the Starter plan — they've been emailed."
      );
      await load();
    } catch (err) {
      setInviteMessage(err instanceof Error ? err.message : 'Failed to remove teammate');
    } finally {
      setRemovingId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-4 border-slate-600 border-t-blue-400 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-200 text-sm">{error}</div>
      </div>
    );
  }

  if (!data || !data.team) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-display font-semibold text-slate-100 mb-2">Collaborate</h1>
        <p className="text-slate-400">Collaborate is a Team/Brokerage plan feature. Upgrade to work with teammates.</p>
      </div>
    );
  }

  const isOwner = data.role === 'owner';
  const isBrokerage = data.planId === 'brokerage';
  const seatsUsed = data.members.length + data.pendingInvites.length;

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-3xl font-display font-semibold text-slate-100 mb-1">
        {data.team.name || 'Collaborate'}
      </h1>
      <p className="text-slate-400 mb-8">
        {isOwner
          ? "Your team's roster and pipeline, all in one place."
          : "Your team's roster. Only your team owner can see everyone's transaction details."}
      </p>

      {isOwner && (
        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6 mb-6">
          <h2 className="font-display font-semibold text-slate-100 mb-1">
            {isBrokerage ? 'Brokerage settings' : 'Team settings'}
          </h2>
          <p className="text-sm text-slate-400 mb-4">
            {isBrokerage ? 'Your brokerage name.' : "Your team's name."}
          </p>
          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                {isBrokerage ? 'Brokerage name' : 'Team name'}
              </label>
              <input
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder={isBrokerage ? 'Acme Realty' : "Sarah's Team"}
                className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={savingSettings}
              className="px-5 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition disabled:opacity-50"
            >
              {savingSettings ? 'Saving…' : 'Save'}
            </button>
            {settingsMessage && <p className="text-sm text-slate-300">{settingsMessage}</p>}
          </form>
        </div>
      )}

      <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-slate-600 flex items-center justify-between">
          <h2 className="font-display font-semibold text-slate-100">Team roster</h2>
          {isOwner && (
            <span className="text-xs text-slate-400">
              {seatsUsed} / {data.seatLimit} seats used
            </span>
          )}
        </div>

        <div className="divide-y divide-slate-700">
          {data.members.map((member) => {
            const canDrillDown = isOwner && !!member.stats;
            return (
              <div
                key={member.userId}
                onClick={canDrillDown ? () => router.push(`/dashboard/collaborate/${member.userId}`) : undefined}
                className={`px-6 py-4 flex items-center justify-between gap-4 ${
                  canDrillDown ? 'cursor-pointer hover:bg-slate-600/30 transition' : ''
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-100 font-medium truncate">{member.name || member.email}</span>
                    {member.isYou && <span className="text-xs text-slate-500">(you)</span>}
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full capitalize ${
                        member.role === 'owner'
                          ? 'bg-blue-500/20 text-blue-300'
                          : 'bg-slate-600 text-slate-300'
                      }`}
                    >
                      {member.role}
                    </span>
                  </div>
                  {member.name && <div className="text-xs text-slate-500 truncate">{member.email}</div>}
                  {isOwner && member.stats && (
                    <div className="text-sm text-slate-400 mt-1">
                      {member.stats.agents} agent{member.stats.agents === 1 ? '' : 's'} ·{' '}
                      {member.stats.activeTransactions} active transaction
                      {member.stats.activeTransactions === 1 ? '' : 's'} ·{' '}
                      {member.stats.totalTransactions} total
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {canDrillDown && (
                    <span className="text-xs text-blue-400 hidden sm:inline">View transactions ›</span>
                  )}
                  {isOwner && !member.isYou && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove(member.userId);
                      }}
                      disabled={removingId === member.userId}
                      className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                    >
                      {removingId === member.userId ? 'Removing…' : 'Remove'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {isOwner &&
            data.pendingInvites.map((invite) => (
              <div key={invite.id} className="px-6 py-4 flex items-center justify-between gap-4">
                <div>
                  <span className="text-slate-300">{invite.email}</span>
                  <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-slate-600 text-slate-400">Invite pending</span>
                </div>
              </div>
            ))}
        </div>
      </div>

      {isOwner && isBrokerage && (
        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-slate-600 flex items-center justify-between">
            <h2 className="font-display font-semibold text-slate-100">Brokerage agent roster</h2>
            <span className="text-xs text-slate-400">{rosterAgents.length}</span>
          </div>

          <div className="divide-y divide-slate-700">
            {rosterAgents.length === 0 && (
              <p className="px-6 py-8 text-sm text-slate-500 text-center">
                No agents on the brokerage roster yet -- add one below. Any TC on your team can assign them to a
                transaction.
              </p>
            )}
            {rosterAgents.map((agent) => (
              <div key={agent.id} className="px-6 py-4">
                <span className="text-slate-100 font-medium">{agent.name}</span>
                {agent.email && <span className="ml-2 text-xs text-slate-500">{agent.email}</span>}
              </div>
            ))}
          </div>

          <form onSubmit={handleAddRosterAgent} className="px-6 py-4 border-t border-slate-600 flex gap-3">
            <input
              type="text"
              required
              value={newAgentName}
              onChange={(e) => setNewAgentName(e.target.value)}
              placeholder="Agent name"
              className="flex-1 bg-slate-600 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
            <input
              type="email"
              value={newAgentEmail}
              onChange={(e) => setNewAgentEmail(e.target.value)}
              placeholder="Email (optional)"
              className="flex-1 bg-slate-600 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={addingAgent}
              className="px-5 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition disabled:opacity-50"
            >
              {addingAgent ? 'Adding…' : 'Add to roster'}
            </button>
          </form>
          {rosterMessage && <p className="px-6 py-3 text-sm text-slate-300">{rosterMessage}</p>}
        </div>
      )}

      {isOwner && (
        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6">
          <h2 className="font-display font-semibold text-slate-100 mb-1">Invite a teammate</h2>
          {/* The backend (see POST /api/team) never hard-caps the team --
              inviting past the currently-paid seat count just adds one
              more prorated seat to the subscription automatically. The
              form below always stays available so that path is reachable;
              only the messaging changes to set expectations correctly. */}
          <p className="text-sm text-slate-400 mb-4">
            {seatsUsed < data.seatLimit
              ? "They'll get the same plan access right away — no separate payment needed, it's covered by your subscription."
              : `You're at your current seat count (${seatsUsed}/${data.seatLimit}). Inviting one more adds a prorated seat to your subscription (~${data.seatPriceLabel || '$19/mo'}) right away.`}
          </p>
          <form onSubmit={handleInvite} className="flex gap-3">
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="teammate@example.com"
              className="flex-1 bg-slate-600 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={inviting}
              className="px-5 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition disabled:opacity-50"
            >
              {inviting ? 'Inviting…' : 'Invite'}
            </button>
          </form>
          {inviteMessage && <p className="text-sm text-slate-300 mt-3">{inviteMessage}</p>}
        </div>
      )}
    </div>
  );
}
