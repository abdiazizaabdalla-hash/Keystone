'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';

interface Row {
  id: string; email: string; name: string | null; created_at: string; last_sign_in_at: string | null; onboarded: boolean;
  lastActiveAt: string | null; lastActiveWhat: string | null;
  deals: number; openDeals: number; closedDeals: number; listings: number; agentProfiles: number; contacts: number;
  stepsDone: number; stepsTotal: number; documents: number; documentBytes: number; lastDocumentAt: string | null;
  messagesSent: number; clientMessages: number; emailsReceived: number; invoices: number; invoicesSent: number; invoicesPaid: number;
  signingRequests: number; signingSigned: number; shareLinks: number; commissionStatements: number; aiReads: number;
}
interface Detail {
  recentActions: { action: string; created_at: string }[];
  deals: { id: string; file_number: string | null; property_address: string | null; status: string; acceptance_date: string | null; closing_date: string | null; created_at: string; updated_at: string | null; steps: { done: number; total: number } }[];
  documents: { transaction_id: string; file_name: string; category: string | null; file_size: number | null; created_at: string }[];
  agents: { name: string | null; brokerage: string | null; created_at: string }[];
}

const ago = (iso: string | null) => {
  if (!iso) return 'Never';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins || 1} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} hr ago`;
  const days = Math.round(mins / 1440);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
};
const stamp = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const mb = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const ymd = (v: string | null) => (v ? v.slice(0, 10) : '—');
const dot = (iso: string | null) => {
  if (!iso) return 'bg-slate-500';
  const days = (Date.now() - new Date(iso).getTime()) / 86400000;
  return days <= 2 ? 'bg-green-400' : days <= 7 ? 'bg-amber-400' : 'bg-red-400';
};

export default function AdminActivity() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [now] = useState(() => Date.now());
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, Detail>>({});

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/admin/activity');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to load activity');
      setRows(json.users);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load activity'); }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const toggle = async (id: string) => {
    setOpen(open === id ? null : id);
    if (open !== id && !detail[id]) {
      const res = await authFetch(`/api/admin/activity?userId=${id}`);
      if (res.ok) { const json = await res.json(); setDetail((d) => ({ ...d, [id]: json })); }
    }
  };

  if (error) return <p className="text-red-400">{error}</p>;
  if (!rows) return <p className="text-slate-400">Loading activity…</p>;

  const tile = (label: string, value: string | number, sub?: string) => (
    <div className="bg-slate-800/60 border border-slate-600 rounded-lg px-3 py-2">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-lg font-semibold text-slate-100">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
  const active7 = rows.filter((r) => r.lastActiveAt && now - new Date(r.lastActiveAt).getTime() < 7 * 86400000).length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        {active7} of {rows.length} coordinators active in the last 7 days. &ldquo;Last active&rdquo; is the latest thing they actually did (created a deal, ticked a step, uploaded a document, sent a message, added a contact&hellip;), not their last sign-in. Merely opening the app without changing anything isn&rsquo;t recorded.
        Counts and dates only &mdash; no message text, document contents, client names or prices.
      </p>
      <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-600 bg-slate-800/50 text-left text-slate-300">
              {['Coordinator', 'Last active', 'Deals (open)', 'Steps done', 'Docs', 'Messages', 'Invoices', 'Signing', 'Listings', 'Agents', 'Contacts'].map((h) => <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr className="border-b border-slate-700/60 hover:bg-slate-700/30 cursor-pointer" onClick={() => toggle(r.id)}>
                  <td className="px-4 py-3"><div className="text-slate-100">{r.name || r.email}</div>{r.name && <div className="text-xs text-slate-500">{r.email}</div>}</td>
                  <td className="px-4 py-3 whitespace-nowrap"><span className={`inline-block w-2 h-2 rounded-full mr-2 ${dot(r.lastActiveAt)}`} /><span className="text-slate-200">{ago(r.lastActiveAt)}</span><div className="text-xs text-slate-500">{r.lastActiveWhat ? `${r.lastActiveWhat} · ` : ''}{stamp(r.lastActiveAt)}</div></td>
                  <td className="px-4 py-3 text-slate-300">{r.deals} ({r.openDeals})</td>
                  <td className="px-4 py-3 text-slate-300">{r.stepsDone}/{r.stepsTotal}</td>
                  <td className="px-4 py-3 text-slate-300">{r.documents}</td>
                  <td className="px-4 py-3 text-slate-300">{r.messagesSent + r.clientMessages}</td>
                  <td className="px-4 py-3 text-slate-300">{r.invoices}</td>
                  <td className="px-4 py-3 text-slate-300">{r.signingRequests}</td>
                  <td className="px-4 py-3 text-slate-300">{r.listings}</td>
                  <td className="px-4 py-3 text-slate-300">{r.agentProfiles}</td>
                  <td className="px-4 py-3 text-slate-300">{r.contacts}</td>
                </tr>
                {open === r.id && (
                  <tr className="bg-slate-900/40"><td colSpan={11} className="px-4 py-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                      {tile('Joined', ymd(r.created_at), r.onboarded ? 'Onboarding done' : 'Onboarding not finished')}
                      {tile('Last sign-in', stamp(r.last_sign_in_at), 'Fresh logins only')}
                      {tile('Documents', r.documents, r.documents ? `${mb(r.documentBytes)} · last ${ymd(r.lastDocumentAt)}` : 'None uploaded')}
                      {tile('Messages', r.messagesSent + r.clientMessages, `${r.messagesSent} team/agent · ${r.clientMessages} client`)}
                      {tile('Invoices', r.invoices, `${r.invoicesSent} sent · ${r.invoicesPaid} paid`)}
                      {tile('E-signing', r.signingRequests, `${r.signingSigned} signed`)}
                      {tile('Share links', r.shareLinks)}
                      {tile('Emails received', r.emailsReceived, 'Forwarded into deals')}
                      {tile('Commission statements', r.commissionStatements)}
                      {tile('AI reads', r.aiReads)}
                      {tile('Closed deals', r.closedDeals)}
                      {tile('Steps', `${r.stepsDone}/${r.stepsTotal}`)}
                    </div>
                    {!detail[r.id] ? <p className="text-slate-500 text-sm">Loading…</p> : (
                      <div className="grid md:grid-cols-2 gap-6 text-sm">
                        <div>
                          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Deals</h4>
                          {detail[r.id].deals.length === 0 ? <p className="text-slate-500">None</p> : (
                            <ul className="space-y-1">{detail[r.id].deals.map((d) => (
                              <li key={d.id} className="text-slate-300">{d.property_address || d.file_number} <span className="text-slate-500">· {d.status} · {d.steps.done}/{d.steps.total} steps · closing {ymd(d.closing_date)} · created {ymd(d.created_at)}</span></li>
                            ))}</ul>
                          )}
                          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-4 mb-1">Agent profiles</h4>
                          {detail[r.id].agents.length === 0 ? <p className="text-slate-500">None</p> : (
                            <ul className="space-y-1">{detail[r.id].agents.map((a, i) => <li key={i} className="text-slate-300">{a.name} <span className="text-slate-500">· {a.brokerage || 'no brokerage'} · added {ymd(a.created_at)}</span></li>)}</ul>
                          )}
                        </div>
                        <div>
                          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Documents (file names)</h4>
                          {detail[r.id].documents.length === 0 ? <p className="text-slate-500">None</p> : (
                            <ul className="space-y-1">{detail[r.id].documents.slice(0, 30).map((d, i) => <li key={i} className="text-slate-300">{d.file_name} <span className="text-slate-500">· {d.category || 'uncategorized'} · {d.file_size ? mb(d.file_size) : ''} · {ymd(d.created_at)}</span></li>)}</ul>
                          )}
                          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mt-4 mb-1">Recent recorded actions</h4>
                          {detail[r.id].recentActions.length === 0 ? <p className="text-slate-500">None</p> : (
                            <ul className="space-y-1">{detail[r.id].recentActions.map((a, i) => <li key={i} className="text-slate-300">{a.action} <span className="text-slate-500">· {stamp(a.created_at)}</span></li>)}</ul>
                          )}
                        </div>
                      </div>
                    )}
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
