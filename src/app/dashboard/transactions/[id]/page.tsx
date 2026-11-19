'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import TransactionDetail from '@/components/TransactionDetail';
import { authFetch } from '@/lib/authClient';
import { useBrokerageOwner } from '@/lib/useBrokerageOwner';

// A deal of your own. A brokerage owner who follows an old link to one of their agents' deals is sent to the owner view of it.
export default function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const owner = useBrokerageOwner();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (owner === null) return;
    if (!owner) {
      const t = setTimeout(() => setChecked(true), 0);
      return () => clearTimeout(t);
    }
    let live = true;
    authFetch(`/api/oversight/deals/${id}/view`)
      .then((res) => {
        if (!live) return;
        if (res.ok) router.replace(`/dashboard/collaborate/deals/${id}`);
        else setChecked(true);
      })
      .catch(() => live && setChecked(true));
    return () => {
      live = false;
    };
  }, [owner, id, router]);

  if (owner !== false && !checked) return <div className="p-8 text-slate-400 text-sm">Loading…</div>;
  return <TransactionDetail id={id} />;
}
