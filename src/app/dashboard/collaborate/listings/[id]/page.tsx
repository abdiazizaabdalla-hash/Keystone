'use client';

import { use } from 'react';
import ListingDetail from '@/components/ListingDetail';

// A brokerage owner's view of one listing of an agent in their brokerage: the agent's own listing page, read-only,
// without the conversations with the seller and the coordinator.
export default function OversightListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ListingDetail id={id} ownerView />;
}
