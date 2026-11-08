'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';

interface AgentRecord {
  id: string;
  name: string;
  brokerage: string | null;
  email: string | null;
  phone: string | null;
  flat_fee: number | string | null;
  commission_percent: number | string | null;
  listing_fee?: number | string | null;
  services?: Array<{ id: string; name: string; amount: number }> | null;
}

type ServiceRow = { id: string; name: string; amount: string };

/**
 * What you charge this agent: a flat fee per file plus an optional percent of the price.
 * Used when the agent is invoiced; changing it does not alter invoices already made.
 */
export default function AgentPricingCard({ agentId, className }: { agentId: string; className?: string }) {
  const [agent, setAgent] = useState<AgentRecord | null>(null);
  const [flat, setFlat] = useState('');
  const [percent, setPercent] = useState('');
  const [listingFee, setListingFee] = useState('');
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/api/agents');
        if (!res.ok) return;
        const list = (await res.json()) as AgentRecord[];
        const found = Array.isArray(list) ? list.find((a) => a.id === agentId) : undefined;
        if (!found) return;
        setAgent(found);
        setFlat(String(found.flat_fee ?? 400));
        setPercent(String(found.commission_percent ?? 0));
        setListingFee(found.listing_fee === null || found.listing_fee === undefined ? '' : String(found.listing_fee));
        setServices((found.services || []).map((x) => ({ id: x.id, name: x.name, amount: String(x.amount) })));
      } catch {
        // The rest of the profile still works without this card.
      }
    })();
  }, [agentId]);

  if (!agent) return null;

  const save = async () => {
    const flatFee = parseFloat(flat);
    const percentFee = parseFloat(percent);
    if (!Number.isFinite(flatFee) || flatFee < 0 || !Number.isFinite(percentFee) || percentFee < 0 || percentFee > 100) {
      setNote('Enter a flat fee of 0 or more and a percent between 0 and 100.');
      return;
    }
    const listing = listingFee.trim() === '' ? null : parseFloat(listingFee);
    if (listing !== null && (!Number.isFinite(listing) || listing < 0)) {
      setNote('Enter a listing fee of 0 or more, or leave it empty.');
      return;
    }
    const cleaned = services.filter((x) => x.name.trim() || x.amount.trim());
    if (cleaned.some((x) => !x.name.trim() || !Number.isFinite(parseFloat(x.amount)) || parseFloat(x.amount) < 0)) {
      setNote('Give every extra charge a name and a price of 0 or more.');
      return;
    }
    setSaving(true);
    setNote('');
    try {
      const res = await authFetch('/api/agents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: agent.id, name: agent.name, brokerage: agent.brokerage, email: agent.email, phone: agent.phone, flatFee, percentFee, listingFee: listing, services: cleaned.map((x) => ({ id: x.id, name: x.name.trim(), amount: parseFloat(x.amount) })) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not save pricing');
      setNote('Saved.');
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not save pricing');
    } finally {
      setSaving(false);
    }
  };

  const input = 'w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50';
  return (
    <section className={className}>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-1">Your pricing for this agent</h2>
      <p className="text-xs text-slate-500 mb-3">Used on their invoices. Changing it does not alter invoices you have already made.</p>
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <label className="text-xs text-slate-400">
          Transaction coordination fee ($)
          <input className={`${input} mt-1`} type="number" min="0" step="1" value={flat} onChange={(e) => setFlat(e.target.value)} />
        </label>
        <label className="text-xs text-slate-400">
          Listing coordination fee ($)
          <input className={`${input} mt-1`} type="number" min="0" step="1" placeholder="Not set" value={listingFee} onChange={(e) => setListingFee(e.target.value)} />
        </label>
        <label className="text-xs text-slate-400">
          Percent of price (%)
          <input className={`${input} mt-1`} type="number" min="0" max="100" step="0.01" value={percent} onChange={(e) => setPercent(e.target.value)} />
        </label>
      </div>
      <div className="mt-5 max-w-md">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Other charges</h3>
        <p className="text-xs text-slate-500 mb-2">Anything else you bill this agent for (a rush file, an amendment, a gift). They appear in the Service list when you invoice.</p>
        <div className="space-y-2">
          {services.map((row, i) => (
            <div key={row.id} className="flex gap-2">
              <input className={input} placeholder="Name, e.g. Rush file" value={row.name} maxLength={80} onChange={(e) => setServices((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input className={`${input} w-28`} type="number" min="0" step="1" placeholder="$" value={row.amount} onChange={(e) => setServices((prev) => prev.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
              <button type="button" aria-label="Remove" onClick={() => setServices((prev) => prev.filter((_, j) => j !== i))} className="px-2 text-slate-400 hover:text-red-300">✕</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setServices((prev) => [...prev, { id: Math.random().toString(36).slice(2, 10), name: '', amount: '' }])} className="mt-2 text-xs text-blue-300 hover:text-blue-200">＋ Add a charge</button>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl transition disabled:opacity-50">
          {saving ? 'Saving…' : 'Save pricing'}
        </button>
        {note && <span className={`text-sm ${note === 'Saved.' ? 'text-emerald-400' : 'text-red-400'}`}>{note}</span>}
      </div>
    </section>
  );
}
