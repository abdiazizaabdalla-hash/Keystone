'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { getPlan } from '@/lib/plans';

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
        setUsers(data);
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

  const handleSuspendToggle = async (user: TCUser) => {
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
      setUsers(prev => prev.map(u => (u.id === user.id ? { ...u, suspended: data.suspended } : u)));
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

  if (!isAdmin) {
    return (
      <div className="p-8">
        <div className="text-center">
          <p className="text-red-400">Access Denied</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-8">
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
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-display font-semibold text-slate-100 mb-1">Admin Panel</h1>
        <p className="text-slate-400">Manage all TC users and accounts</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6">
          <div className="text-sm text-slate-400 mb-2">Total Users</div>
          <div className="text-3xl font-bold text-blue-400">{users.length}</div>
        </div>

        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6">
          <div className="text-sm text-slate-400 mb-2">Admin Users</div>
          <div className="text-3xl font-bold text-purple-400">
            {users.filter(u => u.is_admin).length}
          </div>
        </div>

        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6">
          <div className="text-sm text-slate-400 mb-2">Regular Users</div>
          <div className="text-3xl font-bold text-green-400">
            {users.filter(u => !u.is_admin).length}
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
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id} className="border-b border-slate-600 hover:bg-slate-700/50 transition">
                  <td className="px-6 py-4 text-slate-300">
                    <div>{user.email}</div>
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
                  <td className="px-6 py-4 text-slate-300 text-sm">{getPlan(user.plan).name}</td>
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
