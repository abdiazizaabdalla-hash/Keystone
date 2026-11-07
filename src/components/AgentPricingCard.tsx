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
}

/**
 * What you charge this agent: a flat fee per file plus an optional percent of the price.
 * Used when the agent is invoiced; changing it does not alter invoices already made.
 */
export default function AgentPricingCard({ agentId, className }: { agentId: string; className?: string }) {
  const [agent, setAgent] = useState<AgentRecord | null>(null);
  const [flat, setFlat] = useState('');
  const [percent, setPercent] = useState('');
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
    setSaving(true);
    setNote('');
    try {
      const res = await authFetch('/api/agents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: agent.id, name: agent.name, brokerage: agent.brokerage, email: agent.email, phone: agent.phone, flatFee, percentFee }),
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
          Flat fee per file ($)
          <input className={`${input} mt-1`} type="number" min="0" step="1" value={flat} onChange={(e) => setFlat(e.target.value)} />
        </label>
        <label className="text-xs text-slate-400">
          Percent of price (%)
          <input className={`${input} mt-1`} type="number" min="0" max="100" step="0.01" value={percent} onChange={(e) => setPercent(e.target.value)} />
        </label>
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
