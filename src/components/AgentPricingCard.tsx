'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import AgentPriceList, { cleanPriceRows, type PriceRow } from '@/components/AgentPriceList';

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


/**
 * What you charge this agent: a transaction fee, a listing fee and any other named charges.
 * Used when the agent is invoiced; changing it does not alter invoices already made.
 */
export default function AgentPricingCard({ agentId, className }: { agentId: string; className?: string }) {
  const [agent, setAgent] = useState<AgentRecord | null>(null);
  const [flat, setFlat] = useState('');
  const [listingFee, setListingFee] = useState('');
  const [services, setServices] = useState<PriceRow[]>([]);
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
    if (!Number.isFinite(flatFee) || flatFee < 0) {
      setNote('Enter a transaction fee of $0 or more.');
      return;
    }
    const listing = listingFee.trim() === '' ? null : parseFloat(listingFee);
    if (listing !== null && (!Number.isFinite(listing) || listing < 0)) {
      setNote('Enter a listing fee of $0 or more, or leave it empty.');
      return;
    }
    const cleaned = cleanPriceRows(services);
    if (!cleaned.ok) {
      setNote(cleaned.error);
      return;
    }
    setSaving(true);
    setNote('');
    try {
      const res = await authFetch('/api/agents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: agent.id, name: agent.name, brokerage: agent.brokerage, email: agent.email, phone: agent.phone, flatFee, percentFee: 0, listingFee: listing, services: cleaned.services }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not save pricing');
      setNote('Saved.');
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not save pricing');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={className}>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-1">Your pricing for this agent</h2>
      <p className="text-xs text-slate-500 mb-3">Used on their invoices. Changing it does not alter invoices you have already made.</p>
      <div className="max-w-md">
        <AgentPriceList transactionFee={flat} listingFee={listingFee} services={services} onTransactionFee={setFlat} onListingFee={setListingFee} onServices={setServices} />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl transition disabled:opacity-50">
          {saving ? 'Saving…' : 'Save pricing'}
        </button>
        {note && <span className={`text-sm ${note === 'Saved.' ? 'text-emerald-400' : 'text-red-400'}`}>{note}</span>}
      </div>
    </section>
  );
}
