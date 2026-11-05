'use client';

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';

// Admin: brokerage accounts and their complimentary pilots. Grant a 30-day Pro pilot, extend it once by 15 days, convert it to the paid
// plan (records Relay's decision only, no charge), or terminate it. Also lists owners who have agents but no account yet.

interface Row {
  ownerId: string;
  email: string | null;
  name: string | null;
  status: 'pilot' | 'pilot_expired' | 'converted' | 'terminated';
  endsOn: string | null;
  daysLeft: number | null;
  extensionUsed: boolean;
  upgradeRequestedAt: string | null;
  notes: string | null;
  agents: { active: number; pending: number };
  seatLimit: number;
}
interface Unmanaged { ownerId: string; email: string | null; name: string | null; agents: { active: number; pending: number } }

const BADGE: Record<Row['status'], string> = {
  pilot: 'bg-blue-900/30 text-blue-300',
  pilot_expired: 'bg-amber-900/30 text-amber-300',
  converted: 'bg-green-900/30 text-green-300',
  terminated: 'bg-red-900/30 text-red-300',
};

export default function AdminBrokeragePilots() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [unmanaged, setUnmanaged] = useState<Unmanaged[]>([]);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const load = useCallback(async () => {
    const res = await authFetch('/api/admin/brokerages');
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Could not load brokerage accounts');
    setRows(body.accounts ?? []);
    setUnmanaged(body.unmanaged ?? []);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load brokerage accounts'));
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const grant = async (to: string, n = note) => {
    setBusy('grant');
    setError('');
    setDone('');
    try {
      const res = await authFetch('/api/admin/brokerages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: to, note: n }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not start the pilot');
      setDone(`Pilot started for ${to}, ends ${body.endsOn}.`);
      setEmail('');
      setNote('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the pilot');
    } finally {
      setBusy('');
    }
  };

  const act = async (r: Row, action: 'extend' | 'convert' | 'terminate') => {
    const who = r.email ?? r.ownerId;
    const text = {
      extend: `Extend ${who}'s pilot by 15 days? This can be done once.`,
      convert: `Convert ${who} to Brokerage Pro? This records the decision only. No charge or subscription is created, so arrange payment separately.`,
      terminate: `Terminate ${who}'s brokerage account? Management is paused. Nothing is deleted.`,
    }[action];
    if (!window.confirm(text)) return;
    setBusy(r.ownerId);
    setError('');
    setDone('');
    try {
      const res = await authFetch(`/api/admin/brokerages/${r.ownerId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not update the account');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the account');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="mb-8 bg-slate-800 border border-slate-700 rounded-lg p-5" aria-label="Brokerage pilots">
      <h2 className="text-lg font-semibold text-slate-100">Brokerage pilots</h2>
      <p className="text-sm text-slate-400 mb-4">30 days of full Brokerage Pro, up to 25 agents, no payment method and no automatic billing. The owner must already be on the Team plan.</p>
      {error && <p className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-3">{error}</p>}
      {done && <p className="text-sm text-emerald-300 mb-3">{done}</p>}

      <form onSubmit={(e) => { e.preventDefault(); void grant(email.trim()); }} className="flex flex-col sm:flex-row gap-2 mb-5 max-w-3xl">
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Brokerage owner’s email" aria-label="Brokerage owner email" className="flex-1 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-600 text-sm text-slate-100 placeholder:text-slate-500" />
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Note (optional)" aria-label="Note" className="flex-1 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-600 text-sm text-slate-100 placeholder:text-slate-500" />
        <button disabled={busy === 'grant' || !email} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition whitespace-nowrap">{busy === 'grant' ? 'Starting…' : 'Start 30-day pilot'}</button>
      </form>

      {unmanaged.length > 0 && (
        <div className="mb-5 text-sm bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3">
          <p className="text-amber-200 font-semibold mb-1">Have agents but no account yet</p>
          <ul className="space-y-1">
            {unmanaged.map((u) => (
              <li key={u.ownerId} className="flex flex-wrap items-center justify-between gap-2 text-slate-300">
                <span>{u.email ?? u.ownerId} · {u.agents.active} agents, {u.agents.pending} invited</span>
                {u.email && <button type="button" disabled={busy === 'grant'} onClick={() => grant(u.email as string, '')} className="text-blue-400 hover:text-blue-300">Start pilot</button>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!rows ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400">No brokerage accounts yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="py-2 pr-4">Brokerage</th><th className="py-2 pr-4">Status</th><th className="py-2 pr-4">Ends</th><th className="py-2 pr-4">Agents</th><th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ownerId} className="border-t border-slate-700 align-top">
                  <td className="py-2 pr-4 text-slate-200">{r.name || r.email}<div className="text-xs text-slate-500">{r.email}</div>{r.upgradeRequestedAt && r.status !== 'converted' && <div className="text-xs text-emerald-300">Asked to upgrade</div>}</td>
                  <td className="py-2 pr-4"><span className={`text-xs px-2 py-0.5 rounded-full ${BADGE[r.status]}`}>{r.status.replace('_', ' ')}</span></td>
                  <td className="py-2 pr-4 text-slate-300">{r.status === 'pilot' ? `${r.endsOn} (${r.daysLeft} days)` : r.status === 'pilot_expired' ? `${r.endsOn}` : '—'}{r.extensionUsed && <div className="text-xs text-slate-500">extended</div>}</td>
                  <td className="py-2 pr-4 text-slate-300">{r.agents.active}{r.agents.pending ? ` + ${r.agents.pending} invited` : ''} / {r.seatLimit || '—'}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {(r.status === 'pilot' || r.status === 'pilot_expired') && !r.extensionUsed && <button type="button" disabled={busy === r.ownerId} onClick={() => act(r, 'extend')} className="text-blue-400 hover:text-blue-300 mr-3">Extend 15 days</button>}
                    {(r.status === 'pilot' || r.status === 'pilot_expired') && <button type="button" disabled={busy === r.ownerId} onClick={() => act(r, 'convert')} className="text-emerald-400 hover:text-emerald-300 mr-3">Convert</button>}
                    {r.status !== 'terminated' && <button type="button" disabled={busy === r.ownerId} onClick={() => act(r, 'terminate')} className="text-red-400 hover:text-red-300">Terminate</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
