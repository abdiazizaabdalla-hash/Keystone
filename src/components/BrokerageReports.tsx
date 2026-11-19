'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/authClient';

// Reports for a brokerage owner (the Reports tab): trends and comparisons across agents and time, and a deal-level report
// you configure yourself (columns and filters) and download as a CSV. Read-only: nothing here changes an agent's deals.

interface Point { month: string; closedDeals: number; volume: number }
interface CompareRow { agentId: string; name: string; closedDeals: number; volume: number; prevClosedDeals: number; prevVolume: number; newDeals: number; prevNewDeals: number; volumeChange: number | null; closedChange: number | null }
interface Kpis { closedDeals: number; volume: number; avgPrice: number | null; avgDaysToClose: number | null; newDeals: number }
export interface Trends {
  mode?: 'brokerage' | 'team'; showMoney?: boolean;
  months: number; period: number; series: Point[]; agentId: string | null; agents: { id: string; name: string }[];
  comparison: CompareRow[];
  kpis: { current: Kpis; previous: Kpis };
  pipeline: { openDeals: number; openVolume: number; closingNext30: number; closingNext30Volume: number; withOverdueSteps: number };
  totals: { closedDeals: number; volume: number; prevClosedDeals: number; prevVolume: number; newDeals: number; prevNewDeals: number; volumeChange: number | null; closedChange: number | null };
}
interface ReportData {
  columns: { id: string; label: string }[]; rows: (string | number)[][]; total: number; truncated: boolean;
  options: { columns: readonly { id: string; label: string }[]; agents: { id: string; name: string }[]; stages: string[] };
}

const card = 'bg-white/5 border border-white/10 rounded-2xl';
const input = 'bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-slate-100';
export const money = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${Math.round(n)}`);
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
const DEFAULT_COLS = ['address', 'agent', 'status', 'price', 'closing', 'checklist', 'overdue'];
const COLS_KEY = 'relay.brokerageReport.columns';

export function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-500">New</span>;
  if (value === 0) return <span className="text-slate-400">No change</span>;
  return <span className={value > 0 ? 'text-emerald-300' : 'text-red-300'}>{value > 0 ? '+' : ''}{value}%</span>;
}

const pct = (cur: number, prev: number) => (prev === 0 ? (cur === 0 ? 0 : null) : Math.round(((cur - prev) / prev) * 100));

/** The numbers a broker looks at first: what closed, what is open, what closes soon, and what is running late. */
export function KpiTiles({ data, period }: { data: Trends; period: number }) {
  const { current: c, previous: p } = data.kpis;
  const pl = data.pipeline;
  const label = period === 1 ? 'last month' : `last ${period} months`;
  const cash = data.showMoney !== false;
  const all: { label: string; value: string; sub: React.ReactNode; tone?: string; money?: boolean }[] = [
    { label: `Closed, ${label}`, value: String(c.closedDeals), sub: <Change value={pct(c.closedDeals, p.closedDeals)} /> },
    { label: 'Sales volume', value: money(c.volume), sub: <Change value={pct(c.volume, p.volume)} />, money: true },
    { label: 'Average sale price', value: c.avgPrice === null ? '—' : money(c.avgPrice), sub: <span className="text-slate-500">{p.avgPrice === null ? 'No sales before' : `was ${money(p.avgPrice)}`}</span>, money: true },
    { label: 'Days to close', value: c.avgDaysToClose === null ? '—' : String(c.avgDaysToClose), sub: <span className="text-slate-500">{p.avgDaysToClose === null ? 'Acceptance to closing' : `was ${p.avgDaysToClose}`}</span> },
    { label: 'Open now', value: String(pl.openDeals), sub: <span className="text-slate-500">{cash ? `${money(pl.openVolume)} in play` : 'files in progress'}</span> },
    { label: 'Closing in 30 days', value: String(pl.closingNext30), sub: <span className="text-slate-500">{cash ? money(pl.closingNext30Volume) : 'files'}</span> },
    { label: 'With late steps', value: String(pl.withOverdueSteps), sub: <span className="text-slate-500">open deals</span>, tone: pl.withOverdueSteps > 0 ? 'text-amber-300' : '' },
  ];
  const tiles = all.filter((t) => cash || !t.money);
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-4 ${tiles.length >= 7 ? 'lg:grid-cols-7' : 'lg:grid-cols-5'} gap-3`}>
      {tiles.map((t) => (
        <div key={t.label} className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-slate-500 leading-tight">{t.label}</p>
          <p className={`text-2xl font-semibold mt-1 ${t.tone || 'text-slate-100'}`}>{t.value}</p>
          <p className="text-xs mt-0.5">{t.sub}</p>
        </div>
      ))}
    </div>
  );
}

