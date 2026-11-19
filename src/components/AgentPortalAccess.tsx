'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';

type Item = { id: string; address: string; status: string; hasAccess: boolean };
type Data = { email: string | null; deals: Item[]; listings: Item[] };

const btn = 'px-3.5 py-1.5 text-sm border border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10 rounded-lg transition font-medium';

/** Agents page: choose which of this agent's open deals and shared listings they can see in the free agent portal. */
export default function AgentPortalAccess({ agentId, agentName, onDone }: { agentId: string; agentName: string; onDone?: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [deals, setDeals] = useState<Set<string>>(new Set());
  const [listings, setListings] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setData(null);
    setError(null);
    (async () => {
      try {
        const res = await authFetch(`/api/agents/${agentId}/portal-access`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Could not load');
        if (!alive) return;
        setData(body);
        setDeals(new Set((body.deals as Item[]).filter((d) => d.hasAccess).map((d) => d.id)));
        setListings(new Set((body.listings as Item[]).filter((d) => d.hasAccess).map((d) => d.id)));
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Could not load');
      }
    })();
    return () => { alive = false; };
  }, [open, agentId]);

  const toggle = (set: Set<string>, put: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    put(next);
  };
  const all = (items: Item[], put: (s: Set<string>) => void, on: boolean) => put(new Set(on ? items.map((i) => i.id) : []));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/agents/${agentId}/portal-access`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dealIds: [...deals], listingIds: [...listings] }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not save');
      const parts = [body.granted ? `gave ${agentName} access to ${body.granted}` : '', body.removed ? `removed ${body.removed}` : ''].filter(Boolean);
      onDone?.(parts.length ? `Portal access saved: ${parts.join(', ')}${body.emailed ? '. They were emailed once.' : '.'}` : 'Portal access is already set that way.');
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const group = (title: string, items: Item[], chosen: Set<string>, put: (s: Set<string>) => void) => (
    <fieldset className="space-y-1">
      <div className="flex items-center justify-between">
        <legend className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</legend>
        {items.length > 0 && (
          <span className="text-xs text-slate-400">
            <button type="button" className="text-blue-300 hover:text-blue-200" onClick={() => all(items, put, true)}>All</button> · <button type="button" className="text-blue-300 hover:text-blue-200" onClick={() => all(items, put, false)}>None</button>
          </span>
        )}
      </div>
      {items.length === 0 ? <p className="text-sm text-slate-500">None open.</p> : items.map((i) => (
        <label key={i.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm text-slate-200 hover:bg-white/5">
          <input type="checkbox" checked={chosen.has(i.id)} onChange={() => toggle(chosen, put, i.id)} className="h-4 w-4" />
          <span className="min-w-0 flex-1 truncate">{i.address}</span>
          <span className="shrink-0 text-xs text-slate-500">{i.status}</span>
        </label>
      ))}
    </fieldset>
  );

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btn} title="Choose which deals and listings this agent can see" data-testid="agent-portal-access">Portal access</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`Portal access for ${agentName}`}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-5">
            <h3 className="text-lg font-semibold text-white">Portal access for {agentName}</h3>
            <p className="mb-4 mt-1 text-sm text-slate-400">Tick what {agentName} can see in their free portal. Unticking removes their access to that deal or listing.</p>
            {error && <p role="alert" className="mb-3 text-sm text-red-300">{error}</p>}
            {!data && !error ? <p className="text-sm text-slate-500">Loading…</p> : data && (
              <div className="space-y-5">
                {group('Transactions', data.deals, deals, setDeals)}
                {group('Listings', data.listings, listings, setListings)}
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5">Cancel</button>
              <button type="button" disabled={busy || !data} onClick={() => void save()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">{busy ? 'Saving…' : 'Save access'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
