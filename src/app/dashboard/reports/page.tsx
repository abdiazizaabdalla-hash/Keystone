'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useBrokerageOwner, useTeamOwner } from '@/lib/useBrokerageOwner';
import { useBrokerageAdminAccess } from '@/lib/useBrokerageAdminAccess';
import { TrendsSection, DealReportSection } from '@/components/BrokerageReports';
import TeamReports from '@/components/TeamReports';

// The broker's reports: how the brokerage and each agent are trending, and a deal-level report built to order.
type Tab = 'trends' | 'deals' | 'team';

export default function ReportsPage() {
  const owner = useBrokerageOwner();
  const teamOwner = useTeamOwner();
  const admin = useBrokerageAdminAccess();
  const [tab, setTab] = useState<Tab>('trends');

  if (owner === null || teamOwner === null || admin === null) return <p className="p-8 text-sm text-slate-400">Loading…</p>;
  if (!owner && !teamOwner && !admin.delegated) {
    return (
      <div className="p-8 max-w-xl">
        <h1 className="text-xl font-semibold text-slate-100 mb-2">Reports</h1>
        <p className="text-sm text-slate-400">Reports are for a brokerage&apos;s owner and administrators.</p>
        <Link href="/dashboard" className="inline-block mt-4 text-sm text-blue-400 hover:text-blue-300">Back to your dashboard</Link>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <h1 className="font-display text-2xl md:text-3xl font-semibold text-slate-100">Reports</h1>
      <p className="text-sm text-slate-400 mb-5">{teamOwner ? 'How your team is trending, and scheduled team activity workbooks. Prices stay private to each coordinator.' : 'Trends and comparisons, a deal report you build, and scheduled team activity workbooks.'}</p>
      <div className="flex gap-1 border-b border-slate-700 mb-6" role="tablist">
        {([['trends', 'Trends'], ...(teamOwner ? [] : [['deals', 'Deal report']]), ...(owner === true || teamOwner ? [['team', 'Team reports']] : [])] as [Tab, string][]).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${tab === id ? 'border-blue-400 text-blue-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>{label}</button>
        ))}
      </div>
      {tab === 'trends' && <TrendsSection />}
      {tab === 'deals' && <DealReportSection />}
      {tab === 'team' && (owner === true || teamOwner === true) && <TeamReports />}
    </div>
  );
}
