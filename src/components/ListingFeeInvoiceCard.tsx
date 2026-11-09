'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import OverviewCard from '@/components/OverviewCard';
import CoordinatorInvoiceList, { coordinatorOwed, type CoordinatorInvoice } from '@/components/CoordinatorInvoices';

/** On an agent's own listing (Overview): the listing fee their coordinator invoiced, with pay / download / details. Nothing if there is none. */
export default function ListingFeeInvoiceCard({ listingId }: { listingId: string }) {
  const [invoices, setInvoices] = useState<CoordinatorInvoice[]>([]);
  useEffect(() => {
    let cancelled = false;
    authFetch(`/api/agent/invoices?listingId=${encodeURIComponent(listingId)}`)
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setInvoices(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [listingId]);
  if (invoices.length === 0) return null;
  const owed = coordinatorOwed(invoices);
  return (
    <OverviewCard title="Invoice" summary={owed > 0 ? `$${owed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} due` : 'Paid'}>
      <CoordinatorInvoiceList invoices={invoices} detailHref={(invoiceId) => `/dashboard/invoices/received/${invoiceId}`} />
    </OverviewCard>
  );
}
