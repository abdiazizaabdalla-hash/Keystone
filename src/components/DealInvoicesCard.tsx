'use client';

import { useState } from 'react';
import { DealInvoiceModal } from '@/components/AgentInvoices';

// "Invoices" on an agent's own deal: bill a coordinator, a client or anyone else. Separate from the brokerage commission above it.
export function DealInvoicesBody({ hasCoordinator }: { transactionId: string; hasCoordinator: boolean }) {
  return (
    <p className="text-sm text-slate-400 max-w-xl">
      {hasCoordinator ? 'A coordinator is on this deal, so the invoice is attached to it and starts addressed to them.' : 'Create an invoice for this deal and send it to anyone. Add a coordinator to this deal and the invoice attaches to it automatically.'}
    </p>
  );
}

export default function DealInvoicesCard({ transactionId, hasCoordinator, bare = false }: { transactionId: string; hasCoordinator: boolean; /** No card around it (the caller already provides one). */ bare?: boolean }) {
  const [open, setOpen] = useState(false);
  const inner = (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <DealInvoicesBody transactionId={transactionId} hasCoordinator={hasCoordinator} />
      <button type="button" onClick={() => setOpen(true)} className="shrink-0 px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition">Generate invoice</button>
      {open && <DealInvoiceModal transactionId={transactionId} onClose={() => setOpen(false)} />}
    </div>
  );
  if (bare) return inner;
  return (
    <section className="bg-white/5 border border-white/10 rounded-2xl p-5">
      <div className="mb-3">
        <h2 className="text-lg font-bold text-slate-100">Invoices</h2>
        <p className="text-xs text-slate-400">Bill a coordinator, a client or anyone else for this deal. Separate from your brokerage commission.</p>
      </div>
      {inner}
    </section>
  );
}
