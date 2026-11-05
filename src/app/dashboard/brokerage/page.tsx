'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// The agent's brokerage lives in Collaborate now (one hub for the broker and the agents). Old links, such as the one in
// the invitation email, land here and move on.
export default function BrokerageRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard/collaborate#brokerage');
  }, [router]);
  return <p className="p-8 text-sm text-slate-400">Opening your brokerage…</p>;
}
