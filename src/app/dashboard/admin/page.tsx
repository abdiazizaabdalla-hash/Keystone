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
  agents_count?: number;
  active_transactions?: number;
  closed_transactions?: number;
  revenue_collected?: number;
}

export default function AdminPage() {
  const router = useRouter();
  const [users, setUsers] = useState<TCUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

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

      {/* Users Table */}
      <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-600 bg-slate-800/50">
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Email</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Role</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Plan</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Joined</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Agents</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Active</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Closed</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-300">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id} className="border-b border-slate-600 hover:bg-slate-700/50 transition">
                  <td className="px-6 py-4 text-slate-300">{user.email}</td>
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
                  <td className="px-6 py-4 text-slate-400 text-sm">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-slate-300">{user.agents_count || 0}</td>
                  <td className="px-6 py-4 text-slate-300">{user.active_transactions || 0}</td>
                  <td className="px-6 py-4 text-slate-300">{user.closed_transactions || 0}</td>
                  <td className="px-6 py-4 text-slate-300">
                    ${(user.revenue_collected || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
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
