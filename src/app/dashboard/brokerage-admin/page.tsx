'use client';

import Link from 'next/link';
import { useBrokerageAdminAccess } from '@/lib/useBrokerageAdminAccess';
import { roleLabel } from '@/lib/brokerageAdmins';
import BrokerageRoster from '@/components/BrokerageRoster';

// Where a brokerage administrator sees the agents of the brokerage they help run. Compliance and Reports have their own pages in the menu.
export default function BrokerageAdminPage() {
  const access = useBrokerageAdminAccess();

  if (access === null) return <p className="p-8 text-sm text-slate-400">Loading…</p>;
  if (!access.delegated) {
    return (
      <div className="p-8 max-w-xl">
        <h1 className="text-xl font-semibold text-slate-100 mb-2">Brokerage</h1>
        <p className="text-sm text-slate-400">You are not an administrator of a brokerage. If someone added you, sign in with the email they used.</p>
        <Link href="/dashboard" className="inline-block mt-4 text-sm text-blue-400 hover:text-blue-300">Back to your dashboard</Link>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <h1 className="font-display text-2xl font-semibold text-slate-100">{access.brokerage}</h1>
      <p className="text-sm text-slate-400 mb-6">You are an administrator here as a {roleLabel(access.role ?? '')}.{access.role === 'viewer' ? ' You can look but not change anything.' : ''}</p>
      <BrokerageRoster />
    </div>
  );
}
