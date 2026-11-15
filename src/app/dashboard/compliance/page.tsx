'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useBrokerageOwner } from '@/lib/useBrokerageOwner';
import { useBrokerageAdminAccess } from '@/lib/useBrokerageAdminAccess';
import BrokerageComplianceOverview from '@/components/BrokerageComplianceOverview';
import BrokerageFileReview from '@/components/BrokerageFileReview';

// The broker's compliance desk: what needs attention, the files to review, and the documents every file must hold.
type Tab = 'overview' | 'files' | 'requirements';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'files', label: 'File review' },
  { id: 'requirements', label: 'Required documents' },
];

export default function CompliancePage() {
  const owner = useBrokerageOwner();
  const admin = useBrokerageAdminAccess();
  const [tab, setTab] = useState<Tab>('overview');

  if (owner === null || admin === null) return <p className="p-8 text-sm text-slate-400">Loading…</p>;
  if (!owner && !admin.delegated) {
    return (
      <div className="p-8 max-w-xl">
        <h1 className="text-xl font-semibold text-slate-100 mb-2">Compliance</h1>
        <p className="text-sm text-slate-400">Compliance is for a brokerage&apos;s owner and administrators.</p>
        <Link href="/dashboard" className="inline-block mt-4 text-sm text-blue-400 hover:text-blue-300">Back to your dashboard</Link>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <h1 className="font-display text-2xl md:text-3xl font-semibold text-slate-100">Compliance</h1>
      <p className="text-sm text-slate-400 mb-5">Know which files need you, and what every file must hold.</p>
      <div className="flex gap-1 border-b border-slate-700 mb-6 overflow-x-auto" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition ${tab === t.id ? 'border-blue-400 text-blue-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>{t.label}</button>
        ))}
      </div>
      {tab === 'overview' && <BrokerageComplianceOverview goTo={setTab} showCommissions={owner === true} />}
      {tab === 'files' && <BrokerageFileReview part="files" />}
      {tab === 'requirements' && <BrokerageFileReview part="requirements" />}
    </div>
  );
}
