'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch } from '@/lib/authClient';
import { isFeatureOnClient } from '@/lib/features';

// For a free agent (invited by a coordinator): brokerage invitations waiting for them. Accepting gives them a free Relay workspace to
// run their own deals, so they continue in the dashboard. Shows nothing when there is no invitation, or the feature is off.

interface Invite { id: string; owner: { id: string; name: string; email: string | null } }
interface Terms { sees: string[]; canDo: string[]; private: string[]; leave: string }

export default function AgentBrokerageInvites() {
  const router = useRouter();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isFeatureOnClient('brokerage')) return;
    let cancelled = false;
    authFetch('/api/brokerage')
      .then(async (res) => {
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled) {
          setInvites(Array.isArray(body.invites) ? body.invites : []);
          setTerms(body.terms ?? null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const answer = async (id: string, action: 'accept' | 'decline') => {
    setBusy(id);
    setError('');
    try {
      const res = await authFetch(`/api/brokerage/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not do that');
      // Accepting gives them a workspace; the dashboard sets it up (a short first-time step) and takes over from here.
      if (action === 'accept') router.push('/dashboard');
      else setInvites((list) => list.filter((i) => i.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not do that');
    } finally {
      setBusy('');
    }
  };

  if (invites.length === 0) return null;

  return (
    <div className="mb-8 space-y-3">
      {invites.map((inv) => (
        <div key={inv.id} className="bg-gradient-to-br from-blue-900/20 to-slate-800 border border-blue-700/50 rounded-lg px-5 py-4">
          <p className="text-slate-100 text-sm font-semibold">{inv.owner.name} invited you to join their brokerage</p>
          <p className="text-slate-400 text-xs mt-1">
            Joining gives you a free Relay workspace to run your own deals and listings. {inv.owner.name} sees a read-only copy of your deals and cannot change them.
          </p>
          {terms && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-blue-400 hover:text-blue-300">What they can see</summary>
              <ul className="list-disc ml-5 mt-2 space-y-1 text-xs text-slate-300">{terms.sees.map((l) => <li key={l}>{l}</li>)}</ul>
              <p className="text-xs text-slate-500 mt-2">{terms.leave}</p>
            </details>
          )}
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" disabled={busy === inv.id} onClick={() => answer(inv.id, 'accept')} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition">
              {busy === inv.id ? 'Joining…' : 'Accept and join'}
            </button>
            <button type="button" disabled={busy === inv.id} onClick={() => answer(inv.id, 'decline')} className="px-4 py-2 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm font-semibold rounded-lg transition">
              Decline
            </button>
          </div>
        </div>
      ))}
      {error && <p className="text-red-400 text-sm">{error}</p>}
    </div>
  );
}
