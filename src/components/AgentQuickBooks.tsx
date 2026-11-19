'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';
import { readSpreadsheetFile } from '@/lib/readSpreadsheet';
import { autoMapQb, readQbRows, splitHeader, DEFAULT_ITEM_NAME } from '@/lib/quickbooks';

// Move an agent's invoices between Relay and QuickBooks Online by file. No QuickBooks login or permissions are involved:
//   Relay -> QuickBooks: download CSV files and use QuickBooks' own Import data screen.
//   QuickBooks -> Relay: upload a QuickBooks export (Excel or CSV), check it, import.

interface PreviewRow {
  number: string;
  relayNumber: string;
  customer: string;
  amount: number;
  date: string;
  due: string;
  balance: number | null;
  text: string;
  paid_date: string;
  status: 'ready' | 'duplicate';
}
interface Pick {
  include: boolean;
  paid: boolean;
}

const input = 'bg-slate-800/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none';
const card = 'bg-white/5 border border-white/10 rounded-2xl p-6';
const btnPrimary = 'px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50';
const btnGhost = 'px-4 py-2 border border-slate-600 hover:border-slate-500 text-slate-300 hover:text-slate-100 text-sm rounded-lg transition disabled:opacity-50';
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const LAST_KEY = 'relay-agent-last-quickbooks-import';

