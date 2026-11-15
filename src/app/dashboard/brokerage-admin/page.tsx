'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useBrokerageAdminAccess } from '@/lib/useBrokerageAdminAccess';
import { roleLabel } from '@/lib/brokerageAdmins';
import BrokerageRoster from '@/components/BrokerageRoster';
import BrokerageFileReview from '@/components/BrokerageFileReview';
import BrokerageReports from '@/components/BrokerageReports';

// Where a brokerage administrator works: the agents, file review and reports of the brokerage they help run. What each tab lets
// them change depends on their role, and the server checks it again on every request.
type Tab = 'agents' | 'filereview' | 'reports';
const TABS: { id: Tab; label: string }[] = [
  { id: 'agents', label: 'Agents' },
  { id: 'filereview', label: 'File review' },
  { id: 'reports', label: 'Reports' },
];

export default function BrokerageAdminPage() {
  const access = useBrokerageAdminAccess();
  const [tab, setTab] = useState<Tab>('agents');

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
      <div className="flex gap-1 border-b border-slate-700 mb-6" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${tab === t.id ? 'border-blue-400 text-blue-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>{t.label}</button>
        ))}
      </div>
      {tab === 'agents' && <BrokerageRoster />}
      {tab === 'filereview' && <BrokerageFileReview />}
      {tab === 'reports' && <BrokerageReports />}
    </div>
  );
}
