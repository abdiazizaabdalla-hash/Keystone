'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { readSpreadsheetFile } from '@/lib/readSpreadsheet';
import { autoMapQb, normName, readQbRows, splitHeader, DEFAULT_ITEM_NAME, QB_FIELDS, QB_MAX_INVOICES_PER_FILE, type QbFieldKey } from '@/lib/quickbooks';

// Move invoices between Relay and QuickBooks Online by file. No QuickBooks login or permissions are involved:
//   Relay -> QuickBooks: download CSV files and use QuickBooks' own Import data screen.
//   QuickBooks -> Relay: upload a QuickBooks export (Excel or CSV); check the matches; import.

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
  status: 'ready' | 'needs_match' | 'duplicate';
  agentId: string | null;
  transactionId: string | null;
}
interface AgentOpt {
  id: string;
  name: string;
}
interface DealOpt {
  id: string;
  agent_id: string;
  file_number: string;
  property_address: string;
}
interface ImportResult {
  created: number;
  createdAgents?: number;
  createdDeals?: number;
  createdInvoiceIds?: string[];
  createdDealIds?: string[];
  createdAgentIds?: string[];
  skipped: { number: string; reason: string }[];
}
interface UndoInfo {
  at: number;
  invoiceIds: string[];
  dealIds: string[];
  agentIds: string[];
}
const LAST_IMPORT_KEY = 'relay-last-quickbooks-import';

/** The flat fee an agent most likely charges: the amount that appears most often on their invoices (latest wins a tie). */
function suggestFees(rows: { customer: string; amount: number; date: string }[]): Record<string, string> {
  const per = new Map<string, Map<number, { n: number; last: string }>>();
  for (const r of rows) {
    const key = normName(r.customer || 'Unknown customer');
    const m = per.get(key) || new Map<number, { n: number; last: string }>();
    const e = m.get(r.amount) || { n: 0, last: '' };
    e.n += 1;
    if (r.date > e.last) e.last = r.date;
    m.set(r.amount, e);
    per.set(key, m);
  }
  const out: Record<string, string> = {};
  for (const [key, m] of per) {
    let best: number | null = null;
    let bestE = { n: 0, last: '' };
    for (const [amount, e] of m) {
      if (best === null || e.n > bestE.n || (e.n === bestE.n && e.last > bestE.last)) {
        best = amount;
        bestE = e;
      }
    }
    out[key] = best === null ? '' : String(best);
  }
  return out;
}

interface Pick {
  include: boolean;
  agentId: string;
  transactionId: string;
  paid: boolean;
}

// Pick value meaning "make this QuickBooks customer a new agent".
const NEW_AGENT = '__new__';