export function TrendsSection() {
  const [months, setMonths] = useState(12);
  const [period, setPeriod] = useState(3);
  const [agent, setAgent] = useState('');
  const [data, setData] = useState<Trends | null>(null);
  const [metricPick, setMetric] = useState<'volume' | 'closedDeals'>('volume');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await authFetch(`/api/oversight/reports/trends?months=${months}&period=${period}${agent ? `&agent=${agent}` : ''}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Could not load trends');
    setData(body);
  }, [months, period, agent]);

  useEffect(() => {
    const t = setTimeout(() => { load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load trends')); }, 0);
    return () => clearTimeout(t);
  }, [load]);

  if (!data) return <p className="text-sm text-slate-400">{error || 'Loading…'}</p>;
  const team = data.mode === 'team';
  const cash = data.showMoney !== false;
  const who = team ? 'Coordinator' : 'Agent';
  const metric = cash ? metricPick : 'closedDeals';
  const max = Math.max(1, ...data.series.map((p) => p[metric]));
  const w = 720, h = 180, gap = 6, bar = (w - gap * (data.series.length - 1)) / data.series.length;

  return (
    <section className={`${card} p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-slate-100 font-semibold">Trends</h2>
          <p className="text-sm text-slate-400">{cash ? 'Closed deals and sales volume by month, and how each agent compares with the period before.' : 'Closed deals by month, and how each coordinator compares with the period before. Prices stay private to each coordinator.'}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <select aria-label={who} value={agent} onChange={(e) => setAgent(e.target.value)} className={input}>
            <option value="">{team ? 'Whole team' : 'All agents'}</option>
            {data.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select aria-label="Months shown" value={months} onChange={(e) => setMonths(Number(e.target.value))} className={input}>
            {[6, 12, 24].map((m) => <option key={m} value={m}>Last {m} months</option>)}
          </select>
          {cash && <select aria-label="Metric" value={metric} onChange={(e) => setMetric(e.target.value as 'volume' | 'closedDeals')} className={input}>
            <option value="volume">Sales volume</option>
            <option value="closedDeals">Closed deals</option>
          </select>}
        </div>
      </div>

      <div className="mb-5"><KpiTiles data={data} period={period} /></div>

      <svg viewBox={`0 0 ${w} ${h + 28}`} className="w-full h-auto" role="img" aria-label={`${metric === 'volume' ? 'Sales volume' : 'Closed deals'} by month`}>
        {data.series.map((p, i) => {
          const bh = Math.round((p[metric] / max) * h);
          const x = i * (bar + gap);
          return (
            <g key={p.month}>
              <rect x={x} y={h - bh} width={bar} height={Math.max(bh, p[metric] > 0 ? 2 : 0)} rx="3" className="fill-blue-500/70" />
              <title>{cash ? `${monthLabel(p.month)}: ${p.closedDeals} closed, ${money(p.volume)}` : `${monthLabel(p.month)}: ${p.closedDeals} closed`}</title>
              {(data.series.length <= 12 || i % 2 === 0) && <text x={x + bar / 2} y={h + 16} textAnchor="middle" className="fill-slate-500 text-[10px]">{monthLabel(p.month)}</text>}
              {p[metric] > 0 && data.series.length <= 12 && <text x={x + bar / 2} y={h - bh - 4} textAnchor="middle" className="fill-slate-300 text-[10px]">{metric === 'volume' ? money(p.volume) : p.closedDeals}</text>}
            </g>
          );
        })}
      </svg>

      <div className="flex flex-wrap items-center justify-between gap-3 mt-6 mb-2">
        <h3 className="text-sm font-semibold text-slate-200">{team ? 'Coordinators' : 'Agents'}, compared with the period before</h3>
        <select aria-label="Period" value={period} onChange={(e) => setPeriod(Number(e.target.value))} className={`${input} text-xs`}>
          {[1, 3, 6, 12].map((p) => <option key={p} value={p}>Last {p} {p === 1 ? 'month' : 'months'} vs the {p} before</option>)}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="py-2 pr-4 font-medium">{who}</th><th className="py-2 pr-4 font-medium">Closed</th><th className="py-2 pr-4 font-medium">vs before</th>
              {cash && <><th className="py-2 pr-4 font-medium">Volume</th><th className="py-2 pr-4 font-medium">vs before</th></>}<th className="py-2 font-medium">New deals</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            <tr className="text-slate-100 font-semibold">
              <td className="py-2 pr-4">{team ? 'Whole team' : 'Whole brokerage'}</td><td className="py-2 pr-4">{data.totals.closedDeals}</td><td className="py-2 pr-4"><Change value={data.totals.closedChange} /></td>
              {cash && <><td className="py-2 pr-4">{money(data.totals.volume)}</td><td className="py-2 pr-4"><Change value={data.totals.volumeChange} /></td></>}<td className="py-2">{data.totals.newDeals} <span className="text-slate-500 font-normal">(was {data.totals.prevNewDeals})</span></td>
            </tr>
            {data.comparison.map((r) => (
              <tr key={r.agentId} className="text-slate-300">
                <td className="py-2 pr-4">{r.name}</td><td className="py-2 pr-4">{r.closedDeals} <span className="text-slate-500">(was {r.prevClosedDeals})</span></td><td className="py-2 pr-4"><Change value={r.closedChange} /></td>
                {cash && <><td className="py-2 pr-4">{money(r.volume)} <span className="text-slate-500">(was {money(r.prevVolume)})</span></td><td className="py-2 pr-4"><Change value={r.volumeChange} /></td></>}<td className="py-2">{r.newDeals} <span className="text-slate-500">(was {r.prevNewDeals})</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function DealReportSection() {
  const [cols, setCols] = useState<string[]>(() => {
    try {
      const saved = typeof window === 'undefined' ? null : JSON.parse(localStorage.getItem(COLS_KEY) || 'null');
      return Array.isArray(saved) && saved.length ? saved : DEFAULT_COLS;
    } catch {
      return DEFAULT_COLS;
    }
  });
  const [agents, setAgents] = useState<string[]>([]);
  const [scope, setScope] = useState<'all' | 'open' | 'closed'>('all');
  const [stages, setStages] = useState<string[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams({ columns: cols.join(','), scope });
    if (agents.length) p.set('agents', agents.join(','));
    if (stages.length) p.set('stages', stages.join(','));
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    return p;
  }, [cols, agents, scope, stages, from, to]);

  const load = useCallback(async () => {
    setError('');
    const res = await authFetch(`/api/oversight/reports/deals?${query}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Could not build the report');
    setData(body);
  }, [query]);

  useEffect(() => {
    const t = setTimeout(() => { load().catch((e) => setError(e instanceof Error ? e.message : 'Could not build the report')); }, 250);
    return () => clearTimeout(t);
  }, [load]);

  const toggleCol = (id: string, on: boolean) => {
    const order = data?.options.columns.map((c) => c.id) ?? [];
    const next = order.filter((c) => (c === id ? on : cols.includes(c)));
    if (next.length === 0) return;
    setCols(next);
    try { localStorage.setItem(COLS_KEY, JSON.stringify(next)); } catch { /* not saved */ }
  };
  const toggle = (list: string[], set: (v: string[]) => void, id: string, on: boolean) => set(on ? [...list, id] : list.filter((x) => x !== id));

  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const p = new URLSearchParams(query);
      p.set('format', 'csv');
      const res = await authFetch(`/api/oversight/reports/deals?${p}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not download');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'deal-report.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not download');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${card} p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-slate-100 font-semibold">Deal report</h2>
          <p className="text-sm text-slate-400">Choose the columns and filters. The report updates as you go, and downloads as a CSV.</p>
        </div>
        <button type="button" onClick={download} disabled={busy || !data} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition">{busy ? 'Preparing…' : 'Download CSV'}</button>
      </div>
      {error && <p className="text-sm text-red-300 mb-3">{error}</p>}

      <div className="grid md:grid-cols-2 gap-5 mb-5">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Columns</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {(data?.options.columns ?? []).map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={cols.includes(c.id)} onChange={(e) => toggleCol(c.id, e.target.checked)} />{c.label}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-wider text-slate-500">Filters</p>
          <div className="flex flex-wrap gap-2">
            {(['all', 'open', 'closed'] as const).map((s) => (
              <button key={s} type="button" onClick={() => setScope(s)} className={`px-3 py-1.5 rounded-full border text-xs ${scope === s ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-slate-600 text-slate-400 hover:text-slate-200'}`}>{s === 'all' ? 'All deals' : s === 'open' ? 'Open' : 'Closed'}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
            Closing between <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} /> and <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
          </div>
          {data && data.options.stages.length > 0 && (
            <details className="text-sm text-slate-300">
              <summary className="cursor-pointer text-slate-400">Stages{stages.length ? ` (${stages.length})` : ''}</summary>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">{data.options.stages.map((s) => <label key={s} className="flex items-center gap-1.5"><input type="checkbox" checked={stages.includes(s)} onChange={(e) => toggle(stages, setStages, s, e.target.checked)} />{s}</label>)}</div>
            </details>
          )}
          {data && data.options.agents.length > 0 && (
            <details className="text-sm text-slate-300">
              <summary className="cursor-pointer text-slate-400">Agents{agents.length ? ` (${agents.length})` : ' (all)'}</summary>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">{data.options.agents.map((a) => <label key={a.id} className="flex items-center gap-1.5"><input type="checkbox" checked={agents.includes(a.id)} onChange={(e) => toggle(agents, setAgents, a.id, e.target.checked)} />{a.name}</label>)}</div>
            </details>
          )}
        </div>
      </div>

      {!data ? <p className="text-sm text-slate-400">Loading…</p> : data.rows.length === 0 ? <p className="text-sm text-slate-400">No deals match these filters.</p> : (
        <>
          <p className="text-xs text-slate-500 mb-2">{data.total} {data.total === 1 ? 'deal' : 'deals'}{data.truncated ? ' (showing the first 2,000)' : ''}{data.rows.length > 50 ? ', first 50 shown here; the download has all of them' : ''}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wider text-slate-500">{data.columns.map((c) => <th key={c.id} className="py-2 pr-4 font-medium whitespace-nowrap">{c.label}</th>)}</tr></thead>
              <tbody className="divide-y divide-white/5">
                {data.rows.slice(0, 50).map((r, i) => (
                  <tr key={i} className="text-slate-300">{r.map((v, j) => <td key={j} className="py-2 pr-4 whitespace-nowrap">{data.columns[j].id === 'price' && typeof v === 'number' ? `$${v.toLocaleString()}` : v === '' ? <span className="text-slate-600">-</span> : v}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export default function BrokerageReports() {
  return (
    <div className="space-y-5">
      <TrendsSection />
      <DealReportSection />
    </div>
  );
}
