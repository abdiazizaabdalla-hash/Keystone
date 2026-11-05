'use client';

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';

// The brokerage owner's account status at the top of Collaborate: pilot days left, or what to do once it has ended, with a way to ask
// for the upgrade. Shows nothing for an account that is not under a pilot or plan yet, or one that is already on the paid plan.

interface Account {
  status: 'pilot' | 'pilot_expired' | 'converted' | 'terminated';
  endsOn: string | null;
  daysLeft: number | null;
  canRequestUpgrade: boolean;
  upgradeRequested: boolean;
  seats: { active: number; pending: number; limit: number };
}

const fmt = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '');

export default function BrokerageAccountBanner() {
  const [account, setAccount] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await authFetch('/api/brokerage/account');
    if (!res.ok) return;
    setAccount(((await res.json()) as { account: Account | null }).account);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      load().catch(() => {});
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const requestUpgrade = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await authFetch('/api/brokerage/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'request_upgrade' }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not send the request');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the request');
    } finally {
      setBusy(false);
    }
  };

  if (!account || account.status === 'converted') return null;

  const ended = account.status === 'pilot_expired';
  const paused = account.status === 'terminated';
  const soon = account.status === 'pilot' && (account.daysLeft ?? 99) <= 7;
  const tone = ended || paused || soon ? 'bg-amber-500/10 border-amber-500/30' : 'bg-blue-500/10 border-blue-500/30';

  return (
    <div className={`mb-5 rounded-2xl border px-5 py-4 flex flex-wrap items-center justify-between gap-3 ${tone}`} role="status">
      <div className="text-sm">
        {account.status === 'pilot' && (
          <>
            <p className="text-slate-100 font-semibold">Brokerage Pro pilot: {account.daysLeft} {account.daysLeft === 1 ? 'day' : 'days'} left</p>
            <p className="text-slate-400">Full Pro until {fmt(account.endsOn)}, up to {account.seats.limit} agents ({account.seats.active} joined{account.seats.pending ? `, ${account.seats.pending} invited` : ''}). No payment needed and nothing renews automatically.</p>
          </>
        )}
        {ended && (
          <>
            <p className="text-slate-100 font-semibold">Your pilot has ended</p>
            <p className="text-slate-300">Your agents, deals, reviews and messages are all still here and readable. Inviting agents, file review and commission actions are paused until you upgrade to Brokerage Pro ($199/month).</p>
          </>
        )}
        {paused && (
          <>
            <p className="text-slate-100 font-semibold">This brokerage account is paused</p>
            <p className="text-slate-300">Your agents and records are untouched and stay readable. Contact Relay to reopen it.</p>
          </>
        )}
        {error && <p className="text-red-300 mt-1">{error}</p>}
      </div>
      {account.canRequestUpgrade && (
        account.upgradeRequested ? (
          <p className="text-sm text-emerald-300">Upgrade requested. We will be in touch.</p>
        ) : (
          <button type="button" disabled={busy} onClick={requestUpgrade} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition whitespace-nowrap">
            {busy ? 'Sending…' : 'Request upgrade to Brokerage Pro'}
          </button>
        )
      )}
    </div>
  );
}