export default function AgentQuickBooks() {
  // ---------------- export ----------------
  const [status, setStatus] = useState<'open' | 'all'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [item, setItem] = useState(DEFAULT_ITEM_NAME);
  const [count, setCount] = useState<{ count: number; unpaid: number; paid: number; parts: number } | null>(null);
  const [exportMsg, setExportMsg] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);

  const qs = (type: string, extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ type, status, ...extra });
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (type === 'invoices') p.set('item', item.trim());
    return `/api/agent-quickbooks/export?${p.toString()}`;
  };

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try {
        const res = await authFetch(qs('count'));
        if (res.ok && live) setCount(await res.json());
      } catch {
        /* the counts are a convenience */
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, from, to]);

  const download = async (key: string, url: string) => {
    setDownloading(key);
    setExportMsg('');
    try {
      const res = await authFetch(url);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not build the file');
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'relay-quickbooks.csv';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) {
      setExportMsg(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setDownloading(null);
    }
  };

  // ---------------- import ----------------
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [issues, setIssues] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ created: number; ids: string[]; skipped: number } | null>(null);
  const [undoMsg, setUndoMsg] = useState('');

  const reset = () => {
    setFileName('');
    setRows(null);
    setPicks([]);
    setIssues(0);
    setDone(null);
    setError('');
    setUndoMsg('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    reset();
    setFileName(file.name);
    setBusy(true);
    try {
      const all = await readSpreadsheetFile(file);
      const t = splitHeader(all);
      if (!t) throw new Error('That does not look like a QuickBooks invoice export. It needs columns for the invoice number, customer and amount.');
      const map = autoMapQb(t.headers);
      if (map.number < 0 || map.customer < 0 || map.amount < 0) throw new Error('Could not find the invoice number, customer and amount columns in that file.');
      const { rows: parsed, issues: bad } = readQbRows(t.body, map);
      setIssues(bad.length);
      if (parsed.length === 0) throw new Error('No invoices found in that file.');
      const res = await authFetch('/api/agent-quickbooks/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'preview', rows: parsed.slice(0, 500) }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not check that file');
      setRows(data.rows);
      setPicks((data.rows as PreviewRow[]).map((r) => ({ include: r.status !== 'duplicate', paid: r.balance === 0 })));
      if (parsed.length > 500) setError('Only the first 500 invoices are shown. Import these, then upload the file again for the rest.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const chosen = rows ? rows.filter((_, i) => picks[i]?.include && rows[i].status !== 'duplicate') : [];

  const runImport = async () => {
    if (!rows) return;
    setBusy(true);
    setError('');
    try {
      const body = rows.map((r, i) => ({ ...r, include: picks[i]?.include && r.status !== 'duplicate', paid: picks[i]?.paid }));
      const res = await authFetch('/api/agent-quickbooks/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'commit', rows: body }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not import');
      setDone({ created: data.created, ids: data.createdInvoiceIds ?? [], skipped: (data.skipped ?? []).length });
      try {
        localStorage.setItem(LAST_KEY, JSON.stringify({ at: Date.now(), ids: data.createdInvoiceIds ?? [] }));
      } catch {
        /* undo is then offered right after the import only */
      }
      setRows(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not import');
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!done || done.ids.length === 0) return;
    if (!confirm(`Remove the ${done.ids.length} invoices this import added?`)) return;
    setBusy(true);
    try {
      const res = await authFetch('/api/agent-quickbooks/import', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceIds: done.ids }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not undo');
      setUndoMsg(`Removed ${data.removed} invoices.`);
      setDone({ ...done, ids: [] });
    } catch (e) {
      setUndoMsg(e instanceof Error ? e.message : 'Could not undo');
    } finally {
      setBusy(false);
    }
  };

  const totalChosen = chosen.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="min-h-screen px-4 py-6 md:px-6 md:py-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <Link href="/dashboard/invoices" className="text-sm text-slate-400 hover:text-slate-200">← Invoices</Link>
          <h1 className="text-3xl md:text-4xl font-semibold text-slate-100 mt-3 mb-1">QuickBooks import / export</h1>
          <p className="text-slate-400">Move your invoices between Relay and QuickBooks Online with files. No QuickBooks login is needed.</p>
        </div>

        <div className={card}>
          <h2 className="text-lg font-semibold text-slate-100 mb-1">Relay → QuickBooks</h2>
          <p className="text-sm text-slate-400 mb-4">Download your invoices, then in QuickBooks use Import data → Invoices (or Customers). Drafts and voided invoices are left out.</p>
          <div className="grid sm:grid-cols-4 gap-3 mb-4">
            <label className="text-xs text-slate-400">Which
              <select className={`${input} w-full mt-1`} value={status} onChange={(e) => setStatus(e.target.value as 'open' | 'all')}>
                <option value="all">All sent and paid</option>
                <option value="open">Unpaid only</option>
              </select>
            </label>
            <label className="text-xs text-slate-400">From
              <input type="date" className={`${input} w-full mt-1`} value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="text-xs text-slate-400">To
              <input type="date" className={`${input} w-full mt-1`} value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
            <label className="text-xs text-slate-400">QuickBooks product/service
              <input className={`${input} w-full mt-1`} value={item} onChange={(e) => setItem(e.target.value)} maxLength={100} />
            </label>
          </div>
          <p className="text-sm text-slate-300 mb-4">
            {count ? `${count.count} invoice${count.count === 1 ? '' : 's'} match (${count.unpaid} unpaid, ${count.paid} paid).` : 'Counting…'}
          </p>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: Math.max(1, count?.parts ?? 1) }, (_, i) => i + 1).map((part) => (
              <button key={part} type="button" className={btnPrimary} disabled={downloading !== null || !count || count.count === 0} onClick={() => download(`inv${part}`, qs('invoices', { part: String(part) }))}>
                {downloading === `inv${part}` ? 'Preparing…' : (count?.parts ?? 1) > 1 ? `Invoices, part ${part}` : 'Download invoices'}
              </button>
            ))}
            <button type="button" className={btnGhost} disabled={downloading !== null} onClick={() => download('pay', qs('payments'))}>
              {downloading === 'pay' ? 'Preparing…' : 'Payments received'}
            </button>
            <button type="button" className={btnGhost} disabled={downloading !== null} onClick={() => download('cust', qs('customers'))}>
              {downloading === 'cust' ? 'Preparing…' : 'Customers'}
            </button>
          </div>
          {exportMsg && <p className="text-sm text-red-300 mt-3">{exportMsg}</p>}
        </div>

        <div className={card}>
          <h2 className="text-lg font-semibold text-slate-100 mb-1">QuickBooks → Relay</h2>
          <p className="text-sm text-slate-400 mb-4">In QuickBooks, export your invoices (a Reports → Invoice List export works) as Excel or CSV, then upload it here. Each invoice is added to your Invoices as sent, or as paid when it has no balance left.</p>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={(e) => onFile(e.target.files?.[0])} className="block text-sm text-slate-300 mb-4" />
          {busy && !rows && <p className="text-sm text-slate-400">Reading {fileName}…</p>}
          {error && <p className="text-sm text-red-300 mb-3">{error}</p>}

          {rows && (
            <div>
              <p className="text-sm text-slate-300 mb-3">
                {rows.length} invoice{rows.length === 1 ? '' : 's'} found in {fileName}
                {issues > 0 ? ` (${issues} line${issues === 1 ? '' : 's'} skipped: totals, blanks or unreadable amounts)` : ''}. Untick any you do not want.
              </p>
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full text-sm">
                  <thead className="text-xs text-slate-400 bg-white/5">
                    <tr>
                      <th className="text-left px-3 py-2">Add</th>
                      <th className="text-left px-3 py-2">Number</th>
                      <th className="text-left px-3 py-2">Customer</th>
                      <th className="text-left px-3 py-2">Date</th>
                      <th className="text-right px-3 py-2">Amount</th>
                      <th className="text-left px-3 py-2">Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={`${r.number}-${i}`} className="border-t border-white/5">
                        <td className="px-3 py-2">
                          <input type="checkbox" disabled={r.status === 'duplicate'} checked={!!picks[i]?.include && r.status !== 'duplicate'} onChange={(e) => setPicks((p) => p.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))} />
                        </td>
                        <td className="px-3 py-2 text-slate-200">{r.relayNumber}{r.status === 'duplicate' && <span className="ml-2 text-xs text-amber-300">already here</span>}</td>
                        <td className="px-3 py-2 text-slate-300">{r.customer}</td>
                        <td className="px-3 py-2 text-slate-400">{r.date || '—'}</td>
                        <td className="px-3 py-2 text-right text-slate-100">{money(r.amount)}</td>
                        <td className="px-3 py-2">
                          <input type="checkbox" disabled={r.status === 'duplicate'} checked={!!picks[i]?.paid} onChange={(e) => setPicks((p) => p.map((x, j) => (j === i ? { ...x, paid: e.target.checked } : x)))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-4">
                <button type="button" className={btnPrimary} disabled={busy || chosen.length === 0} onClick={runImport}>
                  {busy ? 'Importing…' : `Import ${chosen.length} invoice${chosen.length === 1 ? '' : 's'} (${money(totalChosen)})`}
                </button>
                <button type="button" className={btnGhost} onClick={reset}>Cancel</button>
              </div>
            </div>
          )}

          {done && (
            <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-200">
              <p>Imported {done.created} invoice{done.created === 1 ? '' : 's'}{done.skipped > 0 ? `, ${done.skipped} skipped` : ''}.</p>
              <div className="flex flex-wrap items-center gap-3 mt-3">
                <Link href="/dashboard/invoices" className="text-blue-300 hover:text-blue-200">View invoices</Link>
                {done.ids.length > 0 && (
                  <button type="button" onClick={undo} disabled={busy} className="text-slate-300 hover:text-slate-100 underline disabled:opacity-50">Undo this import</button>
                )}
                <button type="button" onClick={reset} className="text-slate-300 hover:text-slate-100 underline">Import another file</button>
              </div>
              {undoMsg && <p className="mt-2 text-slate-200">{undoMsg}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
