'use client';

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { BROKERAGE_PRICING } from '@/lib/brokeragePricing';

// The brokerage owner's account status at the top of Collaborate: pilot days left, or what to do once it has ended, with a way to ask
// for the upgrade. Shows nothing for an account that is not under a pilot or plan yet, or one that is already on the paid plan.

interface Account {
  tier?: 'basic' | 'pro';
  status: 'pilot' | 'pilot_expired' | 'converted' | 'terminated';
  endsOn: string | null;
  daysLeft: number | null;
  canRequestUpgrade: boolean;
  upgradeRequested: boolean;
  seats: { active: number; pending: number; limit: number };
  billing?: { ready: { basic: boolean; pro: boolean }; subscribed: boolean; extraSeats: number };
}

const fmt = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '');

export default function BrokerageAccountBanner() {
  const [account, setAccount] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [extra, setExtra] = useState<number | null>(null);

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

  // Sends the owner to Stripe Checkout for a tier, or to the billing portal. Nothing changes on the account until Stripe confirms.
  const goTo = async (url: string, body: object | null, failure: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await authFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || failure);
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : failure);
      setBusy(false);
    }
  };
  const subscribe = (tier: 'basic' | 'pro') => goTo('/api/stripe/brokerage/checkout', { tier }, 'Could not start checkout');
  const manageBilling = () => goTo('/api/stripe/portal', null, 'Could not open billing');

  const saveExtra = async (value: number) => {
    setBusy(true);
    setError('');
    try {
      const res = await authFetch('/api/brokerage/account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set_extra_seats', extraSeats: value }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not change your agents');
      setExtra(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change your agents');
    } finally {
      setBusy(false);
    }
  };

  if (!account) return null;
  const planLabel = account.tier === 'basic' ? 'Brokerage' : 'Brokerage Pro';
  const room = Math.max(0, account.seats.limit - account.seats.active - account.seats.pending);
  const seatLine = `${account.seats.active} joined${account.seats.pending ? `, ${account.seats.pending} invited` : ''} of ${account.seats.limit} agents included. You can invite ${room} more.`;
  if (account.status === 'converted') {
    const billing = account.billing;
    const tier = account.tier === 'basic' ? 'basic' : 'pro';
    const price = BROKERAGE_PRICING[tier];
    const current = billing?.extraSeats ?? 0;
    const shown = extra ?? current;
    return (
      <div className="mb-5 rounded-2xl border border-blue-500/30 bg-blue-500/10 px-5 py-3 text-sm" role="status">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-slate-100 font-semibold">{planLabel}</p>
            <p className="text-slate-400">{seatLine}</p>
          </div>
          {billing?.subscribed && (
            <button type="button" disabled={busy} onClick={manageBilling} className="px-4 py-2 border border-slate-500 hover:border-slate-300 disabled:opacity-50 text-slate-100 text-sm font-semibold rounded-lg transition">
              Manage billing
            </button>
          )}
        </div>
        {billing?.subscribed && (
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-blue-500/20 pt-3">
            <span className="text-slate-300">Extra agents beyond the {price.includedAgents} included, ${price.extraAgent} each per month:</span>
            <input type="number" min={0} max={500} value={shown} onChange={(e) => setExtra(Math.max(0, Math.floor(Number(e.target.value) || 0)))} aria-label="Extra agents" className="w-20 bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-slate-100" />
            {shown !== current && (
              <button type="button" disabled={busy} onClick={() => saveExtra(shown)} className="px-3 py-1.5 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition">
                {busy ? 'Saving…' : `Save (${shown} extra)`}
              </button>
            )}
          </div>
        )}
        {error && <p className="text-red-300 mt-2">{error}</p>}
      </div>
    );
  }

  const ended = account.status === 'pilot_expired';
  const paused = account.status === 'terminated';
  const soon = account.status === 'pilot' && (account.daysLeft ?? 99) <= 7;
  const tone = ended || paused || soon ? 'bg-amber-500/10 border-amber-500/30' : 'bg-blue-500/10 border-blue-500/30';

  return (
    <div className={`mb-5 rounded-2xl border px-5 py-4 flex flex-wrap items-center justify-between gap-3 ${tone}`} role="status">
      <div className="text-sm">
        {account.status === 'pilot' && (
          <>
            <p className="text-slate-100 font-semibold">{planLabel} pilot: {account.daysLeft} {account.daysLeft === 1 ? 'day' : 'days'} left</p>
            <p className="text-slate-400">{account.tier === 'basic' ? 'Brokerage' : 'Full Pro'} until {fmt(account.endsOn)}. {seatLine} No payment needed and nothing renews automatically.</p>
          </>
        )}
        {ended && (
          <>
            <p className="text-slate-100 font-semibold">Your pilot has ended</p>
            <p className="text-slate-300">Your agents, deals, reviews and messages are all still here and readable. Inviting agents, file review and commission actions are paused, and your agents&apos; workspaces are read-only (they can read and message, not add or change deals) until you upgrade to Brokerage Pro ($199/month).</p>
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
      {/* During the pilot they already have full Pro, so there is nothing to buy; the choice returns once it has ended. */}
      {account.status !== 'pilot' && (account.billing?.ready.basic || account.billing?.ready.pro) && (
        <div className="flex flex-wrap gap-2">
          {account.billing?.ready.pro && (
            <button type="button" disabled={busy} onClick={() => subscribe('pro')} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition">
              {busy ? 'Opening…' : `Subscribe to Brokerage Pro, $${BROKERAGE_PRICING.pro.base}/month`}
            </button>
          )}
          {account.billing?.ready.basic && (
            <button type="button" disabled={busy} onClick={() => subscribe('basic')} className="px-4 py-2 border border-slate-500 hover:border-slate-300 disabled:opacity-50 text-slate-100 text-sm font-semibold rounded-lg transition">
              {`Subscribe to Brokerage, $${BROKERAGE_PRICING.basic.base}/month`}
            </button>
          )}
        </div>
      )}
      {account.status !== 'pilot' && !(account.billing?.ready.basic || account.billing?.ready.pro) && account.canRequestUpgrade && (
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
