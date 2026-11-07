'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAgentAccess } from '@/lib/useAgentAccess';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { formatDisplayDate } from '@/lib/dueDates';
import { invoiceTotals } from '@/lib/workspaceInvoiceMath';
import { INVOICE_TEMPLATES } from '@/lib/workspaceInvoiceTemplates';
import AgentCommissionInvoiceForm from './AgentCommissionInvoiceForm';
import CommissionInvoicePanel, { type PanelRow } from './CommissionInvoicePanel';
import CoordinatorInvoiceList, { coordinatorOwed, type CoordinatorInvoice } from './CoordinatorInvoices';

interface Line {
  description: string;
  quantity: number;
  unitPrice: number;
}

interface InvoiceRow {
  id: string;
  invoice_number: string;
  title: string;
  bill_to_name: string;
  bill_to_email: string | null;
  bill_to_address: string | null;
  contact_id: string | null;
  transaction_id: string | null;
  issue_date: string;
  due_date: string | null;
  status: 'draft' | 'sent' | 'paid' | 'void';
  memo: string | null;
  tax_percent: number;
  sent_at: string | null;
  paid_at: string | null;
  subtotal: number;
  tax: number;
  total: number;
  lines?: Line[];
}

interface ContactRow {
  id: string;
  name: string | null;
  email: string | null;
  company: string | null;
}

// A commission invoice the agent sends to their brokerage (made on the deal). It lives here with the rest of their invoices.
type CommissionInvoiceRow = PanelRow & { brokerage: { name: string } };

