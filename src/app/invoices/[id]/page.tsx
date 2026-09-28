'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { use } from 'react';

export default function InvoiceDetailRedirect({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const router = useRouter();
  useEffect(() => {
    router.replace(`/dashboard/invoices/${resolvedParams.id}`);
  }, [router, resolvedParams.id]);
  return null;
}
