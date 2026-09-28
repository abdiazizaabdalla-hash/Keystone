'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function NewTransactionRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard/transactions/new');
  }, [router]);
  return null;
}