function commissionState(c: CommissionInvoiceRow): { label: string; bucket: 'draft' | 'sent' | 'paid'; cls: string } {
  if (c.status === 'estimate') return { label: c.dealStatus !== 'Closed' ? 'Sent · confirmed at closing' : 'Sent · waiting for confirmation', bucket: 'sent', cls: 'bg-blue-500/10 text-blue-300 border-blue-500/40 border-dashed' };
  if (c.status === 'paid') return { label: 'Paid', bucket: 'paid', cls: 'bg-green-500/10 text-green-300 border-green-500/40' };
  if (c.status === 'accepted') return { label: 'Agreed · waiting to be paid', bucket: 'sent', cls: 'bg-blue-500/10 text-blue-300 border-blue-500/40' };
  if (c.status === 'proposed') return { label: 'Confirmed · review it', bucket: 'draft', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/40' };
  return { label: c.submitted ? 'Sent · waiting for approval' : 'Change requested', bucket: 'draft', cls: 'bg-slate-500/10 text-slate-300 border-slate-500/40' };
}

const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_STYLE: Record<InvoiceRow['status'], string> = {
  draft: 'bg-slate-500/10 text-slate-300 border-slate-500/40',
  sent: 'bg-blue-500/10 text-blue-300 border-blue-500/40',
  paid: 'bg-green-500/10 text-green-300 border-green-500/40',
  void: 'bg-red-500/10 text-red-300 border-red-500/40',
};

const inputCls = 'w-full bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 text-sm focus:border-blue-500 focus:outline-none';

// An agent with their own workspace: invoices from templates, billed to anyone in their contacts (or typed in), with an
// optional link to a deal when a coordinator is on it. Separate from the coordinator's commission invoices.
export default function AgentInvoices({ initialTransactionId, startNew, commissionTransactionId }: { initialTransactionId?: string; startNew?: boolean; commissionTransactionId?: string }) {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [commissions, setCommissions] = useState<CommissionInvoiceRow[]>([]);
  // Invoices the agent's coordinator made on the agent's deals (what the agent owes them).
  const [coordinatorInvoices, setCoordinatorInvoices] = useState<CoordinatorInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'draft' | 'sent' | 'paid' | 'void' | 'coordinator'>('all');
  const [picking, setPicking] = useState(Boolean(initialTransactionId) || Boolean(startNew));
  const { readOnly } = useAgentAccess();
  const [editing, setEditing] = useState<InvoiceRow | null>(null);
  const [busy, setBusy] = useState(false);
  // The commission invoice to the agent's brokerage (see AgentCommissionInvoiceForm), opened from the template list or from a deal.
  const [commissionForm, setCommissionForm] = useState(Boolean(commissionTransactionId));
  // Which commission invoice is opened to show its lines, edits and PDF.
  const [openCommission, setOpenCommission] = useState<string | null>(null);

  // Bumping `reloadKey` fetches the list again.
  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    authFetch('/api/workspace-invoices')
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || 'Failed to load invoices');
        setInvoices(Array.isArray(data) ? data : []);
        setError('');
      })
      .catch((err) => {
        if (cancelled || err instanceof AuthRequiredError) return;
        setError(err instanceof Error ? err.message : 'Failed to load invoices');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Commission invoices to the agent's brokerage, if they are in one (an empty list otherwise, or when the feature is off).
  useEffect(() => {
    let cancelled = false;
    authFetch('/api/commissions')
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { asAgent?: CommissionInvoiceRow[] };
        if (!cancelled) setCommissions((data.asAgent ?? []).filter((c) => c.status !== 'void'));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    let cancelled = false;
    authFetch('/api/agent/invoices')
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setCoordinatorInvoices(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const create = async (templateKey: string) => {
    setBusy(true);
    setError('');
    try {
      // The commission split goes to the agent's own brokerage with everything filled in; with no brokerage it is a plain invoice.
      if (templateKey === 'commission_split') {
        const opts = await authFetch('/api/commissions/invoice-options').then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (opts?.inBrokerage) {
          setPicking(false);
          setCommissionForm(true);
          return;
        }
      }
      const res = await authFetch('/api/workspace-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateKey, ...(initialTransactionId ? { transactionId: initialTransactionId } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create the invoice');
      setPicking(false);
      setEditing(data);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the invoice');
    } finally {
      setBusy(false);
    }
  };

  const openInvoice = async (id: string) => {
    const res = await authFetch(`/api/workspace-invoices/${id}`);
    const data = await res.json();
    if (res.ok) setEditing(data);
    else setError(data.error || 'Could not open the invoice');
  };

  const summary = useMemo(() => {
    const outstanding = invoices.filter((i) => i.status === 'sent').reduce((s, i) => s + i.total, 0) + commissions.filter((c) => c.status === 'accepted').reduce((s, c) => s + (c.agentNet ?? 0), 0);
    const draft = invoices.filter((i) => i.status === 'draft').reduce((s, i) => s + i.total, 0);
    const now = new Date();
    const paidThisMonth = invoices
      .filter((i) => i.status === 'paid' && i.paid_at && new Date(i.paid_at).getMonth() === now.getMonth() && new Date(i.paid_at).getFullYear() === now.getFullYear())
      .reduce((s, i) => s + i.total, 0) + commissions
      .filter((c) => c.status === 'paid' && c.paidOn && new Date(`${c.paidOn.slice(0, 10)}T00:00:00`).getMonth() === now.getMonth() && new Date(`${c.paidOn.slice(0, 10)}T00:00:00`).getFullYear() === now.getFullYear())
      .reduce((s, c) => s + (c.agentNet ?? 0), 0);
    return { outstanding, draft, paidThisMonth };
  }, [invoices, commissions]);

  const shown = invoices.filter((i) => filter === 'all' || i.status === filter);
  const shownCommissions = commissions.filter((c) => filter === 'all' || commissionState(c).bucket === filter);
  // Invoices from the coordinator: everything under All and "From my TC", unpaid ones under Sent, paid ones under Paid.
  const shownCoordinator = coordinatorInvoices.filter((i) => filter === 'all' || filter === 'coordinator' || (filter === 'sent' && !i.paid) || (filter === 'paid' && i.paid));
  const owedToCoordinator = coordinatorOwed(coordinatorInvoices);

  if (editing) {
    return (
      <InvoiceEditor
        invoice={editing}
        onClose={() => {
          setEditing(null);
          load();
        }}
        onChanged={(inv) => setEditing(inv)}
      />
    );
  }

  return (
    <div className="p-4 md:p-10 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-semibold text-slate-100 mb-1">Invoices</h1>
          <p className="text-slate-400">Your brokerage commission statements, plus referral fees, splits, expenses and services billed from a template.</p>
        </div>
        {!readOnly && (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="px-4 py-2.5 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl transition whitespace-nowrap"
        >
          + New invoice
        </button>
        )}
      </div>

      {error && <p className="mb-4 text-sm text-red-300">{error}</p>}

      {commissionForm && <AgentCommissionInvoiceForm initialTransactionId={commissionTransactionId} onClose={() => setCommissionForm(false)} onSent={load} />}

      {picking && (
        <div className="mb-8 bg-white/5 border border-white/10 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-100">
              Choose a template{initialTransactionId ? ' for this deal' : ''}
            </h2>
            <button type="button" onClick={() => setPicking(false)} className="text-sm text-slate-400 hover:text-slate-200">
              Cancel
            </button>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {INVOICE_TEMPLATES.map((t) => (
              <button
                key={t.key}
                type="button"
                disabled={busy}
                onClick={() => create(t.key)}
                className="text-left bg-slate-800/60 hover:bg-slate-800 border border-white/10 hover:border-blue-500/50 rounded-xl p-4 transition disabled:opacity-50"
              >
                <p className="font-semibold text-slate-100 text-sm">{t.name}</p>
                <p className="text-xs text-slate-400 mt-1">{t.blurb}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          ['Waiting to be paid', summary.outstanding],
          ['Drafts', summary.draft],
          ['Paid this month', summary.paidThisMonth],
        ].map(([label, value]) => (
          <div key={label as string} className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <p className="text-xs text-slate-400">{label as string}</p>
            <p className="text-xl font-semibold text-slate-100 mt-1">{money(value as number)}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-4 text-sm" role="tablist" aria-label="Filter invoices">
        {(['all', 'draft', 'sent', 'paid', 'void', ...(coordinatorInvoices.length > 0 ? (['coordinator'] as const) : [])] as const).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full border capitalize transition ${filter === f ? 'border-blue-500 text-blue-300 bg-blue-900/20' : 'border-white/10 text-slate-400 hover:text-slate-200'}`}
          >
            {f === 'coordinator' ? 'From my TC' : f}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-slate-400">Loading…</p>
      ) : shown.length === 0 && shownCommissions.length === 0 && shownCoordinator.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
          <p className="text-slate-300 mb-1">{invoices.length === 0 && commissions.length === 0 && coordinatorInvoices.length === 0 ? 'No invoices yet.' : 'Nothing matches that filter.'}</p>
          {invoices.length === 0 && commissions.length === 0 && coordinatorInvoices.length === 0 && <p className="text-sm text-slate-500">Choose New invoice, pick a template, then pick who to bill from your contacts.</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {shownCoordinator.length > 0 && (
            <div className="mb-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">From your coordinator</p>
                <p className="text-xs text-slate-400">{owedToCoordinator > 0 ? `You owe ${money(owedToCoordinator)}` : 'All paid'}</p>
              </div>
              <CoordinatorInvoiceList invoices={shownCoordinator} dealHref={(id) => `/dashboard/transactions/${id}`} />
            </div>
          )}
          {shownCommissions.map((c) => {
            const state = commissionState(c);
            const isOpen = openCommission === c.id;
            const brokerage = c.brokerage?.name ?? 'Your brokerage';
            return (
              <div key={c.id} className={`bg-white/5 border rounded-2xl transition ${isOpen ? 'border-white/25' : 'border-white/10 hover:border-white/25'}`}>
                <button type="button" onClick={() => setOpenCommission(isOpen ? null : c.id)} aria-expanded={isOpen} className="w-full text-left p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-100 truncate">
                      {c.statementNumber} · {brokerage}
                    </p>
                    <p className="text-xs text-slate-500 truncate">Commission invoice to your brokerage{c.property ? ` · ${c.property}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${state.cls}`}>{state.label}</span>
                    <span className="font-semibold text-slate-100">{c.agentNet !== null ? money(c.agentNet) : c.estimate?.agentNet != null ? <span title="Estimate">≈ {money(c.estimate.agentNet)}</span> : '—'}</span>
                    <span aria-hidden className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}><svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 fill-current"><path d="M5.5 7.5 10 12l4.5-4.5 1 1L10 14 4.5 8.5z" /></svg></span>
                  </div>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4">
                    <CommissionInvoicePanel role="agent" row={c} counterpart={brokerage} onChanged={load} />
                  </div>
                )}
              </div>
            );
          })}
          {shown.map((inv) => (
            <button
              key={inv.id}
              type="button"
              onClick={() => openInvoice(inv.id)}
              className="w-full text-left bg-white/5 border border-white/10 hover:border-white/25 rounded-2xl p-4 transition flex flex-wrap items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="font-semibold text-slate-100 truncate">
                  {inv.invoice_number} · {inv.bill_to_name || 'No recipient yet'}
                </p>
                <p className="text-xs text-slate-500 truncate">
                  {inv.title}
                  {inv.due_date ? ` · due ${formatDisplayDate(inv.due_date)}` : ''}
                  {inv.transaction_id ? ' · linked to a deal' : ''}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-full border capitalize ${STATUS_STYLE[inv.status]}`}>{inv.status}</span>
                <span className="font-semibold text-slate-100">{money(inv.total)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function InvoiceEditor({ invoice, onClose, onChanged }: { invoice: InvoiceRow; onClose: () => void; onChanged: (inv: InvoiceRow) => void }) {
  const [title, setTitle] = useState(invoice.title);
  const [billToName, setBillToName] = useState(invoice.bill_to_name);
  const [billToEmail, setBillToEmail] = useState(invoice.bill_to_email || '');
  const [billToAddress, setBillToAddress] = useState(invoice.bill_to_address || '');
  const [issueDate, setIssueDate] = useState(invoice.issue_date);
  const [dueDate, setDueDate] = useState(invoice.due_date || '');
  const [memo, setMemo] = useState(invoice.memo || '');
  const [taxPercent, setTaxPercent] = useState(String(invoice.tax_percent || 0));
  const [lines, setLines] = useState<Line[]>(invoice.lines && invoice.lines.length > 0 ? invoice.lines : [{ description: '', quantity: 1, unitPrice: 0 }]);
  const [contacts, setContacts] = useState<ContactRow[] | null>(null);
  const [contactQuery, setContactQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const editable = invoice.status === 'draft' || invoice.status === 'sent';
  const totals = invoiceTotals(lines, Number(taxPercent));

  const loadContacts = async () => {
    if (contacts) return;
    try {
      const res = await authFetch('/api/contacts');
      const data = await res.json();
      setContacts(Array.isArray(data) ? data : []);
    } catch {
      setContacts([]);
    }
  };

  const matches = (contacts || [])
    .filter((c) => {
      const q = contactQuery.trim().toLowerCase();
      return q ? `${c.name || ''} ${c.email || ''} ${c.company || ''}`.toLowerCase().includes(q) : true;
    })
    .slice(0, 8);

  const pickContact = (c: ContactRow) => {
    setBillToName(c.company ? `${c.name ? c.name + ', ' : ''}${c.company}` : c.name || '');
    setBillToEmail(c.email || '');
    setContactQuery('');
  };

  const run = async (fn: () => Promise<Response>, okNote: string, after?: (data: InvoiceRow) => void) => {
    setBusy(true);
    setError('');
    setNote('');
    try {
      const res = await fn();
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      setNote(okNote);
      if (after) after(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(
      () =>
        authFetch(`/api/workspace-invoices/${invoice.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, billToName, billToEmail, billToAddress, issueDate, dueDate: dueDate || null, memo, taxPercent: Number(taxPercent) || 0, lines }),
        }),
      'Saved.',
      (data) => onChanged({ ...data, lines })
    );

  const act = (action: string, okNote: string) =>
    run(
      () => authFetch(`/api/workspace-invoices/${invoice.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }),
      okNote,
      (data) => onChanged(data)
    );

  const send = async () => {
    await save();
    await run(
      () => authFetch(`/api/workspace-invoices/${invoice.id}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) }),
      `Sent to ${billToEmail}.`,
      async () => {
        const res = await authFetch(`/api/workspace-invoices/${invoice.id}`);
        if (res.ok) onChanged(await res.json());
      }
    );
  };

  const download = async () => {
    const res = await authFetch(`/api/workspace-invoices/${invoice.id}/pdf`);
    if (!res.ok) {
      setError('Could not build the PDF');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const downloadPdf = async () => {
    const res = await authFetch(`/api/workspace-invoices/${invoice.id}/pdf`);
    if (!res.ok) {
      setError('Could not build the PDF');
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `${invoice.invoice_number}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const remove = async () => {
    if (!confirm('Delete this draft?')) return;
    await run(() => authFetch(`/api/workspace-invoices/${invoice.id}`, { method: 'DELETE' }), 'Deleted.', () => onClose());
  };

  const setLine = (i: number, patch: Partial<Line>) => setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  return (
    <div className="p-4 md:p-10 max-w-3xl mx-auto">
      <button type="button" onClick={onClose} className="text-sm text-slate-400 hover:text-slate-200 mb-4">
        ← All invoices
      </button>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl md:text-3xl font-semibold text-slate-100">{invoice.invoice_number}</h1>
        <span className={`text-xs px-2 py-0.5 rounded-full border capitalize ${STATUS_STYLE[invoice.status]}`}>{invoice.status}</span>
      </div>
      {invoice.transaction_id && <p className="text-xs text-sky-300 mb-4">Linked to a deal that has a coordinator on it.</p>}

      <fieldset disabled={!editable || busy} className="space-y-5">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Title</label>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} />
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
          <p className="text-sm font-semibold text-slate-200">Bill to</p>
          <div className="relative">
            <input
              className={inputCls}
              placeholder="Search your contacts…"
              value={contactQuery}
              onFocus={loadContacts}
              onChange={(e) => {
                setContactQuery(e.target.value);
                loadContacts();
              }}
            />
            {contactQuery && contacts && (
              <div className="absolute z-10 mt-1 w-full bg-slate-800 border border-white/10 rounded-lg shadow-lg max-h-56 overflow-auto">
                {matches.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-slate-400">No match. Type the details below instead.</p>
                ) : (
                  matches.map((c) => (
                    <button key={c.id} type="button" onClick={() => pickContact(c)} className="block w-full text-left px-3 py-2 text-sm text-slate-100 hover:bg-slate-700">
                      {c.name || c.email}
                      <span className="text-xs text-slate-400">{[c.company, c.email].filter(Boolean).length ? ` — ${[c.company, c.email].filter(Boolean).join(' · ')}` : ''}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <input className={inputCls} placeholder="Name" value={billToName} onChange={(e) => setBillToName(e.target.value)} maxLength={140} />
            <input className={inputCls} placeholder="Email" type="email" value={billToEmail} onChange={(e) => setBillToEmail(e.target.value)} />
          </div>
          <input className={inputCls} placeholder="Address (optional)" value={billToAddress} onChange={(e) => setBillToAddress(e.target.value)} maxLength={400} />
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Issued</label>
            <input type="date" className={inputCls} value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Due</label>
            <input type="date" className={inputCls} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
          <p className="text-sm font-semibold text-slate-200 mb-3">Lines</p>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <input className={`${inputCls} col-span-12 sm:col-span-6`} placeholder="Description" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} maxLength={300} />
                <input className={`${inputCls} col-span-4 sm:col-span-2`} aria-label="Quantity" type="number" min="0" step="0.01" value={l.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} />
                <input className={`${inputCls} col-span-5 sm:col-span-3`} aria-label="Unit price" type="number" min="0" step="0.01" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) })} />
                <button type="button" aria-label="Remove line" onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))} className="col-span-3 sm:col-span-1 text-slate-500 hover:text-red-300 text-sm">
                  Remove
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setLines((prev) => [...prev, { description: '', quantity: 1, unitPrice: 0 }])} className="mt-3 text-xs text-blue-400 hover:text-blue-300 font-medium">
            + Add a line
          </button>
          <div className="mt-4 flex flex-col items-end gap-1 text-sm">
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400" htmlFor="tax">
                Tax %
              </label>
              <input id="tax" className={`${inputCls} w-20`} type="number" min="0" max="100" step="0.01" value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)} />
            </div>
            <p className="text-slate-400">Subtotal {money(totals.subtotal)}</p>
            {Number(taxPercent) > 0 && <p className="text-slate-400">Tax {money(totals.tax)}</p>}
            <p className="text-lg font-semibold text-slate-100">Total {money(totals.total)}</p>
          </div>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">Notes on the invoice</label>
          <textarea className={inputCls} rows={3} value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={2000} />
        </div>
        {invoice.status !== 'paid' && (
          <div>
            <label className="block text-xs text-slate-400 mb-1">Message in the email (optional)</label>
            <textarea className={inputCls} rows={2} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1500} />
          </div>
        )}
      </fieldset>

      {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
      {note && <p className="mt-4 text-sm text-green-300">{note}</p>}

      <div className="mt-6 flex flex-wrap gap-2">
        {editable && (
          <>
            <button type="button" disabled={busy} onClick={save} className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-slate-100 text-sm font-semibold rounded-xl disabled:opacity-50">
              Save
            </button>
            <button type="button" disabled={busy || !billToEmail.trim()} onClick={send} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl disabled:opacity-50">
              {invoice.status === 'sent' ? 'Send again' : 'Send by email'}
            </button>
          </>
        )}
        <button type="button" onClick={download} className="px-4 py-2 border border-white/15 hover:border-white/30 text-slate-200 text-sm font-semibold rounded-xl">
          Open PDF
        </button>
        <button type="button" onClick={downloadPdf} className="px-4 py-2 border border-white/15 hover:border-white/30 text-slate-200 text-sm font-semibold rounded-xl">
          Download PDF
        </button>
        {(invoice.status === 'draft' || invoice.status === 'sent') && (
          <button type="button" disabled={busy} onClick={() => act('mark_paid', 'Marked paid.')} className="px-4 py-2 border border-green-500/40 text-green-300 hover:bg-green-500/10 text-sm font-semibold rounded-xl disabled:opacity-50">
            Mark paid
          </button>
        )}
        {invoice.status !== 'paid' && invoice.status !== 'void' && (
          <button type="button" disabled={busy} onClick={() => act('void', 'Voided.')} className="px-4 py-2 border border-white/15 text-slate-300 hover:text-red-300 text-sm rounded-xl disabled:opacity-50">
            Void
          </button>
        )}
        {(invoice.status === 'paid' || invoice.status === 'void') && (
          <button type="button" disabled={busy} onClick={() => act('reopen', 'Reopened.')} className="px-4 py-2 border border-white/15 text-slate-300 text-sm rounded-xl disabled:opacity-50">
            Reopen
          </button>
        )}
        {invoice.status === 'draft' && !invoice.sent_at && (
          <button type="button" disabled={busy} onClick={remove} className="px-4 py-2 text-red-300 hover:text-red-200 text-sm rounded-xl disabled:opacity-50">
            Delete draft
          </button>
        )}
      </div>
    </div>
  );
}