const input = 'bg-slate-800/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none';
const card = 'bg-white/5 border border-white/10 rounded-2xl p-6';
const btnPrimary = 'px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50';
const btnGhost = 'px-4 py-2 border border-slate-600 hover:border-slate-500 text-slate-300 hover:text-slate-100 text-sm rounded-lg transition disabled:opacity-50';
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function QuickBooksPage() {
  const router = useRouter();
  const goAuth = (e: unknown) => {
    if (e instanceof AuthRequiredError) {
      router.push('/auth');
      return true;
    }
    return false;
  };

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
    return `/api/quickbooks/export?${p.toString()}`;
  };

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try {
        const res = await authFetch(qs('count'));
        if (res.ok && live) setCount(await res.json());
      } catch (e) {
        if (!goAuth(e)) console.error(e);
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
      if (!goAuth(e)) setExportMsg(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setDownloading(null);
    }
  };

  // ---------------- import ----------------
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<{ headers: string[]; body: string[][] } | null>(null);
  const [map, setMap] = useState<Record<QbFieldKey, number> | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [issues, setIssues] = useState<{ row: number; reason: string }[]>([]);
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [agents, setAgents] = useState<AgentOpt[]>([]);
  const [deals, setDeals] = useState<DealOpt[]>([]);
  const [agentSlots, setAgentSlots] = useState<number | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [busy, setBusy] = useState(false);
  const [importError, setImportError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fees, setFees] = useState<Record<string, string>>({});
  const [lastImport, setLastImport] = useState<UndoInfo | null>(null);
  const [undoAsk, setUndoAsk] = useState(false);
  const [undoMsg, setUndoMsg] = useState('');

  // The most recent import can be undone, even after leaving the page (kept in this browser only).
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = localStorage.getItem(LAST_IMPORT_KEY);
        if (!raw) return;
        const v = JSON.parse(raw) as UndoInfo;
        if (v && Array.isArray(v.invoiceIds) && v.invoiceIds.length && Date.now() - v.at < 14 * 86400000) setLastImport(v);
      } catch {
        /* storage unavailable: undo is then offered right after the import only */
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const reset = () => {
    setFileName('');
    setTable(null);
    setMap(null);
    setRows(null);
    setIssues([]);
    setPicks([]);
    setResult(null);
    setFees({});
    setUndoAsk(false);
    setUndoMsg('');
    setImportError('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const runPreview = async (t: { headers: string[]; body: string[][] }, m: Record<QbFieldKey, number>) => {
    setImportError('');
    setBusy(true);
    try {
      const { rows: parsed, issues: bad } = readQbRows(t.body, m);
      setIssues(bad);
      if (parsed.length === 0) {
        setRows(null);
        setImportError(bad.length ? 'None of the lines could be read as invoices. Check the column choices below.' : 'No invoices found in that file.');
        return;
      }
      const res = await authFetch('/api/quickbooks/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'preview', rows: parsed.slice(0, 500) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not check that file');
      setRows(data.rows);
      setAgents(data.agents);
      setDeals(data.deals);
      setAgentSlots(typeof data.agentSlots === 'number' ? data.agentSlots : null);
      setFees(suggestFees((data.rows as PreviewRow[]).filter((r) => r.status !== 'duplicate')));
      setPicks(
        (data.rows as PreviewRow[]).map((r) => ({
          include: r.status !== 'duplicate',
          agentId: r.agentId || NEW_AGENT,
          transactionId: r.transactionId || '',
          paid: r.balance === 0,
        }))
      );
      if (parsed.length > 500) setImportError('Only the first 500 invoices are shown. Import these, then upload the file again for the rest.');
    } catch (e) {
      if (!goAuth(e)) setImportError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    reset();
    setFileName(file.name);
    setBusy(true);
    try {
      const all = await readSpreadsheetFile(file);
      const t = splitHeader(all);
      if (!t) {
        setImportError('Could not find invoice columns in that file. It needs at least an invoice number, a customer and an amount. Use QuickBooks Sales → Invoices → Export, or the Invoice List report.');
        return;
      }
      const m = autoMapQb(t.headers);
      setTable(t);
      setMap(m);
      const missing = QB_FIELDS.filter((f) => f.required && m[f.key] < 0);
      if (missing.length) {
        setShowMap(true);
        setImportError(`Pick the column for: ${missing.map((f) => f.label).join(', ')}.`);
        return;
      }
      await runPreview(t, m);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Could not read that file');
    } finally {
      setBusy(false);
    }
  };

  const setPick = (i: number, patch: Partial<Pick>) => setPicks((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const ready = rows ? rows.filter((_, i) => picks[i]?.include) : [];
  // Every customer in the file that is not an agent yet, with the flat fee that will be set on them.
  const newAgentList = useMemo(() => {
    const seen = new Map<string, string>();
    (rows || []).forEach((r, i) => {
      if (picks[i]?.include && picks[i].agentId === NEW_AGENT) {
        const name = (r.customer || 'Unknown customer').trim();
        seen.set(normName(name), name);
      }
    });
    return [...seen.entries()].map(([key, name]) => ({ key, name }));
  }, [rows, picks]);
  const paidCount = rows ? rows.filter((_, i) => picks[i]?.include && picks[i].paid).length : 0;
  const selectedCount = ready.length;
  const setAll = (patch: Partial<Pick>) => setPicks((prev) => prev.map((p, i) => (rows?.[i]?.status === 'duplicate' ? p : { ...p, ...patch })));
  const setPaidForSelected = (paid: boolean) => setPicks((prev) => prev.map((p) => (p.include ? { ...p, paid } : p)));

  const doImport = async () => {
    if (!rows) return;
    setBusy(true);
    setImportError('');
    try {
      const payload = rows
        .map((r, i) => ({ r, p: picks[i] }))
        .filter(({ p }) => p?.include)
        .map(({ r, p }) => ({
          number: r.number,
          amount: r.amount,
          date: r.date,
          due: r.due,
          customer: r.customer,
          text: r.text,
          agentId: p.agentId === NEW_AGENT ? '' : p.agentId,
          transactionId: p.transactionId,
          paid: p.paid,
          paidDate: r.paid_date,
        }));
      const res = await authFetch('/api/quickbooks/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'commit',
          rows: payload,
          newAgents: newAgentList.map((a) => ({ name: a.name, flatFee: Number(fees[a.key]) >= 0 && fees[a.key] !== '' ? Number(fees[a.key]) : undefined })),
        }),
      });
      const data = (await res.json()) as ImportResult & { error?: string };
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setResult(data);
      if (data.createdInvoiceIds?.length) {
        const info: UndoInfo = { at: Date.now(), invoiceIds: data.createdInvoiceIds, dealIds: data.createdDealIds || [], agentIds: data.createdAgentIds || [] };
        setLastImport(info);
        try {
          localStorage.setItem(LAST_IMPORT_KEY, JSON.stringify(info));
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      if (!goAuth(e)) setImportError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  const doUndo = async () => {
    if (!lastImport) return;
    setBusy(true);
    setUndoMsg('');
    try {
      const res = await authFetch('/api/quickbooks/import', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceIds: lastImport.invoiceIds, dealIds: lastImport.dealIds, agentIds: lastImport.agentIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not undo');
      setUndoMsg(
        `Undone: removed ${data.removedInvoices} invoice${data.removedInvoices === 1 ? '' : 's'}` +
          (data.removedAgents ? `, ${data.removedAgents} agent${data.removedAgents === 1 ? '' : 's'}` : '') +
          (data.removedDeals ? ` and ${data.removedDeals} placeholder deal${data.removedDeals === 1 ? '' : 's'}` : '') +
          '.' +
          (data.kept?.length ? ` ${data.kept.length} already sent to QuickBooks were left in place.` : '')
      );
      setLastImport(null);
      setResult(null);
      setUndoAsk(false);
      try {
        localStorage.removeItem(LAST_IMPORT_KEY);
      } catch {
        /* ignore */
      }
    } catch (e) {
      if (!goAuth(e)) setUndoMsg(e instanceof Error ? e.message : 'Could not undo');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen px-4 py-6 md:px-6 md:py-12">
      <div className="max-w-5xl mx-auto space-y-8">
        <div>
          <Link href="/dashboard/invoices" className="text-sm text-slate-400 hover:text-slate-200">
            ← Back to invoices
          </Link>
          <h1 className="text-3xl md:text-4xl font-display font-semibold text-slate-100 mt-2 mb-2">QuickBooks</h1>
          <p className="text-slate-400">
            Move invoices between Relay and QuickBooks Online with files: you download or upload, and you stay in control. To have new invoices and payments go across automatically, connect QuickBooks in Settings.
          </p>
        </div>

        {/* ---------------- Export ---------------- */}
        <section className={card}>
          <h2 className="text-lg font-bold text-slate-100 mb-1">Send Relay invoices to QuickBooks</h2>
          <p className="text-sm text-slate-400 mb-5">Download a file, then import it in QuickBooks. Duplicates are your call: only export invoices you have not already entered there.</p>

          <div className="grid gap-4 sm:grid-cols-4 mb-5">
            <label className="text-sm text-slate-400">
              Invoices
              <select value={status} onChange={(e) => setStatus(e.target.value as 'open' | 'all')} className={`${input} w-full mt-1`}>
                <option value="all">Paid and unpaid</option>
                <option value="open">Unpaid only</option>
              </select>
            </label>
            <label className="text-sm text-slate-400">
              From
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${input} w-full mt-1`} />
            </label>
            <label className="text-sm text-slate-400">
              To
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${input} w-full mt-1`} />
            </label>
            <label className="text-sm text-slate-400">
              QuickBooks product/service
              <input value={item} onChange={(e) => setItem(e.target.value)} maxLength={100} placeholder="Leave blank to skip" className={`${input} w-full mt-1`} />
            </label>
          </div>

          <p className="text-xs text-slate-500 -mt-2 mb-4">
            The product/service must already exist in your QuickBooks (Settings → Products and services), or QuickBooks cannot match that column. “Services” is the one QuickBooks starts with. Not sure? Clear the box: each line then carries just its description, “Transaction coordination fee – address”.
          </p>

          <div className="flex flex-wrap items-center gap-2 mb-2">
            {count && count.parts > 1 ? (
              Array.from({ length: count.parts }, (_, i) => (
                <button key={i} type="button" disabled={downloading !== null} onClick={() => download(`inv${i}`, qs('invoices', { part: String(i + 1) }))} className={btnPrimary}>
                  {downloading === `inv${i}` ? 'Preparing…' : `Invoices file ${i + 1} of ${count.parts}`}
                </button>
              ))
            ) : (
              <button type="button" disabled={downloading !== null || count?.count === 0} onClick={() => download('inv0', qs('invoices'))} className={btnPrimary}>
                {downloading === 'inv0' ? 'Preparing…' : 'Download invoices'}
              </button>
            )}
            <button type="button" disabled={downloading !== null} onClick={() => download('pay', qs('payments'))} className={btnGhost}>
              {downloading === 'pay' ? 'Preparing…' : 'Payments report'}
            </button>
            <button type="button" disabled={downloading !== null} onClick={() => download('cust', qs('customers'))} className={btnGhost}>
              {downloading === 'cust' ? 'Preparing…' : 'Agents as customers'}
            </button>
          </div>
          <p className="text-xs text-slate-500 mb-1">
            {count ? `${count.count} invoice${count.count === 1 ? '' : 's'} will be in the file (${count.unpaid} unpaid, ${count.paid} paid in this date range).` : 'Counting…'}
            {count && count.count === 0 && count.paid + count.unpaid > 0 ? ' Switch to “Paid and unpaid” to include the rest.' : ''} QuickBooks accepts up to {QB_MAX_INVOICES_PER_FILE} invoices per file, so bigger sets download in parts.
          </p>
          {exportMsg && <p className="text-sm text-red-400 mt-2">{exportMsg}</p>}

          <details className="mt-5 text-sm text-slate-300">
            <summary className="cursor-pointer text-slate-200 font-semibold">How to import these in QuickBooks</summary>
            <ol className="list-decimal pl-5 mt-3 space-y-2 text-slate-400">
              <li>
                <span className="text-slate-300">Customers first.</span> Download “Agents as customers”. In QuickBooks Online open Settings (gear) → Import data → Customers, upload it and map the columns. Skip this if your agents are already customers there with the same names.
              </li>
              <li>
                <span className="text-slate-300">Product/service.</span> The “Item(Product/Service)” column must name something in your QuickBooks products and services. Type its exact name in the box above before you download, or clear the box to leave that column empty. Leave Terms, Service Date, Email and Note to customer on “Select…”.
              </li>
              <li>
                <span className="text-slate-300">Invoices.</span> Settings → Import data → Invoices, upload the file, and check each column is mapped (InvoiceNo, Customer, InvoiceDate, DueDate and the item columns). QuickBooks takes {QB_MAX_INVOICES_PER_FILE} invoices per file, and its import is not available for companies that charge sales tax on these items.
              </li>
              <li>
                <span className="text-slate-300">Payments.</span> QuickBooks’ invoice import cannot record payments. Use the Payments report as your list, and record each one in QuickBooks with Receive payment. If Stripe pays you out, note that the amounts are before Stripe’s fees.
              </li>
            </ol>
          </details>
        </section>

        {/* ---------------- Import ---------------- */}
        <section className={card}>
          <h2 className="text-lg font-bold text-slate-100 mb-1">Bring QuickBooks invoices into Relay</h2>
          <p className="text-sm text-slate-400 mb-5">
            In QuickBooks open Sales → Invoices and use the Export button (or run the Invoice List report and export it), then upload the file here. You can upload Excel or CSV. You see every match before anything is saved, and existing Relay invoices are never changed.
          </p>

          {!rows && !result && (
            <div
              className="border-2 border-dashed border-slate-600 rounded-xl p-8 text-center bg-slate-800/40"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                onFile(e.dataTransfer.files?.[0]);
              }}
            >
              <p className="text-slate-200 font-semibold mb-1">{busy ? 'Reading…' : 'Drop your QuickBooks file here'}</p>
              <p className="text-sm text-slate-500 mb-4">.xlsx or .csv, up to 5 MB</p>
              <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className={btnPrimary}>
                Choose a file
              </button>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            </div>
          )}

          {importError && <p className="text-sm text-red-400 mt-3">{importError}</p>}

          {table && map && !result && (
            <div className="mt-4">
              <button type="button" onClick={() => setShowMap((v) => !v)} className="text-sm text-blue-400 hover:text-blue-300 underline">
                {showMap ? 'Hide columns' : 'Check which columns were used'}
              </button>
              {showMap && (
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {QB_FIELDS.map((f) => (
                    <label key={f.key} className="text-xs text-slate-400">
                      {f.label}
                      {f.required ? ' *' : ''}
                      <select
                        value={map[f.key]}
                        onChange={(e) => setMap({ ...map, [f.key]: Number(e.target.value) })}
                        className={`${input} w-full mt-1`}
                      >
                        <option value={-1}>— none —</option>
                        {table.headers.map((h, i) => (
                          <option key={i} value={i}>
                            {h || `Column ${i + 1}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <div className="sm:col-span-3">
                    <button type="button" disabled={busy} onClick={() => runPreview(table, map)} className={btnGhost}>
                      Read the file again
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {undoMsg && <p className="mt-2 rounded-lg border border-slate-600 bg-slate-800/60 p-3 text-sm text-slate-200">{undoMsg}</p>}
          {lastImport && !result && !rows && (
            <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-slate-600 bg-slate-800/60 p-3 text-sm text-slate-300">
              <span>
                Your last import added {lastImport.invoiceIds.length} invoice{lastImport.invoiceIds.length === 1 ? '' : 's'}
                {lastImport.agentIds.length ? ` and ${lastImport.agentIds.length} new agent${lastImport.agentIds.length === 1 ? '' : 's'}` : ''}.
              </span>
              {!undoAsk ? (
                <button type="button" onClick={() => setUndoAsk(true)} className={btnGhost}>
                  Undo it
                </button>
              ) : (
                <span className="flex items-center gap-2">
                  Remove them?
                  <button type="button" disabled={busy} onClick={doUndo} className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                    Yes, undo
                  </button>
                  <button type="button" onClick={() => setUndoAsk(false)} className={btnGhost}>
                    Keep
                  </button>
                </span>
              )}
            </div>
          )}

          {rows && !result && (
            <div className="mt-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3 text-sm">
                <p className="text-slate-300">
                  <span className="font-semibold">{fileName}</span> · {rows.length} invoice{rows.length === 1 ? '' : 's'} · {ready.length} ready to import
                </p>
                <button type="button" onClick={reset} className="text-slate-400 hover:text-slate-200 underline">
                  Choose a different file
                </button>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                Everything in the file comes in. Customers that are not agents yet are added as agents (name and flat fee only), and invoices are saved on their own, with no deal needed. Imported invoices are numbered with a QB- prefix.
              </p>

              {newAgentList.length > 0 && (
                <div className="mb-4 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
                  <p className="text-sm font-semibold text-slate-100">
                    {newAgentList.length} new agent{newAgentList.length === 1 ? '' : 's'} will be added
                  </p>
                  <p className="text-xs text-slate-400 mb-2">Just a name and a flat fee. The fee is the amount charged most often in your file; change it here or later on the Agents page.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {newAgentList.map((a) => (
                      <label key={a.key} className="flex items-center justify-between gap-3 rounded-md bg-slate-800/60 px-3 py-2 text-sm text-slate-200">
                        <span className="truncate">{a.name}</span>
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                          Flat fee $
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={fees[a.key] ?? ''}
                            onChange={(e) => setFees((f) => ({ ...f, [a.key]: e.target.value }))}
                            className={`${input} w-24 py-1`}
                          />
                        </span>
                      </label>
                    ))}
                  </div>
                  {agentSlots !== null && newAgentList.length > agentSlots && (
                    <p className="mt-2 text-xs text-amber-300">
                      Your plan has room for {agentSlots} more agent profile{agentSlots === 1 ? '' : 's'}. Invoices for the rest will be skipped unless you upgrade or pick an existing agent for them.
                    </p>
                  )}
                </div>
              )}

              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-400">
                  {selectedCount} selected · {paidCount} marked paid
                </span>
                <button type="button" onClick={() => setAll({ include: true })} className={btnGhost}>
                  Select all
                </button>
                <button type="button" onClick={() => setAll({ include: false })} className={btnGhost}>
                  Select none
                </button>
                <button type="button" onClick={() => setPaidForSelected(true)} className={btnGhost}>
                  Mark selected paid
                </button>
                <button type="button" onClick={() => setPaidForSelected(false)} className={btnGhost}>
                  Mark selected unpaid
                </button>
              </div>

              <div className="rounded-lg border border-slate-600 divide-y divide-slate-700 bg-slate-800/40">
                {rows.map((r, i) => {
                  const p = picks[i];
                  if (!p) return null;
                  const dup = r.status === 'duplicate';
                  const linked = p.transactionId ? deals.find((d) => d.id === p.transactionId) : undefined;
                  return (
                    <div key={`${r.number}-${i}`} className={`flex flex-wrap items-center gap-3 px-3 py-2 ${dup ? 'opacity-50' : ''}`}>
                      <input type="checkbox" checked={p.include && !dup} disabled={dup} onChange={(e) => setPick(i, { include: e.target.checked })} className="h-4 w-4 accent-blue-500" />
                      <div className="w-36 shrink-0">
                        <div className="font-mono text-sm text-blue-300 truncate">{r.number}</div>
                        <div className="text-xs text-slate-500">{r.date || 'no date'}</div>
                      </div>
                      {dup ? (
                        <span className="flex-1 text-xs text-slate-400">Already in Relay</span>
                      ) : (
                        <>
                          <div className="flex-1 min-w-[10rem]">
                            <select
                              value={p.agentId}
                              onChange={(e) => setPick(i, { agentId: e.target.value, transactionId: '' })}
                              className={`${input} w-full py-1.5`}
                              aria-label={`Agent for invoice ${r.number}`}
                            >
                              <option value={NEW_AGENT}>{r.customer || 'Unknown customer'} (new agent)</option>
                              {agents.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                            </select>
                            {linked && <div className="mt-0.5 text-xs text-slate-500 truncate">Linked to {linked.property_address} ({linked.file_number})</div>}
                          </div>
                          <div className="w-24 text-right text-sm font-semibold text-slate-100">{money(r.amount)}</div>
                          <label className="flex items-center gap-1.5 text-xs text-slate-300 w-16">
                            <input type="checkbox" checked={p.paid} onChange={(e) => setPick(i, { paid: e.target.checked })} className="h-4 w-4 accent-green-500" />
                            Paid
                          </label>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {issues.length > 0 && (
                <details className="mt-3 text-xs text-slate-500">
                  <summary className="cursor-pointer">{issues.length} line{issues.length === 1 ? '' : 's'} in the file could not be read</summary>
                  <ul className="mt-2 space-y-0.5">
                    {issues.slice(0, 30).map((s, k) => (
                      <li key={k}>
                        Line {s.row}: {s.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <div className="mt-5 flex items-center gap-3">
                <button type="button" disabled={busy || ready.length === 0} onClick={doImport} className={btnPrimary}>
                  {busy ? 'Importing…' : `Import ${ready.length} invoice${ready.length === 1 ? '' : 's'}`}
                </button>
                <p className="text-xs text-slate-500">“Already paid” invoices are saved as paid for the full amount. The payment date is the invoice date unless the file has one.</p>
              </div>
            </div>
          )}

          {result && (
            <div className="mt-2 rounded-lg border border-green-700/50 bg-green-900/20 p-4">
              <p className="text-green-300 font-semibold">
                Imported {result.created} invoice{result.created === 1 ? '' : 's'}
                {result.createdAgents ? `, added ${result.createdAgents} new agent${result.createdAgents === 1 ? '' : 's'}` : ''}
                {result.createdDeals ? `, and saved ${result.createdDeals} without a deal` : ''}.
              </p>
              {result.skipped.length > 0 && (
                <ul className="mt-2 text-sm text-slate-300 space-y-0.5">
                  {result.skipped.map((s, k) => (
                    <li key={k}>
                      {s.number}: {s.reason}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Link href="/dashboard/invoices" className={btnPrimary}>
                  See invoices
                </Link>
                <button type="button" onClick={reset} className={btnGhost}>
                  Import another file
                </button>
                {lastImport && !undoAsk && (
                  <button type="button" onClick={() => setUndoAsk(true)} className={btnGhost}>
                    Undo this import
                  </button>
                )}
                {lastImport && undoAsk && (
                  <span className="flex items-center gap-2 text-sm text-slate-200">
                    Remove these {lastImport.invoiceIds.length} invoices
                    {lastImport.agentIds.length ? ` and ${lastImport.agentIds.length} new agents` : ''}?
                    <button type="button" disabled={busy} onClick={doUndo} className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                      Yes, undo
                    </button>
                    <button type="button" onClick={() => setUndoAsk(false)} className={btnGhost}>
                      Keep
                    </button>
                  </span>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
