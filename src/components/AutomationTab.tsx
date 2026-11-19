'use client';

import { useState } from 'react';
import AutomationTracker from '@/components/AutomationTracker';
import AssistantPanel from '@/components/AssistantPanel';

// The one Automation tab of a deal or listing: the Tracker (what each step did, what is next, what needs you) first, and the
// settings behind it (assistant mode, on/off switches, the full activity list) one click away.

export default function AutomationTab({ transactionId, listingId }: { transactionId?: string; listingId?: string }) {
  const [view, setView] = useState<'tracker' | 'settings'>('tracker');
  return (
    <div className="space-y-5" data-testid="automation-tab">
      <div role="tablist" aria-label="Automation views" className="inline-flex overflow-hidden rounded-lg border border-white/10">
        {([['tracker', 'Tracker'], ['settings', 'Settings & activity']] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)} data-testid={`automation-view-${id}`}
            className={`px-4 py-1.5 text-sm ${view === id ? 'bg-blue-500 text-white' : 'text-slate-300 hover:bg-white/5'}`}>{label}</button>
        ))}
      </div>
      {view === 'tracker' ? <AutomationTracker transactionId={transactionId} listingId={listingId} /> : <AssistantPanel transactionId={transactionId} listingId={listingId} />}
    </div>
  );
}
