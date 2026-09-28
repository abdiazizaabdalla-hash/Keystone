'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function InvoicesRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard/invoices');
  }, [router]);
  return null;
}
