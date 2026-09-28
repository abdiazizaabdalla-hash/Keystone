'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { PLANS } from '@/lib/plans';

interface AccountSummary {
  email: string;
  createdAt: string;
  plan: { id: string; name: string };
  usage: {
    agents: number;
    maxAgents: number | null;
    activeTransactions: number;
    maxActiveTransactions: number | null;
    totalTransactions: number;
  } | null;
  billing: {
    hasSubscription: boolean;
    status: string | null;
    currentPeriodEnd: string | null;
    isTeamMember: boolean;
  };
  trial: {
    applies: boolean;
    trialEndsAt: string | null;
    expired: boolean;
    endedBy: 'time' | 'first_paid_deal' | null;
    daysLeft: number | null;
  } | null;
}

function UsageBar({ label, used, max }: { label: string; used: number; max: number | null }) {
  const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-2">
        <span className="text-sm text-slate-300">{label}</span>
        <span className="text-sm text-slate-400">
          {used} {max !== null ? `/ ${max}` : '· Unlimited'}
        </span>
      </div>
      {max !== null && (
        <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
          <div
            className={`h-full rounded-full ${pct >= 100 ? 'bg-red-500' : 'bg-blue-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function AccountContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const checkoutResult = searchParams.get('checkout');

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [error, setError] = useState('');
  const [redirecting, setRedirecting] = useState<string | null>(null);

  const fetchSummary = async () => {
    try {
      const res = await authFetch('/api/account/summary');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load account');
      setSummary(data);
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load account');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCheckout = async (plan: 'starter' | 'pro' | 'team') => {
    setRedirecting(plan);
    try {
      const res = await authFetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start checkout');
      window.location.href = data.url;
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to start checkout');
      setRedirecting(null);
    }
  };

  const openBillingPortal = async () => {
    setRedirecting('portal');
    try {
      const res = await authFetch('/api/stripe/portal', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to open billing portal');
      window.location.href = data.url;
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to open billing portal');
      setRedirecting(null);
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full border-4 border-slate-600 border-t-blue-400 animate-spin mx-auto mb-4" />
            <p className="text-slate-400">Loading account…</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="p-8 max-w-2xl">
        <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-200 text-sm">
          {error || 'Could not load your account.'}
        </div>
      </div>
    );
  }

  const memberSince = new Date(summary.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const otherPlans = PLANS.filter((p) => p.id !== summary.plan.id && p.id !== 'starter');

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-3xl font-display font-semibold text-slate-100 mb-1">Account</h1>
        <p className="text-slate-400">Your plan, billing, and usage at a glance</p>
      </div>

      {checkoutResult === 'success' && (
        <div className="mb-6 p-4 bg-emerald-900/30 border border-emerald-700 rounded-lg text-emerald-200 text-sm">
          Payment received — your plan will update within a few seconds.
        </div>
      )}
      {checkoutResult === 'cancelled' && (
        <div className="mb-6 p-4 bg-slate-700/50 border border-slate-600 rounded-lg text-slate-300 text-sm">
          Checkout was cancelled — no charge was made.
        </div>
      )}

      <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-6 mb-6 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="text-sm text-slate-400">Email</span>
          <span className="text-sm text-slate-100 break-all">{summary.email}</span>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="text-sm text-slate-400">Plan</span>
          <span className="text-sm text-slate-100 font-semibold">{summary.plan.name}</span>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="text-sm text-slate-400">Member since</span>
          <span className="text-sm text-slate-100">{memberSince}</span>
        </div>
        {summary.billing.status && (
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-sm text-slate-400">Subscription status</span>
            <span className="text-sm text-slate-100 capitalize">{summary.billing.status.replace('_', ' ')}</span>
          </div>
        )}
      </div>

      {/* Trial status (Starter only, while it still applies) */}
      {summary.trial?.applies && (
        <div
          className={`rounded-lg p-6 mb-6 border ${
            summary.trial.expired
              ? 'bg-red-900/30 border-red-700'
              : 'bg-blue-900/20 border-blue-700/60'
          }`}
        >
          {summary.trial.expired ? (
            <>
              <p className="text-sm text-red-200 font-semibold mb-1">Your free trial has ended</p>
              <p className="text-sm text-red-200/80 mb-4">
                Add payment to keep creating and editing transactions, agents, and invoices on Starter.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-blue-200 font-semibold mb-1">
                {summary.trial.daysLeft === 0
                  ? 'Your free trial ends today'
                  : `${summary.trial.daysLeft} day${summary.trial.daysLeft === 1 ? '' : 's'} left in your free trial`}
              </p>
              <p className="text-sm text-blue-200/80 mb-4">
                Free for 30 days or until your first paid deal closes, whichever comes first. Then it&apos;s $10/month.
              </p>
            </>
          )}
          <button
            onClick={() => startCheckout('starter')}
            disabled={redirecting !== null}
            className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
          >
            {redirecting === 'starter'
              ? 'Redirecting…'
              : summary.trial.expired
              ? 'Add payment — $10/month'
              : 'Continue on Starter — $10/month'}
          </button>
        </div>
      )}

      {/* Billing actions */}
      <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-6 mb-6 space-y-4">
        <h2 className="text-lg font-display font-semibold text-slate-100">Billing</h2>

        {summary.billing.hasSubscription ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-slate-400">Update your card, view invoices, or cancel your subscription.</p>
            <button
              onClick={openBillingPortal}
              disabled={redirecting !== null}
              className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50 whitespace-nowrap"
            >
              {redirecting === 'portal' ? 'Opening…' : 'Manage billing'}
            </button>
          </div>
        ) : summary.billing.isTeamMember ? (
          <p className="text-sm text-slate-400">
            You&apos;re on the Team plan as a member. Billing is managed by your team&apos;s owner.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-400">
              {summary.plan.id === 'starter'
                ? "You're on the Starter plan. Upgrade for unlimited transactions and agents."
                : `You're on the ${summary.plan.name} plan.`}
            </p>
            {otherPlans.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {otherPlans.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => startCheckout(p.id as 'starter' | 'pro' | 'team')}
                    disabled={redirecting !== null}
                    className="px-5 py-2.5 border border-blue-500 text-blue-400 hover:bg-blue-500/10 text-sm font-semibold rounded-lg transition disabled:opacity-50"
                  >
                    {redirecting === p.id
                      ? 'Redirecting…'
                      : p.id === 'team'
                      ? 'Upgrade to Team ($57/month for 3 seats)'
                      : `Upgrade to ${p.name} (${p.price}${p.period})`}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Usage (Pro/Team perk) */}
      {summary.usage ? (
        <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-6 space-y-6">
          <h2 className="text-lg font-display font-semibold text-slate-100">Usage</h2>
          <UsageBar label="Agent profiles" used={summary.usage.agents} max={summary.usage.maxAgents} />
          <UsageBar
            label="Active transactions"
            used={summary.usage.activeTransactions}
            max={summary.usage.maxActiveTransactions}
          />
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pt-2 border-t border-slate-600">
            <span className="text-sm text-slate-300">Total transactions (all-time)</span>
            <span className="text-sm text-slate-400">{summary.usage.totalTransactions}</span>
          </div>
        </div>
      ) : (
        <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-6 text-center">
          <p className="text-sm text-slate-400">A detailed usage breakdown — agents, active transactions, and plan limits — is available on Pro and Team.</p>
        </div>
      )}

      <p className="text-xs text-slate-500 mt-6">
        Looking for other preferences, like default agent fees? Head to{' '}
        <Link href="/dashboard/settings" className="text-blue-400 hover:text-blue-300">
          Settings
        </Link>
        .
      </p>
    </div>
  );
}

export default function AccountPage() {
  return (
    <Suspense fallback={null}>
      <AccountContent />
    </Suspense>
  );
}
