'use client';

import Link from 'next/link';

// A list of deals that belong to agents in the brokerage, each with its stage, progress and the next step. Read-only: every row opens the deal's page.

export interface AgentDeal {
  id: string;
  property_address: string | null;
  file_number: string | null;
  status: string | null;
  purchase_price: number | string | null;
  closing_date: string | null;
  agent?: { id: string; name: string };
  health: { openTasks: number; overdueTasks: number; nextDue: string | null; flags: string[] };
  nextStep?: { name: string; dueDate: string | null } | null;
  tasksTotal?: number;
  tasksDone?: number;
  commission?: { status: string; submitted: boolean; statementNumber: string } | null;
}

const FLAG: Record<string, string> = { overdue: 'Overdue steps', closing_soon: 'Closing soon', no_closing_date: 'No closing date' };
// Where the commission invoice stands, as a chip; a closed deal with none is the one the brokerage should chase.
function commissionChip(d: AgentDeal): { text: string; cls: string } | null {
  const c = d.commission;
  if (!c) return d.status === 'Closed' ? { text: 'No commission invoice', cls: 'bg-red-500/15 text-red-300' } : null;
  if (c.submitted) return { text: 'Invoice needs approval', cls: 'bg-amber-500/15 text-amber-300' };
  if (c.status === 'proposed') return { text: 'Split waiting for agent', cls: 'bg-slate-500/15 text-slate-300' };
  if (c.status === 'change_requested') return { text: 'Agent asked for a change', cls: 'bg-orange-500/15 text-orange-300' };
  if (c.status === 'accepted') return { text: d.status === 'Closed' ? 'Approved, mark paid' : 'Invoice approved', cls: 'bg-emerald-500/15 text-emerald-300' };
  if (c.status === 'paid') return { text: 'Paid', cls: 'bg-blue-500/15 text-blue-300' };
  return null;
}
const fmt = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const price = (v: number | string | null) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? `$${n.toLocaleString()}` : null;
};

export default function AgentDealRows({ deals, showAgent = true }: { deals: AgentDeal[]; showAgent?: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ul className="grid gap-3">
      {deals.map((d) => {
        const closed = d.status === 'Closed';
        const total = d.tasksTotal ?? 0;
        const done = d.tasksDone ?? 0;
        const pct = total ? Math.round((done / total) * 100) : 0;
        const overdue = d.nextStep?.dueDate && d.nextStep.dueDate < today;
        return (
          <li key={d.id}>
            <Link href={`/dashboard/collaborate/deals/${d.id}`} className="block bg-white/5 border border-white/10 hover:border-white/25 rounded-2xl p-4 transition">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={`font-semibold break-words ${closed ? 'text-slate-400' : 'text-slate-100'}`}>{d.property_address || d.file_number || 'Untitled deal'}</p>
                  <p className="text-xs text-slate-500">{[showAgent && d.agent?.name && `Agent: ${d.agent.name}`, d.file_number && `File ${d.file_number}`, price(d.purchase_price)].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {d.health.flags.map((f) => (
                    <span key={f} className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300">{FLAG[f] ?? f}</span>
                  ))}
                  {(() => { const chip = commissionChip(d); return chip ? <span className={`text-[11px] px-2 py-0.5 rounded-full ${chip.cls}`}>{chip.text}</span> : null; })()}
                  <span className="text-xs px-2.5 py-0.5 rounded-full border border-slate-500/40 bg-slate-500/10 text-slate-300">{d.status}</span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-400">
                {total > 0 && (
                  <>
                    <span>{done}/{total} steps done</span>
                    <span className="w-28 h-1.5 rounded-full bg-white/10 overflow-hidden" aria-hidden>
                      <span className="block h-full bg-blue-500" style={{ width: `${pct}%` }} />
                    </span>
                  </>
                )}
                {d.closing_date && <span>{closed ? 'Closed' : 'Closing'} {fmt(d.closing_date)}</span>}
                {!closed && (d.nextStep ? (
                  <span className={overdue ? 'text-amber-300' : 'text-slate-300'}>Next: {d.nextStep.name}{d.nextStep.dueDate ? ` · ${overdue ? 'was due' : 'due'} ${fmt(d.nextStep.dueDate)}` : ''}</span>
                ) : (
                  <span>No open steps</span>
                ))}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
