'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { KpiTiles, money, type Trends } from '@/components/BrokerageReports';

// The brokerage's numbers at the bottom of the broker's Home: headline figures, a six-month chart, and a way into the full Reports tab.
export default function BrokerageTrendsSummary() {
  const [data, setData] = useState<Trends | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    authFetch('/api/oversight/reports/trends?months=6&period=3')
      .then(async (r) => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(); if (live) setData(b); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  if (failed) return null;
  if (!data) return <p className="text-sm text-slate-500 mt-8">Loading your numbers…</p>;
  const team = data.mode === 'team';
  const cash = data.showMoney !== false;
  const val = (p: { volume: number; closedDeals: number }) => (cash ? p.volume : p.closedDeals);
  const show = (n: number) => (cash ? money(n) : String(n));
  const max = Math.max(1, ...data.series.map(val));
  const w = 600, h = 90, gap = 8, bar = (w - gap * (data.series.length - 1)) / data.series.length;

  return (
    <section className="mt-8" aria-label={team ? 'Team trends' : 'Brokerage trends'}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-slate-100 font-semibold">{team ? 'Team at a glance' : 'Brokerage at a glance'}</h2>
        <Link href="/dashboard/reports" className="text-sm text-blue-400 hover:text-blue-300">{team ? 'Trends and team reports →' : 'Trends and deal report →'}</Link>
      </div>
      <KpiTiles data={data} period={3} />
      <div className="bg-white/5 border border-white/10 rounded-2xl p-4 mt-3">
        <p className="text-xs text-slate-500 mb-2">{cash ? 'Sales volume by month, last 6 months' : 'Closed files by month, last 6 months'}</p>
        <svg viewBox={`0 0 ${w} ${h + 20}`} className="w-full h-auto" role="img" aria-label={cash ? 'Sales volume by month' : 'Closed files by month'}>
          {data.series.map((p, i) => {
            const bh = Math.round((val(p) / max) * h);
            const x = i * (bar + gap);
            return (
              <g key={p.month}>
                <rect x={x} y={h - bh} width={bar} height={Math.max(bh, val(p) > 0 ? 2 : 0)} rx="3" className="fill-blue-500/70" />
                <title>{cash ? `${p.month}: ${p.closedDeals} closed, ${money(p.volume)}` : `${p.month}: ${p.closedDeals} closed`}</title>
                <text x={x + bar / 2} y={h + 14} textAnchor="middle" className="fill-slate-500 text-[10px]">{new Date(`${p.month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short' })}</text>
                {val(p) > 0 && <text x={x + bar / 2} y={h - bh - 3} textAnchor="middle" className="fill-slate-300 text-[10px]">{show(val(p))}</text>}
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
