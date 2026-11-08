'use client';

import { useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { PayForm } from '@/components/CommissionInvoicePanel';

// The brokerage's payment controls for one commission, usable from any list: record it paid (with the date and a note such as a
// check number), pay one the agent has not agreed to yet, correct a payment, or mark it unpaid again. The agent is told each time.

const btn = 'text-xs font-semibold px-2.5 py-1 rounded-lg border transition disabled:opacity-50';

export default function CommissionQuickPay({
  id,
  status,
  paidOn,
  paidNote,
  agentName,
  onChanged,
}: {
  id: string;
  status: string;
  paidOn?: string | null;
  paidNote?: string | null;
  agentName: string;
  onChanged: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<null | 'pay' | 'editpay'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      const res = await authFetch(`/api/commissions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not save that');
      setMode(null);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that');
    } finally {
      setBusy(false);
    }
  };

  if (status !== 'accepted' && status !== 'proposed' && status !== 'paid') return null;
  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-2">
        {status === 'accepted' && <button type="button" disabled={busy} onClick={() => setMode('pay')} className={`${btn} border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10`}>Mark paid</button>}
        {status === 'proposed' && <button type="button" disabled={busy} onClick={() => setMode('pay')} className={`${btn} border-white/15 text-slate-300 hover:bg-white/5`}>Mark paid anyway</button>}
        {status === 'paid' && <button type="button" disabled={busy} onClick={() => setMode('editpay')} className={`${btn} border-white/15 text-slate-300 hover:bg-white/5`}>Change payment</button>}
        {status === 'paid' && (
          <button type="button" disabled={busy} onClick={() => window.confirm(`Mark this as not paid? ${agentName} will be told.`) && act({ action: 'mark_unpaid' })} className={`${btn} border-transparent text-slate-400 hover:text-amber-300`}>
            Mark unpaid
          </button>
        )}
      </div>
      {mode === 'pay' && (
        <div className="mt-2">
          <PayForm
            busy={busy}
            warning={status === 'proposed' ? `${agentName} has not agreed to this split yet. They are told it was paid.` : undefined}
            onCancel={() => setMode(null)}
            onSave={(d, n) => act({ action: 'mark_paid', paidOn: d, note: n, ...(status === 'proposed' ? { override: true } : {}) })}
          />
        </div>
      )}
      {mode === 'editpay' && (
        <div className="mt-2">
          <PayForm busy={busy} title="Change the payment" initialDate={paidOn?.slice(0, 10)} initialNote={paidNote ?? ''} onCancel={() => setMode(null)} onSave={(d, n) => act({ action: 'edit_payment', paidOn: d, note: n })} />
        </div>
      )}
      {error && <p className="text-xs text-red-300 mt-1">{error}</p>}
    </div>
  );
}
