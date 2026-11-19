'use client';

import { use } from 'react';
import ListingDetail from '@/components/ListingDetail';

export default function ListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ListingDetail id={id} />;
}
