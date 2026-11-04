'use client';

import { use } from 'react';
import TransactionDetail from '@/components/TransactionDetail';

// A brokerage owner's view of one deal of an agent in their brokerage: the agent's own transaction page, read-only,
// without the conversations with clients and the coordinator. Documents can be added and the commission handled here.
export default function OversightDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <TransactionDetail id={id} ownerView />;
}
