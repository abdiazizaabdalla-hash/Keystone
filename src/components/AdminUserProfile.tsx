'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Everything the admin can see about one account. Counts, dates, file names and amounts; never message text, document contents,
// client names or contact details.

const when = (v: unknown) => (typeof v === 'string' && v ? new Date(v).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const day = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 10) : '—');
const money = (n: unknown) => (typeof n === 'number' ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—');
const size = (b: unknown) => (typeof b === 'number' ? (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`) : '');
const show = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));
const counts = (o: Record<string, number> | undefined) => (o && Object.keys(o).length ? Object.entries(o).map(([k, v]) => `${v} ${k}`).join(', ') : 'none');

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-800/50 border border-slate-600 rounded-lg p-4">
      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{title}</h4>
      {children}
    </div>
  );
}
function KV({ rows }: { rows: [string, unknown][] }) {
  return (
    <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([k, v]) => (<div key={k} className="contents"><dt className="text-slate-500">{k}</dt><dd className="text-slate-200 break-words">{show(v)}</dd></div>))}
    </dl>
  );
}
const Empty = () => <p className="text-sm text-slate-500">None</p>;

export default function AdminUserProfile({ userId }: { userId: string }) {
  const [p, setP] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    authFetch(`/api/admin/activity?userId=${userId}`)
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!live) return; if (!r.ok) setErr(j.error || 'Could not load'); else setP(j); })
      .catch(() => live && setErr('Could not load'));
    return () => { live = false; };
  }, [userId]);
  if (err) return <p className="text-red-400 text-sm">{err}</p>;
  if (!p) return <p className="text-slate-500 text-sm">Loading everything about this account…</p>;
  const a = p.account, b = p.billing, u = p.usage;

  return (
    <div className="grid lg:grid-cols-2 xl:grid-cols-3 gap-4 text-left">
      <Section title="Account">
        <KV rows={[['Name', a.name], ['Email', a.email], ['Phone', a.phone], ['Joined', when(a.createdAt)], ['Email confirmed', when(a.emailConfirmedAt)], ['Last fresh sign-in', when(a.lastSignInAt)], ['Sign-in method', (a.providers || []).join(', ')], ['Two-step sign-in', a.twoStep], ['Suspended until', a.bannedUntil ? when(a.bannedUntil) : 'No'], ['Platform admin', a.isAdmin], ['Account type', a.role || 'Coordinator'], ['Agent workspace', a.agentWorkspace], ['Terms accepted', a.termsAcceptedAt ? `${when(a.termsAcceptedAt)} (v${a.termsVersion || '?'})` : '—']]} />
      </Section>
      <Section title="Plan & billing">
        <KV rows={[['Plan', a.plan || b.plan || 'starter'], ['Trial ends', when(a.trialEndsAt)], ['Subscription', b.subscription_status], ['Current period ends', when(b.current_period_end)], ['Stripe customer', b.hasStripeCustomer], ['Has subscription', b.hasSubscription], ['Billing record updated', when(b.updated_at)]]} />
      </Section>
      <Section title="Their settings">
        <KV rows={Object.entries(a.settings || {}) as [string, unknown][]} />
      </Section>
      <Section title="Team & brokerage">
        {p.team ? <KV rows={[['Team', p.team.name], ['Their role', p.team.role], ['Owner', p.team.isOwner], ['Members', p.team.members], ['Joined', day(p.team.joinedAt)]]} /> : <p className="text-sm text-slate-500">Not on a team</p>}
        <div className="mt-2"><KV rows={[['Agents in their brokerage', counts(p.brokerage.asOwner)], ['Joined a brokerage as agent', p.brokerage.asAgent.length ? p.brokerage.asAgent.map((l: any) => l.status).join(', ') : 'No']]} /></div>
      </Section>
      <Section title="Usage">
        <KV rows={[['Contacts', `${u.contacts} (${counts(u.contactsByType)})`], ['Templates / uses', `${u.templates} / ${u.templateUses}`], ['Emails received on deals', `${u.emailsReceived} (last ${day(u.lastEmailAt)})`], ['Messages sent / received', `${u.messagesSent} / ${u.messagesFromOthers}`], ['Client messages', u.clientMessages], ['E-signing', counts(u.signingByStatus)], ['Share links / views', `${u.shareLinks} / ${u.shareLinkViews} (last ${day(u.lastShareViewAt)})`], ['Calendar sync on', u.calendarFeed], ['Notifications (unread)', `${u.notifications} (${u.unreadNotifications})`], ['Agent logins on their deals', u.agentLoginsOnDeals], ['Agent invites', counts(u.agentInvites)]]} />
        <div className="mt-2 text-sm text-slate-300">AI: {u.ai.length ? u.ai.map((x: any) => `${x.feature} ${x.calls} calls / ${x.tokens.toLocaleString()} tokens`).join(' · ') : 'not used'}</div>
      </Section>
      <Section title="Money">
        <KV rows={[['Invoices', `${p.invoices.count} (${p.invoices.sent} sent, ${p.invoices.paid} paid)`], ['Invoiced', money(p.invoices.owed)], ['Collected', money(p.invoices.collected)], ['Refunded', money(p.invoices.refunded)], ['Commission statements', `${p.commissions.count} (${counts(p.commissions.byStatus)})`], ['Commission gross / brokerage net', `${money(p.commissions.grossDollars)} / ${money(p.commissions.brokerageNetDollars)}`]]} />
        {p.invoices.recent.length > 0 && <ul className="mt-2 text-sm space-y-0.5">{p.invoices.recent.map((i: any, n: number) => <li key={n} className="text-slate-300">#{i.invoice_number} · {i.agent || 'agent'} · {money(i.amount_owed)} · {i.paid ? 'paid' : i.sent_at ? 'sent' : 'draft'} <span className="text-slate-500">· {day(i.invoice_date)}</span></li>)}</ul>}
      </Section>
      <Section title={`Agent profiles (${p.agents.length})`}>
        {p.agents.length === 0 ? <Empty /> : <ul className="text-sm space-y-1">{p.agents.map((g: any, n: number) => <li key={n} className="text-slate-300">{g.name} <span className="text-slate-500">· {g.brokerage || 'no brokerage'} · {g.email || 'no email'} · fee {g.flat_fee != null ? money(g.flat_fee) : g.commission_percent != null ? `${g.commission_percent}%` : '—'} · {g.payment_method || 'no payment method'} · added {day(g.created_at)}</span></li>)}</ul>}
      </Section>
      <Section title={`Deals (${p.deals.length})`}>
        {p.deals.length === 0 ? <Empty /> : <ul className="text-sm space-y-1.5">{p.deals.map((d: any, n: number) => <li key={n} className="text-slate-300">{d.property_address || d.file_number}<div className="text-xs text-slate-500">{d.status} · agent {d.agent || '—'} · steps {d.steps.done}/{d.steps.total} · dates {d.keyDates.done}/{d.keyDates.total} · {d.documents} docs · {d.messages} msgs · accepted {day(d.acceptance_date)} · closing {day(d.closing_date)} · created {day(d.created_at)} · updated {day(d.updated_at)}</div></li>)}</ul>}
      </Section>
      <Section title={`Listings (${p.listings.length})`}>
        {p.listings.length === 0 ? <Empty /> : <ul className="text-sm space-y-1">{p.listings.map((l: any, n: number) => <li key={n} className="text-slate-300">{l.property_address}<div className="text-xs text-slate-500">{l.status} · agent {l.agent || '—'} · live {day(l.listed_on)} · ends {day(l.expiration_date)} · created {day(l.created_at)}</div></li>)}</ul>}
      </Section>
      <Section title={`Documents (${p.documents.length})`}>
        {p.documents.length === 0 ? <Empty /> : <ul className="text-sm space-y-0.5 max-h-60 overflow-y-auto">{p.documents.map((d: any, n: number) => <li key={n} className="text-slate-300">{d.file_name} <span className="text-slate-500">· {d.category || 'uncategorized'} {size(d.file_size)} · {day(d.created_at)}</span></li>)}</ul>}
      </Section>
      <Section title="Recent recorded actions (with where from)">
        {p.audit.length === 0 ? <Empty /> : <ul className="text-sm space-y-0.5 max-h-60 overflow-y-auto">{p.audit.map((x: any, n: number) => <li key={n} className="text-slate-300">{x.action} <span className="text-slate-500">· {when(x.at)} · {x.ip || 'no ip'} · {x.device}</span></li>)}</ul>}
      </Section>
    </div>
  );
}
