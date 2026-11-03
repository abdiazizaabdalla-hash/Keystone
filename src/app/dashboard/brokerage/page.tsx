'use client';

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { isFeatureOnClient } from '@/lib/features';
import BrokerageMessages from '@/components/BrokerageMessages';
import BrokerageCommissions from '@/components/BrokerageCommissions';

// The agent's side: see exactly what a brokerage can see, then accept, decline, or leave later.

interface Owner { id: string; name: string; email: string | null }
interface Terms { sees: string[]; canDo: string[]; private: string[]; leave: string }
interface Data { current: { id: string; owner: Owner; since: string | null; paused?: boolean } | null; invites: { id: string; owner: Owner; invitedAt: string }[]; terms: Terms }

const card = 'bg-white/5 border border-white/10 rounded-2xl p-5';

export default function BrokeragePage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const on = isFeatureOnClient('brokerage');

  const load = useCallback(async () => {
    const res = await authFetch('/api/brokerage');
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not load this page');
    setData(body);
  }, []);

  useEffect(() => {
    if (!on) return;
    const t = setTimeout(() => {
      load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load this page'));
    }, 0);
    return () => clearTimeout(t);
  }, [load, on]);

  const act = async (id: string, action: 'accept' | 'decline' | 'leave') => {
    if (action === 'leave' && !window.confirm('Leave this brokerage? They will no longer see your deals. Your deals stay yours.')) return;
    setBusy(id);
    setError('');
    try {
      const res = await authFetch(`/api/brokerage/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not do that');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not do that');
    } finally {
      setBusy('');
    }
  };

  if (!on) return <div className="p-4 md:p-8 text-slate-400 text-sm">This page is not available yet.</div>;
  if (!data) return <div className="p-4 md:p-8 text-slate-400 text-sm">{error || 'Loading…'}</div>;

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
    <div className="p-4 md:p-8 max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl md:text-3xl font-display font-semibold text-slate-100">Your brokerage</h1>
        <p className="text-slate-400 mt-1 max-w-2xl">A brokerage can invite you to share your deals with them. Nothing is shared until you accept, and you can leave whenever you like.</p>
      </div>
      {error && <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}

      {data.current && (
        <div className={card}>
          <p className="text-slate-100 text-lg font-semibold">You are in {data.current.owner.name}’s brokerage</p>
          {data.current.since && <p className="text-xs text-slate-400 mb-3">Since {new Date(data.current.since).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>}
          {data.current.paused && <p className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 mb-3">Sharing is paused: this brokerage’s plan is not active right now, so they cannot see or change your deals. Nothing was removed, and it resumes if they renew.</p>}
          {terms}
          <p className="text-xs text-slate-500 mt-3">{data.terms.leave}</p>
          <button type="button" disabled={busy === data.current.id} onClick={() => act(data.current!.id, 'leave')} className="mt-3 px-4 py-2 border border-slate-600 hover:border-red-400 text-slate-200 hover:text-red-300 text-sm font-semibold rounded-lg transition">
            Leave this brokerage
          </button>
        </div>
      )}

      {data.current && <BrokerageCommissions mode="agent" />}

      {data.current && <BrokerageMessages title={`Private messages with ${data.current.owner.name}`} />}

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

      {!data.current && data.invites.length === 0 && <p className={`${card} text-sm text-slate-400`}>No invitations right now.</p>}
    </div>
  );
}
