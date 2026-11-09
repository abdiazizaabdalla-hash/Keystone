'use client';

import AgentCommissionInvoice from '@/components/AgentCommissionInvoice';
import DealInvoicesCard from '@/components/DealInvoicesCard';

// The agent's money on a deal, in two separate boxes: Commission first (between the agent and their brokerage only), then Invoices
// (anything billed to someone else, like a coordinator or a client).
export default function CommissionAndInvoices({ transactionId, purchasePrice, dealStatus, hasCoordinator }: { transactionId: string; purchasePrice?: number | null; dealStatus?: string | null; hasCoordinator: boolean }) {
  return (
    <div className="space-y-6">
      <AgentCommissionInvoice transactionId={transactionId} purchasePrice={purchasePrice} dealStatus={dealStatus} />
      <DealInvoicesCard transactionId={transactionId} hasCoordinator={hasCoordinator} />
    </div>
  );
}
