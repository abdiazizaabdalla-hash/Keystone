'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';

// A TC team owner's workload view: who is carrying what, and which files need a word. Status only: a coordinator's files are private
// to them, so there are no prices, documents or links into a file here.
interface Member { id: string; name: string; openDeals: number; lateTasks: number; lateDeals: number; closingThisWeek: number; lastActivity: string | null }
interface Attention { dealId: string; address: string; member: string; reason: string; tone: 'late' | 'closing' | 'quiet' }
interface Desk { members: Member[]; attention: Attention[]; totals: { openDeals: number; lateDeals: number; closingThisWeek: number; quiet: number } }

const TONE: Record<Attention['tone'], string> = { late: 'text-red-300', closing: 'text-amber-300', quiet: 'text-sky-300' };
const WHY: Record<Attention['tone'], string> = { late: 'Behind', closing: 'Closing soon', quiet: 'Gone quiet' };
const ago = (iso: string | null) => {
  if (!iso) return 'No activity yet';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
};

export default function TeamDesk({ goTo }: { goTo?: (tab: 'requirements') => void }) {
  const [data, setData] = useState<Desk | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    authFetch('/api/oversight/team-desk')
      .then(async (r) => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error || 'Could not load your team'); if (live) setData(b); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not load your team'); });
    return () => { live = false; };
  }, []);

  if (!data) return <p className="text-sm text-slate-400">{error || 'Loading…'}</p>;
  const t = data.totals;
  const tiles = [
    { label: 'Open files', value: t.openDeals, tone: '' },
    { label: 'Files with late steps', value: t.lateDeals, tone: t.lateDeals > 0 ? 'text-red-300' : '' },
    { label: 'Closing this week', value: t.closingThisWeek, tone: '' },
    { label: 'Gone quiet', value: t.quiet, tone: t.quiet > 0 ? 'text-amber-300' : '' },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map((x) => (
          <div key={x.label} className="bg-white/5 border border-white/10 rounded-2xl px-4 py-4">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">{x.label}</p>
            <p className={`text-3xl font-semibold mt-1 ${x.tone || 'text-slate-100'}`}>{x.value}</p>
          </div>
        ))}
      </div>

      {data.members.length === 0 ? (
        <p className="bg-white/5 border border-dashed border-white/15 rounded-2xl p-5 text-sm text-slate-400">No teammates yet. Invite your coordinators under Collaborate and their workload shows up here.</p>
      ) : (
        <>
          <section className="bg-white/5 border border-white/10 rounded-2xl overflow-x-auto">
            <h2 className="text-sm font-semibold text-slate-100 px-5 py-3 border-b border-white/5">Workload by coordinator</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-2 font-medium">Coordinator</th><th className="py-2 pr-4 font-medium">Open</th><th className="py-2 pr-4 font-medium">Late steps</th><th className="py-2 pr-4 font-medium">Closing this week</th><th className="py-2 pr-5 font-medium">Last activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.members.map((m) => (
                  <tr key={m.id} className="text-slate-300">
                    <td className="px-5 py-2 text-slate-100">{m.name}</td>
                    <td className="py-2 pr-4">{m.openDeals}</td>
                    <td className={`py-2 pr-4 ${m.lateTasks > 0 ? 'text-red-300' : ''}`}>{m.lateTasks}{m.lateDeals > 0 ? ` on ${m.lateDeals} file${m.lateDeals === 1 ? '' : 's'}` : ''}</td>
                    <td className="py-2 pr-4">{m.closingThisWeek}</td>
                    <td className="py-2 pr-5 text-slate-400">{ago(m.lastActivity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="bg-white/5 border border-white/10 rounded-2xl">
            <h2 className="text-sm font-semibold text-slate-100 px-5 py-3 border-b border-white/5">Needs a word</h2>
            {data.attention.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-400">Nothing is behind, closing soon or quiet. Good.</p>
            ) : (
              <ul className="divide-y divide-white/5">
                {data.attention.map((a, i) => (
                  <li key={`${a.dealId}-${i}`} className="px-5 py-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-slate-100">{a.address}</p>
                      <p className="text-xs text-slate-500">{a.member}</p>
                    </div>
                    <p className={`text-xs ${TONE[a.tone]}`}>{WHY[a.tone]}: {a.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <p className="text-sm font-semibold text-slate-100">Team checklist</p>
          <p className="text-xs text-slate-400 mt-1 mb-3">The steps every file starts with, for your whole team.</p>
          {goTo && <button type="button" onClick={() => goTo('requirements')} className="text-sm text-blue-400 hover:text-blue-300">Set it up →</button>}
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <p className="text-sm font-semibold text-slate-100">Private by design</p>
          <p className="text-xs text-slate-400 mt-1">Each coordinator’s files stay theirs. You see addresses, stages and deadlines, never prices, client details or documents.</p>
        </div>
      </div>
    </div>
  );
}
