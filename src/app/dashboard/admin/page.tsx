'use client';

import { Fragment, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { getPlan } from '@/lib/plans';

interface AgentAccount {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  suspended: boolean;
  deals: number;
}

interface AgentProfile {
  id: string;
  name: string | null;
  email: string | null;
}

interface TCUser {
  id: string;
  email: string;
  is_admin: boolean;
  plan?: string;
  created_at: string;
  last_sign_in_at?: string | null;
  suspended?: boolean;
  trial?: { applies: boolean; expired: boolean; trialEndsAt: string | null } | null;
  subscription_status?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  current_period_end?: string | null;
  agents_count?: number;
  active_transactions?: number;
  closed_transactions?: number;
  revenue_collected?: number;
  ai_reads?: number;
  ai_reads_30d?: number;
  ai_tokens?: number;
  ai_last_used?: string | null;
  agent_profiles?: AgentProfile[];
  portal_agents?: AgentAccount[];
}

const SUBSCRIPTION_BADGE_STYLES: Record<string, string> = {
  active: 'bg-green-900/30 text-green-300',
  trialing: 'bg-blue-900/30 text-blue-300',
  past_due: 'bg-amber-900/30 text-amber-300',
  canceled: 'bg-red-900/30 text-red-300',
  unpaid: 'bg-red-900/30 text-red-300',
  incomplete: 'bg-amber-900/30 text-amber-300',
  incomplete_expired: 'bg-red-900/30 text-red-300',
};

export default function AdminPage() {
  const router = useRouter();
  const [users, setUsers] = useState<TCUser[]>([]);
  const [unlinkedAgents, setUnlinkedAgents] = useState<AgentAccount[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    checkAdminAccess();
  }, []);

  const checkAdminAccess = async () => {
    try {
      const response = await authFetch('/api/auth/me');
      if (response.ok) {
        const user = await response.json();
        if (user.is_admin) {
          setIsAdmin(true);
          fetchAllUsers();
        } else {
          router.push('/dashboard');
        }
      } else {
        router.push('/auth');
      }
    } catch (error) {
      console.error('Error checking admin access:', error);
      router.push('/auth');
    }
  };

  const fetchAllUsers = async () => {
    try {
      const response = await authFetch('/api/admin/users');
      if (response.ok) {
        const data = await response.json();
        setUsers(Array.isArray(data) ? data : data.users || []);
        setUnlinkedAgents(Array.isArray(data) ? [] : data.unlinkedAgents || []);
      }
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSuspendToggle = async (user: { id: string; email: string; suspended?: boolean }) => {
    const action = user.suspended ? 'reactivate' : 'suspend';
    if (action === 'suspend' && !window.confirm(`Suspend ${user.email}? They will not be able to sign in until reactivated.`)) {
      return;
    }
    setActionError(null);
    setActionLoadingId(user.id);
    try {
      const response = await authFetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update user');
      }
      const markSuspended = <T extends { id: string; suspended?: boolean }>(list: T[]) =>
        list.map(u => (u.id === user.id ? { ...u, suspended: data.suspended } : u));
      setUsers(prev =>
        markSuspended(prev).map(u => ({ ...u, portal_agents: u.portal_agents ? markSuspended(u.portal_agents) : u.portal_agents }))
      );
      setUnlinkedAgents(prev => markSuspended(prev));
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      console.error('Error updating suspension state:', error);
      setActionError(error instanceof Error ? error.message : 'Failed to update user');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handlePlanChange = async (user: TCUser, newPlan: string) => {
    if (newPlan === (user.plan || 'starter')) return;
    const billingNote = user.stripe_subscription_id
      ? '\n\nNote: this user has a live Stripe subscription. Changing the plan here does NOT change or cancel their billing.'
      : '';
    if (!window.confirm(`Change ${user.email} from ${getPlan(user.plan).name} to ${getPlan(newPlan).name}?${billingNote}`)) {
      return;
    }
    setActionError(null);
    setActionLoadingId(user.id);
    try {
      const response = await authFetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_plan', plan: newPlan }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Failed to change plan');
      }
      setUsers(prev => prev.map(u => (u.id === user.id ? { ...u, plan: data.plan } : u)));
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      console.error('Error changing plan:', error);
      setActionError(error instanceof Error ? error.message : 'Failed to change plan');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDelete = async (user: { id: string; email: string }) => {
    const typed = window.prompt(
      `PERMANENTLY delete ${user.email} and ALL of their data (deals, documents, agents, invoices, subscription)? This cannot be undone.\n\nType their email to confirm:`
    );
    if (typed === null) return;
    setActionError(null);
    setActionLoadingId(user.id);
    try {
      const response = await authFetch(`/api/admin/users/${user.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmEmail: typed }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete user');
      }
      setUsers(prev =>
        prev
          .filter(u => u.id !== user.id)
          .map(u => ({ ...u, portal_agents: u.portal_agents?.filter(a => a.id !== user.id) }))
      );
      setUnlinkedAgents(prev => prev.filter(a => a.id !== user.id));
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      console.error('Error deleting user:', error);
      setActionError(error instanceof Error ? error.message : 'Failed to delete user');
    } finally {
      setActionLoadingId(null);
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-4 md:p-8">
        <div className="text-center">
          <p className="text-red-400">Access Denied</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 md:p-8">
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full border-4 border-slate-600 border-t-blue-400 animate-spin mx-auto mb-4" />
            <p className="text-slate-400">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl font-display font-semibold text-slate-100 mb-1">Admin Panel</h1>
        <p className="text-slate-400">Manage all TC users and accounts</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6">
          <div className="text-sm text-slate-400 mb-2">TC Users</div>
          <div className="text-3xl font-bold text-blue-400">{users.length}</div>
        </div>

        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6">
          <div className="text-sm text-slate-400 mb-2">Admin Users</div>
          <div className="text-3xl font-bold text-purple-400">
            {users.filter(u => u.is_admin).length}
          </div>
        </div>

        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6">
          <div className="text-sm text-slate-400 mb-2">Agent Logins</div>
          <div className="text-3xl font-bold text-green-400">
            {users.reduce((sum, u) => sum + (u.portal_agents?.length || 0), 0) + unlinkedAgents.length}
          </div>
        </div>

        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6">
          <div className="text-sm text-slate-400 mb-2">Revenue Collected (All Users)</div>
          <div className="text-3xl font-bold text-green-400">
            ${users.reduce((sum, u) => sum + (u.revenue_collected || 0), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
        </div>
      </div>

      {actionError && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-900/30 border border-red-700/50 text-red-300 text-sm">
          {actionError}
        </div>
      )}

      {/* Users Table */}
      <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-600 bg-slate-800/50">
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Email</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Role</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Plan</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Subscription</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Trial</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Joined</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Last Active</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Agents</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Active</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Closed</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Revenue</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300" title="AI document reads: contracts, listing agreements and offer packages">AI reads</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => {
                const agentCount = (user.portal_agents?.length || 0) + (user.agent_profiles?.length || 0);
                const isOpen = !!expanded[user.id];
                return (
                <Fragment key={user.id}>
                <tr className="border-b border-slate-600 hover:bg-slate-700/50 transition">
                  <td className="px-6 py-4 text-slate-300">
                    <div className="flex items-center gap-2">
                      {agentCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => setExpanded(prev => ({ ...prev, [user.id]: !prev[user.id] }))}
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? 'Hide' : 'Show'} agents for ${user.email}`}
                          className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-slate-100 hover:bg-slate-600 transition"
                        >
                          <svg className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                            <path d="M7 4l8 6-8 6V4z" />
                          </svg>
                        </button>
                      ) : (
                        <span className="w-5 shrink-0" />
                      )}
                      <span>{user.email}</span>
                    </div>
                    {user.suspended && (
                      <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-900/30 text-red-300">
                        Suspended
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      user.is_admin
                        ? 'bg-purple-900/30 text-purple-300'
                        : 'bg-blue-900/30 text-blue-300'
                    }`}>
                      {user.is_admin ? 'Admin' : 'User'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate-300 text-sm">
                    <select
                      value={user.plan || 'starter'}
                      onChange={(e) => handlePlanChange(user, e.target.value)}
                      disabled={actionLoadingId === user.id}
                      aria-label={`Plan for ${user.email}`}
                      className="bg-slate-700 border border-slate-600 rounded-md px-2 py-1 text-sm text-slate-100 disabled:opacity-50"
                    >
                      {(['starter', 'pro', 'team', ...(user.plan === 'brokerage' ? (['brokerage'] as const) : [])] as const).map((id) => (
                        <option key={id} value={id}>
                          {getPlan(id).name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {user.subscription_status ? (
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                        SUBSCRIPTION_BADGE_STYLES[user.subscription_status] || 'bg-slate-700 text-slate-300'
                      }`}>
                        {user.subscription_status.replace(/_/g, ' ')}
                      </span>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {user.trial?.applies ? (
                      <span className={user.trial.expired ? 'text-red-400' : 'text-slate-300'}>
                        {user.trial.expired ? 'Expired' : 'Active'}
                        {user.trial.trialEndsAt && (
                          <span className="block text-slate-500 text-xs">
                            {user.trial.expired ? 'ended' : 'ends'} {new Date(user.trial.trialEndsAt).toLocaleDateString()}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-slate-400 text-sm">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-slate-400 text-sm">
                    {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-6 py-4 text-slate-300">{user.agents_count || 0}</td>
                  <td className="px-6 py-4 text-slate-300">{user.active_transactions || 0}</td>
                  <td className="px-6 py-4 text-slate-300">{user.closed_transactions || 0}</td>
                  <td className="px-6 py-4 text-slate-300">
                    ${(user.revenue_collected || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                  <td
                    className="px-6 py-4 text-slate-300"
                    title={
                      user.ai_reads
                        ? `${user.ai_reads_30d || 0} in the last 30 days · about ${(user.ai_tokens || 0).toLocaleString()} tokens in total · last used ${user.ai_last_used ? new Date(user.ai_last_used).toLocaleString() : 'unknown'}`
                        : 'No AI reads recorded'
                    }
                  >
                    {user.ai_reads || 0}
                    {!!user.ai_reads && <span className="block text-xs text-slate-500">{user.ai_reads_30d || 0} in 30d</span>}
                  </td>
                  <td className="px-6 py-4">
                    {user.is_admin ? (
                      <span className="text-slate-600 text-xs">—</span>
                    ) : (
                      <button
                        onClick={() => handleSuspendToggle(user)}
                        disabled={actionLoadingId === user.id}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${
                          user.suspended
                            ? 'bg-green-900/30 text-green-300 hover:bg-green-900/50'
                            : 'bg-red-900/30 text-red-300 hover:bg-red-900/50'
                        }`}
                      >
                        {actionLoadingId === user.id ? 'Working…' : user.suspended ? 'Reactivate' : 'Suspend'}
                      </button>
                    )}
                    {!user.is_admin && (
                      <button
                        onClick={() => handleDelete(user)}
                        disabled={actionLoadingId === user.id}
                        className="ml-2 px-3 py-1.5 rounded-md text-xs font-medium transition bg-slate-700/60 text-slate-300 hover:bg-red-900/50 hover:text-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-slate-600 bg-slate-800/60">
                    <td colSpan={13} className="px-6 py-4">
                      <div className="ml-7 space-y-4">
                        <div>
                          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                            Agent logins ({user.portal_agents?.length || 0})
                          </p>
                          {(user.portal_agents?.length || 0) === 0 ? (
                            <p className="text-sm text-slate-500">No agents have accepted a portal invite from this user.</p>
                          ) : (
                            <div className="space-y-1.5">
                              {user.portal_agents!.map(agent => (
                                <AgentRow
                                  key={agent.id}
                                  agent={agent}
                                  busy={actionLoadingId === agent.id}
                                  onSuspend={() => handleSuspendToggle(agent)}
                                  onDelete={() => handleDelete(agent)}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                            Agent profiles ({user.agent_profiles?.length || 0})
                          </p>
                          {(user.agent_profiles?.length || 0) === 0 ? (
                            <p className="text-sm text-slate-500">No agent profiles yet.</p>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {user.agent_profiles!.map(profile => (
                                <span key={profile.id} className="px-3 py-1.5 rounded-lg bg-slate-700/50 border border-slate-600 text-sm text-slate-300">
                                  {profile.name || 'Unnamed'}
                                  {profile.email ? <span className="text-slate-500"> · {profile.email}</span> : null}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {unlinkedAgents.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-slate-100 mb-1">Agent logins not linked to a TC</h2>
          <p className="text-sm text-slate-400 mb-3">Agent accounts that are not on any deal right now.</p>
          <div className="space-y-1.5">
            {unlinkedAgents.map(agent => (
              <AgentRow
                key={agent.id}
                agent={agent}
                busy={actionLoadingId === agent.id}
                onSuspend={() => handleSuspendToggle(agent)}
                onDelete={() => handleDelete(agent)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AgentRow({
  agent,
  busy,
  onSuspend,
  onDelete,
}: {
  agent: AgentAccount;
  busy: boolean;
  onSuspend: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-slate-700/40 border border-slate-600 rounded-lg">
      <div className="min-w-0">
        <p className="text-sm text-slate-100 truncate">
          {agent.email}
          {agent.suspended && (
            <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-red-900/30 text-red-300">Suspended</span>
          )}
        </p>
        <p className="text-xs text-slate-500">
          {agent.deals > 0 ? `${agent.deals} deal${agent.deals === 1 ? '' : 's'} · ` : ''}
          joined {new Date(agent.created_at).toLocaleDateString()} · last active{' '}
          {agent.last_sign_in_at ? new Date(agent.last_sign_in_at).toLocaleDateString() : 'never'}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onSuspend}
          disabled={busy}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${
            agent.suspended
              ? 'bg-green-900/30 text-green-300 hover:bg-green-900/50'
              : 'bg-red-900/30 text-red-300 hover:bg-red-900/50'
          }`}
        >
          {busy ? 'Working…' : agent.suspended ? 'Reactivate' : 'Suspend'}
        </button>
        <button
          onClick={onDelete}
          disabled={busy}
          className="px-3 py-1.5 rounded-md text-xs font-medium transition bg-slate-700/60 text-slate-300 hover:bg-red-900/50 hover:text-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
