'use client';

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { showToast } from '@/lib/toast';
import AgentCommissionInvoiceForm from '@/components/AgentCommissionInvoiceForm';
import CommissionBox from '@/components/CommissionBox';

// The "Commission" box on an agent's own deal, for an agent in a brokerage. It is only about the money between the agent and their
// brokerage, and is separate from the "Invoices" box below it (a coordinator, a client, anyone else).
//   * No commission invoice yet (an open deal): the worked-out figures from the brokerage's terms, room to add a line of their own and a
//     note, and a button to send it. Nothing else on the page needs reading first.
//   * Once there is one (sent, or made when the deal closed): the full commission breakdown and what the agent can do next (agree or
//     ask for a change, open the statement).
// Not in a brokerage: nothing is shown here.

interface Data { role: 'agent' | 'owner' | null; awaitingTerms?: boolean; canInvoice?: boolean; brokerage?: { name: string; email: string | null }; commission: { status: string } | null }

const card = 'bg-white/5 border border-white/10 rounded-2xl p-5';

export default function AgentCommissionInvoice({ transactionId, dealStatus }: { transactionId: string; purchasePrice?: number | null; /** The deal's stage: when it changes (for instance to Closed) the commission is read again. */ dealStatus?: string | null; hasCoordinator?: boolean }) {
  const [data, setData] = useState<Data | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`/api/commissions?transaction=${encodeURIComponent(transactionId)}`);
      setData(res.ok ? await res.json() : { role: null, commission: null });
    } catch {
      setData({ role: null, commission: null });
    }
  }, [transactionId]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load, dealStatus]);

  if (data === null) return null;
  const c = data.commission;

  // A commission invoice exists: the full commission box, with the breakdown and the agent's next step.
  if (c && c.status !== 'void') return <CommissionBox key={`${c.status}`} transactionId={transactionId} />;

  if (data.canInvoice && data.brokerage) {
    return (
      <section className={card}>
        <div className="mb-3">
          <h2 className="text-lg font-bold text-slate-100">Commission</h2>
          <p className="text-xs text-slate-400">Between you and your brokerage only. Separate from any fees for a coordinator on Relay.</p>
        </div>
        <AgentCommissionInvoiceForm
          inline
          initialTransactionId={transactionId}
          lockDeal
          onClose={() => void load()}
          onSent={() => {
            showToast({ title: 'Commission invoice sent', body: `Sent to ${data.brokerage?.name ?? 'your brokerage'}`, tone: 'success' });
            void load();
          }}
        />
      </section>
    );
  }

  if (data.awaitingTerms && data.brokerage) {
    return (
      <section className={card}>
        <div className="mb-3">
          <h2 className="text-lg font-bold text-slate-100">Commission</h2>
          <p className="text-xs text-slate-400">Between you and your brokerage only. Separate from any fees for a coordinator on Relay.</p>
        </div>
        <p className="text-sm text-slate-300">{data.brokerage.name} has not set your commission terms yet, so there is no commission estimate on this deal. When they set your split and commission rate, it appears here.</p>
      </section>
    );
  }

  return null;
}
