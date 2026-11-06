'use client';

import { useEffect, useState } from 'react';
import AgentCommissionInvoice from '@/components/AgentCommissionInvoice';
import CommissionBox from '@/components/CommissionBox';

// The agent's "Commission & invoices" section on a deal. Collapsed, it shows the one-line status of the brokerage commission
// statement and where to bill someone else. Opened, the full commission details (rate, split, fees, agree / ask for a change) sit
// underneath, so everything about money on the deal lives in one place.
const KEY = 'relay.commissionOpen';

export default function CommissionAndInvoices({ transactionId, purchasePrice, hasCoordinator }: { transactionId: string; purchasePrice?: number | null; hasCoordinator: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      try { setOpen(localStorage.getItem(KEY) === '1'); } catch { /* storage unavailable */ }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const toggle = () => {
    setOpen((v) => {
      try { localStorage.setItem(KEY, v ? '0' : '1'); } catch { /* storage unavailable */ }
      return !v;
    });
  };
  return (
    <section className="rounded-2xl border bg-white/5 border-white/10">
      <button type="button" onClick={toggle} aria-expanded={open} className="w-full flex items-center gap-4 px-5 py-4 text-left">
        <span className="font-semibold text-slate-100">Commission &amp; invoices</span>
        <span className="text-sm text-slate-400 truncate min-w-0">Your brokerage’s commission statement, and invoices you send to others</span>
        <svg className={`w-4 h-4 ml-auto shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div className="px-5 pb-5">
        <AgentCommissionInvoice transactionId={transactionId} purchasePrice={purchasePrice} hasCoordinator={hasCoordinator} />
        <div className={open ? 'mt-4' : 'hidden'}>
          <CommissionBox transactionId={transactionId} embedded />
        </div>
      </div>
    </section>
  );
}
