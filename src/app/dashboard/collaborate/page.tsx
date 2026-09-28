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

interface TeamResponse {
  team: { id: string; name: string } | null;
  role: 'owner' | 'member' | null;
  seatLimit: number;
  members: Member[];
  pendingInvites: PendingInvite[];
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

  const load = async () => {
    try {
      const res = await authFetch('/api/team');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load team');
      setData(json);
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

  const handleRemove = async (userId: string) => {
    setRemovingId(userId);
    try {
      const res = await authFetch(`/api/team?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to remove teammate');
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
        <p className="text-slate-400">Collaborate is a Team plan feature. Upgrade to work with teammates.</p>
      </div>
    );
  }

  const isOwner = data.role === 'owner';
  const seatsUsed = data.members.length + data.pendingInvites.length;

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-3xl font-display font-semibold text-slate-100 mb-1">Collaborate</h1>
      <p className="text-slate-400 mb-8">
        {isOwner
          ? "Your team's roster and pipeline, all in one place."
          : "Your team's roster. Only your team owner can see everyone's transaction details."}
      </p>

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

      {isOwner && (
        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6">
          <h2 className="font-display font-semibold text-slate-100 mb-1">Invite a teammate</h2>
          <p className="text-sm text-slate-400 mb-4">
            They&apos;ll get Team-plan access right away — no separate payment needed, it&apos;s covered by your subscription.
          </p>
          {seatsUsed >= data.seatLimit ? (
            <p className="text-sm text-blue-400">
              You&apos;ve used all {data.seatLimit} seats on your Team plan.
            </p>
          ) : (
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
          )}
          {inviteMessage && <p className="text-sm text-slate-300 mt-3">{inviteMessage}</p>}
        </div>
      )}
    </div>
  );
}
