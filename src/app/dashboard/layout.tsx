'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getValidToken, clearSession, authFetch } from '@/lib/authClient';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [userName, setUserName] = useState('');
  const [plan, setPlan] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [trial, setTrial] = useState<{
    applies: boolean;
    trialEndsAt: string | null;
    expired: boolean;
    endedBy: 'time' | 'first_paid_deal' | null;
    daysLeft: number | null;
  } | null>(null);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      // getValidToken transparently refreshes an expired/expiring token
      // using the stored refresh_token, so a session doesn't silently break
      // an hour into use.
      const token = await getValidToken();
      if (!token) {
        router.push('/auth');
        return;
      }
      setIsLoading(false);

      try {
        const res = await authFetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setPlan(data.plan || 'starter');
          setTrial(data.trial || null);
          setUserName(data.fullName || data.email || '');
          setIsAdmin(Boolean(data.is_admin));
        }
      } catch {
        // Non-critical — the plan badge just won't show.
      }
    };

    checkAuth();
  }, [router]);

  const handleLogout = () => {
    clearSession();
    router.push('/auth');
  };

  // Starts Checkout for the $10/mo Starter price -- used by the trial
  // banner's "Add payment" button once the trial's actually expired. Same
  // flow the Account page uses for Pro/Team, just with plan: 'starter'.
  const startStarterCheckout = async () => {
    setStartingCheckout(true);
    try {
      const res = await authFetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'starter' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start checkout');
      window.location.href = data.url;
    } catch {
      setStartingCheckout(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-4 border-slate-600 border-t-blue-400 animate-spin mx-auto mb-4" />
          <p className="text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex">
      {/* Sidebar */}
      <div className="w-64 bg-gradient-to-b from-slate-800 to-slate-900 border-r border-slate-700 flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-slate-700">
          <Link href="/dashboard" className="flex items-center gap-3">
            <span className="w-10 h-10 bg-white rounded-lg flex items-center justify-center p-1.5 shadow-sm shrink-0">
              <img src="/relay-icon.png" alt="Relay TC" className="w-full h-full object-contain" />
            </span>
            <div>
              <h1 className="text-white font-display font-semibold text-lg">Relay TC</h1>
              <p className="text-xs text-slate-400">Transaction Coordinator</p>
            </div>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-6 space-y-2">
          <Link
            href="/dashboard"
            className="flex items-center gap-3 px-4 py-3 text-slate-100 hover:bg-slate-700 rounded-lg transition font-medium"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4z" />
              <path
                fillRule="evenodd"
                d="M3 10a1 1 0 011-1h12a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6z"
                clipRule="evenodd"
              />
            </svg>
            Dashboard
          </Link>

          <Link
            href="/dashboard/transactions"
            className="flex items-center gap-3 px-4 py-3 text-slate-100 hover:bg-slate-700 rounded-lg transition font-medium"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5z" />
              <path d="M13 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2h-2z" />
              <path d="M5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5z" />
              <path d="M13 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2h-2z" />
            </svg>
            Transactions
          </Link>

          <Link
            href="/dashboard/agents"
            className="flex items-center gap-3 px-4 py-3 text-slate-100 hover:bg-slate-700 rounded-lg transition font-medium"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
            </svg>
            Agents
          </Link>

          <Link
            href="/dashboard/invoices"
            className="flex items-center gap-3 px-4 py-3 text-slate-100 hover:bg-slate-700 rounded-lg transition font-medium"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z"
                clipRule="evenodd"
              />
            </svg>
            Invoices
          </Link>

          <Link
            href="/dashboard/settings"
            className="flex items-center gap-3 px-4 py-3 text-slate-100 hover:bg-slate-700 rounded-lg transition font-medium"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
                clipRule="evenodd"
              />
            </svg>
            Settings
          </Link>

          {plan === 'team' && (
            <Link
              href="/dashboard/collaborate"
              className="flex items-center gap-3 px-4 py-3 text-slate-100 hover:bg-slate-700 rounded-lg transition font-medium"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
              </svg>
              Collaborate
            </Link>
          )}

          <Link
            href="/dashboard/account"
            className="flex items-center gap-3 px-4 py-3 text-slate-100 hover:bg-slate-700 rounded-lg transition font-medium"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                clipRule="evenodd"
              />
              <path d="M15.5 8.5a1 1 0 10-2 0v.5h-.5a1 1 0 100 2h.5v.5a1 1 0 102 0v-.5h.5a1 1 0 100-2h-.5v-.5z" />
            </svg>
            Account
          </Link>

          {isAdmin && (
            <Link
              href="/dashboard/admin"
              className="flex items-center gap-3 px-4 py-3 text-amber-200 hover:bg-amber-900/30 rounded-lg transition font-medium"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 1L3 5v6c0 4.42 3.05 8.24 7 9 3.95-.76 7-4.58 7-9V5l-7-4zm0 8a2 2 0 110-4 2 2 0 010 4zm0 1c-2.21 0-4 1.34-4 3v1h8v-1c0-1.66-1.79-3-4-3z"
                  clipRule="evenodd"
                />
              </svg>
              Admin
            </Link>
          )}

        </nav>

        {/* User Section */}
        <div className="p-4 border-t border-slate-700 space-y-3">
          {userName && (
            <div className="px-4">
              <p className="text-sm font-semibold text-slate-100 truncate">{userName}</p>
            </div>
          )}
          {plan && (
            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-700/60 border border-slate-600 rounded-lg">
              <span className="text-xs text-slate-400">
                <span className="text-slate-200 font-semibold capitalize">{plan}</span> plan
              </span>
              <Link href="/dashboard/account" className="text-xs text-blue-400 hover:text-blue-300 font-medium">
                {plan === 'starter' ? 'Upgrade' : 'Manage'}
              </Link>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-4 py-2 text-slate-300 hover:bg-red-900/30 hover:text-red-300 rounded-lg transition text-sm"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M3 3a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1V4a1 1 0 00-1-1H3zm11 4.414l-4.293 4.293a1 1 0 001.414 1.414L15.414 9l-4.293-4.293a1 1 0 00-1.414 1.414L13.586 9l-4.293 4.293a1 1 0 001.414 1.414L15.414 11l-4.293-4.293a1 1 0 10-1.414-1.414z"
                clipRule="evenodd"
              />
            </svg>
            Logout
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        {trial?.applies && trial.expired && (
          <div className="px-6 py-3 bg-red-900/40 border-b border-red-700 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-red-200">
              Your free Starter trial has ended. Add payment to keep creating and editing on Relay.
            </p>
            <button
              onClick={startStarterCheckout}
              disabled={startingCheckout}
              className="px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50 whitespace-nowrap"
            >
              {startingCheckout ? 'Redirecting…' : 'Add payment — $10/month'}
            </button>
          </div>
        )}
        {trial?.applies && !trial.expired && trial.daysLeft !== null && trial.daysLeft <= 7 && (
          <div className="px-6 py-2.5 bg-blue-900/30 border-b border-blue-700/60 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-blue-200">
              {trial.daysLeft === 0
                ? 'Your free Starter trial ends today.'
                : `Your free Starter trial ends in ${trial.daysLeft} day${trial.daysLeft === 1 ? '' : 's'}.`}{' '}
              Then it&apos;s $10/month to keep going.
            </p>
            <Link href="/dashboard/account" className="text-xs text-blue-300 hover:text-blue-200 font-medium whitespace-nowrap">
              Manage billing
            </Link>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
