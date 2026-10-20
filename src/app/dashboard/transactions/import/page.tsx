'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import {
  autoMap,
  IMPORT_FIELDS,
  MAX_IMPORT_ROWS,
  normalizeAddress,
  parseCsv,
  parseDate,
  parsePrice,
  type ImportFieldKey,
} from '@/lib/csvImport';

// Bring deals in from a spreadsheet (an AFrame export, for example): pick the
// file, check which column is which, preview, import. Existing deals (same
// address) are skipped, so running the same file twice is safe.

interface AgentRecord {
  id: string;
  name: string;
  email: string | null;
}
interface TxRecord {
  property_address: string;
}
interface RowResult {
  row: number;
  address: string;
  status: 'created' | 'skipped' | 'failed';
  note?: string;
}

const PRESET_KEY = 'relay_import_mapping_v1';

// The column match from the last import of a file with these exact column names,
// so the next export from the same tool needs no fixing. Stored in this browser only.
function loadPreset(headers: string[]): Record<ImportFieldKey, number> | null {
  try {
    const raw = window.localStorage.getItem(PRESET_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { signature: string; byHeader: Record<string, string> };
    if (saved.signature !== headers.map((h) => h.toLowerCase()).join('|')) return null;
    const mapping = {} as Record<ImportFieldKey, number>;
    for (const f of IMPORT_FIELDS) {
      const name = saved.byHeader[f.key];
      mapping[f.key] = name ? headers.findIndex((h) => h.toLowerCase() === name) : -1;
    }
    return mapping;
  } catch {
    return null;
  }
}

function savePreset(headers: string[], mapping: Record<ImportFieldKey, number>) {
  try {
    const byHeader: Record<string, string> = {};
    for (const f of IMPORT_FIELDS) if (mapping[f.key] >= 0) byHeader[f.key] = headers[mapping[f.key]].toLowerCase();
    window.localStorage.setItem(
      PRESET_KEY,
      JSON.stringify({ signature: headers.map((h) => h.toLowerCase()).join('|'), byHeader })
    );
  } catch {
    // Storage can be blocked; the import still works.
  }
}

const selectCls = 'bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none w-full';

export default function ImportTransactionsPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<ImportFieldKey, number> | null>(null);
  const [createAgents, setCreateAgents] = useState(true);
  const [prefix, setPrefix] = useState('AF');
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<RowResult[] | null>(null);
  const [usedPreset, setUsedPreset] = useState(false);
  const [createdTxIds, setCreatedTxIds] = useState<string[]>([]);
  const [createdAgentIds, setCreatedAgentIds] = useState<string[]>([]);
  const [undoing, setUndoing] = useState(false);
  const [undoNote, setUndoNote] = useState('');

  const onFile = async (file: File | undefined) => {
    setError('');
    setResults(null);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('That file is over 5 MB. Split it into smaller files.');
      return;
    }
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) {
      setError('Could not find any rows. Make sure the first row has column names.');
      return;
    }
    const [head, ...body] = parsed;
    if (body.length > MAX_IMPORT_ROWS) {
      setError(`This file has ${body.length} rows. Import up to ${MAX_IMPORT_ROWS} at a time.`);
      return;
    }
    setFileName(file.name);
    setHeaders(head.map((h) => h.trim()));
    setRows(body);
    const trimmed = head.map((h) => h.trim());
    const preset = loadPreset(trimmed);
    setUsedPreset(Boolean(preset));
    setMapping(preset ?? autoMap(head));
  };

  const cell = (r: string[], key: ImportFieldKey): string => {
    const idx = mapping?.[key] ?? -1;
    return idx >= 0 ? (r[idx] ?? '').trim() : '';
  };

  // Rows cleaned up for preview and import, with any problems spelled out.
  const prepared = useMemo(() => {
    if (!mapping) return [];
    return rows.map((r, i) => {
      const problems: string[] = [];
      const address = cell(r, 'property_address');
      const agentName = cell(r, 'agent_name');
      const acc = parseDate(cell(r, 'acceptance_date'));
      const clo = parseDate(cell(r, 'closing_date'));
      const price = parsePrice(cell(r, 'purchase_price'));
      if (!address) problems.push('No address');
      if (!agentName && !cell(r, 'agent_email')) problems.push('No agent');
      if (acc === null) problems.push('Acceptance date not understood');
      if (clo === null) problems.push('Closing date not understood');
      if (price === null) problems.push('Price not understood');
      return { index: i + 2, r, address, problems, acc: acc || '', clo: clo || '', price: price === '' || price === null ? 0 : price };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, mapping]);

  const blocking = prepared.filter((p) => p.problems.length > 0).length;
  const requiredMissing = mapping ? IMPORT_FIELDS.filter((f) => f.required && mapping[f.key] < 0) : [];

  const run = async () => {
    if (!mapping) return;
    setRunning(true);
    setError('');
    setProgress(0);
    setUndoNote('');
    const out: RowResult[] = [];
    const madeTx: string[] = [];
    const madeAgents: string[] = [];
    savePreset(headers, mapping);
    try {
      const [agentsRes, txRes] = await Promise.all([authFetch('/api/agents'), authFetch('/api/transactions')]);
      if (!agentsRes.ok || !txRes.ok) throw new Error('Could not load your existing agents and deals');
      const agents: AgentRecord[] = await agentsRes.json();
      const txList: TxRecord[] = await txRes.json();
      const existingAddresses = new Set(txList.map((t) => normalizeAddress(t.property_address || '')));

      const meRes = await authFetch('/api/auth/me');
      const me = meRes.ok ? await meRes.json() : {};
      const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');

      const findAgent = (name: string, email: string) =>
        agents.find((a) => email && a.email && a.email.toLowerCase() === email.toLowerCase()) ||
        agents.find((a) => name && a.name.trim().toLowerCase() === name.toLowerCase());

      for (let n = 0; n < prepared.length; n++) {
        const p = prepared[n];
        setProgress(n + 1);
        const fail = (note: string) => out.push({ row: p.index, address: p.address || '(no address)', status: 'failed', note });

        if (p.problems.length > 0) {
          fail(p.problems.join(', '));
          continue;
        }
        if (existingAddresses.has(normalizeAddress(p.address))) {
          out.push({ row: p.index, address: p.address, status: 'skipped', note: 'Already in Relay' });
          continue;
        }

        try {
          const agentName = cell(p.r, 'agent_name');
          const agentEmail = cell(p.r, 'agent_email');
          let agent = findAgent(agentName, agentEmail);
          if (!agent) {
            if (!createAgents) {
              fail(`Agent "${agentName || agentEmail}" is not in Relay yet`);
              continue;
            }
            const res = await authFetch('/api/agents', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: agentName || agentEmail,
                email: agentEmail || null,
                brokerage: cell(p.r, 'brokerage') || null,
                flatFee: me.defaultFlatFee ?? 400,
                percentFee: me.defaultPercentFee ?? 0,
              }),
            });
            const data = await res.json();
            if (!res.ok) {
              fail(data.error || 'Could not add the agent');
              continue;
            }
            agent = { id: data.id, name: data.name, email: data.email ?? null };
            madeAgents.push(data.id);
            agents.push(agent);
          }

          const fileNumber = cell(p.r, 'file_number') || `${prefix.trim() || 'IMP'}-${stamp}-${String(p.index - 1).padStart(3, '0')}`;
          const txRes2 = await authFetch('/api/transactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId: agent.id,
              fileNumber,
              propertyAddress: p.address,
              purchasePrice: p.price,
              acceptanceDate: p.acc || null,
              closingDate: p.clo || null,
            }),
          });
          const tx = await txRes2.json();
          if (!txRes2.ok) {
            fail(tx.error || 'Could not create the deal');
            continue;
          }
          existingAddresses.add(normalizeAddress(p.address));
          madeTx.push(tx.id);

          // Other people on the deal, when the file had them.
          const parties: { role: string; name: string; email: string }[] = [
            { role: 'Client', name: cell(p.r, 'client_name'), email: cell(p.r, 'client_email') },
            { role: 'Lender', name: cell(p.r, 'lender_name'), email: cell(p.r, 'lender_email') },
            { role: 'Title / Escrow', name: cell(p.r, 'title_name'), email: cell(p.r, 'title_email') },
          ].filter((x) => x.name || x.email);
          let contactNote = '';
          for (const party of parties) {
            const cRes = await authFetch(`/api/transactions/${tx.id}/contacts`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(party),
            });
            if (!cRes.ok) contactNote = ' (some contacts were not saved)';
          }
          out.push({ row: p.index, address: p.address, status: 'created', note: contactNote.trim() || undefined });
        } catch (err) {
          if (err instanceof AuthRequiredError) throw err;
          fail(err instanceof Error ? err.message : 'Unexpected error');
        }
      }
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setCreatedTxIds(madeTx);
      setCreatedAgentIds(madeAgents);
      setResults(out);
      setRunning(false);
    }
  };

  const undoImport = async () => {
    if (!window.confirm(`Delete the ${createdTxIds.length} deal${createdTxIds.length === 1 ? '' : 's'} this import created${createdAgentIds.length ? ` and ${createdAgentIds.length} new agent${createdAgentIds.length === 1 ? '' : 's'}` : ''}? Anything you added to them since will be lost.`)) return;
    setUndoing(true);
    let removed = 0;
    try {
      for (const id of createdTxIds) {
        const res = await authFetch(`/api/transactions?id=${id}`, { method: 'DELETE' });
        if (res.ok) removed += 1;
      }
      for (const id of createdAgentIds) {
        await authFetch(`/api/agents?id=${id}`, { method: 'DELETE' });
      }
      setUndoNote(`Removed ${removed} of ${createdTxIds.length} imported deals.`);
      setCreatedTxIds([]);
      setCreatedAgentIds([]);
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setUndoNote('Undo did not finish. Check your deals list and remove any leftovers by hand.');
    } finally {
      setUndoing(false);
    }
  };

  const created = results?.filter((r) => r.status === 'created').length ?? 0;

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="mb-6">
        <Link href="/dashboard/transactions" className="text-sm text-slate-400 hover:text-slate-200">
          ← Back to deals
        </Link>
        <h1 className="text-2xl md:text-3xl font-display font-semibold text-slate-100 mt-2 mb-1">Import deals from a spreadsheet</h1>
        <p className="text-slate-400">
          Export your deals from AFrame (or any spreadsheet) as a CSV file, then upload it here. Each row becomes a deal with its checklist, and new agents are added for you.
        </p>
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {!mapping && (
        <div
          className="border-2 border-dashed border-slate-600 rounded-xl p-10 text-center bg-slate-800/40"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFile(e.dataTransfer.files?.[0]);
          }}
        >
          <p className="text-slate-200 font-semibold mb-1">Drop your CSV here</p>
          <p className="text-sm text-slate-500 mb-5">The first row should be column names. Up to {MAX_IMPORT_ROWS} deals at a time.</p>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold rounded-lg"
          >
            Choose a file
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv,.txt" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
      )}

      {mapping && !results && (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-3 text-sm">
            <p className="text-slate-300">
              <span className="font-semibold">{fileName}</span> · {rows.length} row{rows.length === 1 ? '' : 's'}
            </p>
            <button
              type="button"
              onClick={() => {
                setMapping(null);
                setRows([]);
                setHeaders([]);
              }}
              disabled={running}
              className="text-slate-400 hover:text-slate-200"
            >
              Choose a different file
            </button>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-5">
            <h2 className="text-lg font-bold text-slate-100 mb-1">1. Match your columns</h2>
            <p className="text-sm text-slate-400 mb-4">
              {usedPreset ? 'Using the column match you saved from your last import of this kind of file. ' : 'We guessed from the column names. '}
              Fix anything that looks off.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
              {IMPORT_FIELDS.map((f) => (
                <div key={f.key}>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    {f.label}
                    {f.required && <span className="text-red-400"> *</span>}
                    {f.hint && <span className="normal-case tracking-normal text-slate-600"> ({f.hint})</span>}
                  </label>
                  <select
                    className={selectCls}
                    value={mapping[f.key]}
                    onChange={(e) => setMapping({ ...mapping, [f.key]: Number(e.target.value) })}
                  >
                    <option value={-1}>(not in my file)</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                        {rows[0]?.[i] ? `  —  e.g. ${rows[0][i].slice(0, 30)}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-5">
            <h2 className="text-lg font-bold text-slate-100 mb-3">2. Options</h2>
            <label className="flex items-center gap-2 text-sm text-slate-300 mb-3 cursor-pointer">
              <input type="checkbox" checked={createAgents} onChange={(e) => setCreateAgents(e.target.checked)} className="accent-blue-500" />
              Add agents that are not in Relay yet (uses your default fees; check them afterward)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              File numbers start with
              <input
                value={prefix}
                onChange={(e) => setPrefix(e.target.value.replace(/[^A-Za-z0-9-]/g, '').slice(0, 8))}
                className="w-24 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-100 text-sm"
              />
              <span className="text-slate-500">when the file has no file number</span>
            </label>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-5">
            <h2 className="text-lg font-bold text-slate-100 mb-1">3. Check and import</h2>
            {requiredMissing.length > 0 && (
              <p className="text-sm text-amber-300 mb-3">Choose a column for: {requiredMissing.map((f) => f.label).join(', ')}.</p>
            )}
            {blocking > 0 && (
              <p className="text-sm text-amber-300 mb-3">
                {blocking} row{blocking === 1 ? ' has' : 's have'} a problem and will be skipped. They are marked below.
              </p>
            )}
            <div className="overflow-x-auto border border-slate-700 rounded-lg mb-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left uppercase tracking-wider text-slate-500 border-b border-slate-700">
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">Address</th>
                    <th className="px-3 py-2">Agent</th>
                    <th className="px-3 py-2">Accepted</th>
                    <th className="px-3 py-2">Closing</th>
                    <th className="px-3 py-2">Price</th>
                    <th className="px-3 py-2">Problems</th>
                  </tr>
                </thead>
                <tbody>
                  {prepared.slice(0, 12).map((p) => (
                    <tr key={p.index} className="border-b border-slate-700/60 last:border-0 text-slate-300">
                      <td className="px-3 py-2">{p.index}</td>
                      <td className="px-3 py-2 break-words">{p.address}</td>
                      <td className="px-3 py-2">{cell(p.r, 'agent_name') || cell(p.r, 'agent_email')}</td>
                      <td className="px-3 py-2">{p.acc}</td>
                      <td className="px-3 py-2">{p.clo}</td>
                      <td className="px-3 py-2">{p.price ? `$${Number(p.price).toLocaleString()}` : ''}</td>
                      <td className="px-3 py-2 text-amber-300">{p.problems.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {prepared.length > 12 && <p className="text-xs text-slate-500 mb-4">Showing the first 12 of {prepared.length} rows.</p>}
            <button
              type="button"
              onClick={run}
              disabled={running || requiredMissing.length > 0 || prepared.length - blocking === 0}
              className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition disabled:opacity-50"
            >
              {running ? `Importing ${progress} of ${prepared.length}…` : `Import ${prepared.length - blocking} deal${prepared.length - blocking === 1 ? '' : 's'}`}
            </button>
            {running && <p className="text-xs text-slate-500 mt-2">Keep this page open until it finishes.</p>}
          </div>
        </div>
      )}

      {results && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-5">
          <h2 className="text-lg font-bold text-slate-100 mb-1">
            {created} deal{created === 1 ? '' : 's'} imported
          </h2>
          <p className="text-sm text-slate-400 mb-4">
            {results.filter((r) => r.status === 'skipped').length} already in Relay, {results.filter((r) => r.status === 'failed').length} could not be imported.
          </p>
          <ul className="space-y-1.5 text-sm mb-5 max-h-80 overflow-y-auto">
            {results
              .filter((r) => r.status !== 'created' || r.note)
              .map((r) => (
                <li key={r.row} className={r.status === 'failed' ? 'text-red-300' : 'text-slate-400'}>
                  Row {r.row}, {r.address}: {r.status === 'failed' ? 'not imported. ' : r.status === 'skipped' ? 'skipped. ' : 'imported. '}
                  {r.note}
                </li>
              ))}
          </ul>
          <div className="flex items-center gap-4">
            <Link href="/dashboard/transactions" className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold rounded-lg">
              Go to my deals
            </Link>
            <button
              type="button"
              onClick={() => {
                setResults(null);
                setMapping(null);
                setRows([]);
                setUndoNote('');
              }}
              className="text-sm text-slate-400 hover:text-slate-200"
            >
              Import another file
            </button>
            {createdTxIds.length > 0 && (
              <button type="button" onClick={undoImport} disabled={undoing} className="text-sm text-red-300 hover:text-red-200 disabled:opacity-50 ml-auto">
                {undoing ? 'Removing…' : 'Undo this import'}
              </button>
            )}
          </div>
          {undoNote && <p className="text-sm text-slate-300 mt-3">{undoNote}</p>}
        </div>
      )}
    </div>
  );
}
