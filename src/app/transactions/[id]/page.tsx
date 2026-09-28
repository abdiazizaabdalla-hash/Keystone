'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { use } from 'react';

export default function TransactionDetailRedirect({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const router = useRouter();
  useEffect(() => {
    router.replace(`/dashboard/transactions/${resolvedParams.id}`);
  }, [router, resolvedParams.id]);
  return null;
}
