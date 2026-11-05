'use client';

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';

// An agent's brokerage membership (Collaborate → Brokerage): invitations to accept or decline, who they are with, what the
// brokerage can see and change, and leaving. Commission statements are not here: they live in Invoices and on each deal.

interface Owner { id: string; name: string; email: string | null }
interface Terms { sees: string[]; canDo: string[]; private: string[]; leave: string }
interface Data { current: { id: string; owner: Owner; since: string | null; paused?: boolean } | null; invites: { id: string; owner: Owner; invitedAt: string }[]; terms: Terms }

const card = 'bg-white/5 border border-white/10 rounded-2xl p-5';

export default function BrokerageMembership({ onChanged }: { onChanged?: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const res = await authFetch('/api/brokerage');
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Could not load this page');
    setData(body);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load this page'));
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const act = async (id: string, action: 'accept' | 'decline' | 'leave') => {
    if (action === 'leave' && !window.confirm('Leave this brokerage? They will no longer see your deals. Your deals stay yours.')) return;
    setBusy(id);
    setError('');
    try {
      const res = await authFetch(`/api/brokerage/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not do that');
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not do that');
    } finally {
      setBusy('');
    }
  };

  if (!data) return <p className="text-sm text-slate-400">{error || 'Loading…'}</p>;

  const terms = (
    <div className="grid md:grid-cols-3 gap-4 text-sm">
      <div>
        <p className="font-semibold text-slate-100 mb-1">They can see</p>
        <ul className="list-disc ml-5 space-y-1 text-slate-300">{data.terms.sees.map((l) => <li key={l}>{l}</li>)}</ul>
      </div>
      <div>
        <p className="font-semibold text-slate-100 mb-1">They can change</p>
        <ul className="list-disc ml-5 space-y-1 text-slate-300">{data.terms.canDo.map((l) => <li key={l}>{l}</li>)}</ul>
      </div>
      <div>
        <p className="font-semibold text-slate-100 mb-1">Stays private</p>
        <ul className="list-disc ml-5 space-y-1 text-slate-300">{data.terms.private.map((l) => <li key={l}>{l}</li>)}</ul>
      </div>
    </div>
  );

  return (
    <div className="max-w-4xl space-y-5">
      {error && <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}

      {data.invites.map((inv) => (
        <div key={inv.id} className={card}>
          <p className="text-slate-100 text-lg font-semibold">{inv.owner.name} invited you to join their brokerage</p>
          {inv.owner.email && <p className="text-xs text-slate-400 mb-3">{inv.owner.email}</p>}
          {terms}
          <div className="flex gap-2 mt-4">
            <button type="button" disabled={busy === inv.id || Boolean(data.current)} onClick={() => act(inv.id, 'accept')} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition">
              Accept and share my deals
            </button>
            <button type="button" disabled={busy === inv.id} onClick={() => act(inv.id, 'decline')} className="px-4 py-2 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm font-semibold rounded-lg transition">
              Decline
            </button>
          </div>
          {data.current && <p className="text-xs text-slate-500 mt-2">Leave your current brokerage first to join this one.</p>}
        </div>
      ))}

      {data.current && (
        <div className={card}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-slate-100 text-lg font-semibold">{data.current.owner.name}</p>
              <p className="text-xs text-slate-400">
                Your brokerage{data.current.since ? ` since ${new Date(data.current.since).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}
              </p>
            </div>
            <button type="button" disabled={busy === data.current.id} onClick={() => act(data.current!.id, 'leave')} className="px-3 py-1.5 border border-slate-600 hover:border-red-400 text-slate-300 hover:text-red-300 text-xs font-semibold rounded-lg transition">
              Leave
            </button>
          </div>
          {data.current.paused && <p className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 mt-3">Sharing is paused: this brokerage’s plan is not active right now, so they cannot see or change your deals. Nothing was removed, and it resumes if they renew.</p>}
          <details className="mt-3 group">
            <summary className="cursor-pointer text-sm text-blue-400 hover:text-blue-300">What they can see and change</summary>
            <div className="mt-3">
              {terms}
              <p className="text-xs text-slate-500 mt-3">{data.terms.leave}</p>
            </div>
          </details>
        </div>
      )}

      {!data.current && data.invites.length === 0 && <p className={`${card} text-sm text-slate-400`}>You are not in a brokerage, and nothing is waiting for you. When one invites you, it shows up here.</p>}
    </div>
  );
}
