'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import type { ContactRow, ContactActivityRow, ContactReminderRow, ActivityKind } from '@/lib/contactsCrm';
import { dueLabel, shortDate, timeAgo, todayLocal } from '@/lib/contactDates';
import ContactEditModal from '@/components/ContactEditModal';
import AddContactToDealModal from '@/components/AddContactToDealModal';

// A contact's profile: who they are, the deals and listings you share, your notes and recorded
// interactions, and follow-up reminders. Private to your account; nothing here is shown to the contact.

interface Profile {
  contact: ContactRow;
  isOwner: boolean;
  hasTeam: boolean;
  sharedByName: string | null;
  organization: { id: string; name: string; email: string | null } | null;
  people: { id: string; name: string; email: string | null; phone: string | null; role: string | null }[];
  transactions: { id: string; property_address: string; file_number: string | null; status: string | null; closing_date: string | null; as: string }[];
  listings: { id: string; property_address: string; status: string | null; list_price: number | null; as: string }[];
  stats: {
    transactionsTotal: number;
    transactionsActive: number;
    transactionsClosed: number;
    listingsTotal: number;
    listingsActive: number;
    lastClosingDate: string | null;
  };
  lastInteractionAt: string | null;
  nextFollowUpOn: string | null;
}

const KIND_LABEL: Record<ActivityKind, string> = { note: 'Note', call: 'Call', email: 'Email', text: 'Text', meeting: 'Meeting', other: 'Other' };
const LISTING_LABEL: Record<string, string> = { preparing: 'Preparing', active: 'Active', under_offer: 'Under offer', converted: 'Converted', expired: 'Expired', withdrawn: 'Withdrawn' };

const inputCls =
  'w-full bg-slate-800/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none';
const cardCls = 'bg-white/5 border border-white/10 rounded-2xl p-5';

export default function ContactProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [activity, setActivity] = useState<ContactActivityRow[]>([]);
  const [reminders, setReminders] = useState<ContactReminderRow[]>([]);
  const [allContacts, setAllContacts] = useState<ContactRow[]>([]);
  const [addingPerson, setAddingPerson] = useState(false);
  const [linkId, setLinkId] = useState('');
  const [linking, setLinking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [addToDeal, setAddToDeal] = useState(false);

  const [kind, setKind] = useState<ActivityKind>('note');
  const [entry, setEntry] = useState('');
  const [posting, setPosting] = useState(false);
  const [remDate, setRemDate] = useState('');
  const [remNote, setRemNote] = useState('');
  const [showDone, setShowDone] = useState(false);

  const handleAuth = useCallback(
    (err: unknown) => {
      if (err instanceof AuthRequiredError) {
        router.push('/auth');
        return true;
      }
      return false;
    },
    [router]
  );

  const loadProfile = useCallback(async () => {
    const res = await authFetch(`/api/contacts/${id}/profile`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load this contact');
    setProfile(data);
  }, [id]);

  const loadAll = useCallback(async () => {
    try {
      const [, actRes, remRes, orgRes] = await Promise.all([
        loadProfile(),
        authFetch(`/api/contacts/${id}/activity`).then((r) => r.json()),
        authFetch(`/api/contacts/${id}/reminders`).then((r) => r.json()),
        authFetch('/api/contacts').then((r) => r.json()),
      ]);
      setActivity(actRes.activity || []);
      setReminders(remRes.reminders || []);
      setAllContacts(Array.isArray(orgRes) ? orgRes : []);
      setError('');
    } catch (err) {
      if (handleAuth(err)) return;
      setError(err instanceof Error ? err.message : 'Failed to load this contact');
    } finally {
      setLoading(false);
    }
  }, [id, loadProfile, handleAuth]);

  useEffect(() => {
    const t = setTimeout(loadAll, 0);
    return () => clearTimeout(t);
  }, [loadAll]);

  const call = async (url: string, init: RequestInit, failMsg: string) => {
    const res = await authFetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || failMsg);
    return data;
  };

  const addEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entry.trim()) return;
    setPosting(true);
    setError('');
    try {
      await call(`/api/contacts/${id}/activity`, { method: 'POST', body: JSON.stringify({ kind, body: entry }) }, 'Failed to save');
      setEntry('');
      const res = await authFetch(`/api/contacts/${id}/activity`);
      setActivity((await res.json()).activity || []);
      await loadProfile();
    } catch (err) {
      if (!handleAuth(err)) setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setPosting(false);
    }
  };

  const removeEntry = async (entryId: string) => {
    if (!confirm('Delete this entry?')) return;
    try {
      await call(`/api/contacts/${id}/activity?entry=${entryId}`, { method: 'DELETE' }, 'Failed to delete');
      setActivity((prev) => prev.filter((a) => a.id !== entryId));
      await loadProfile();
    } catch (err) {
      if (!handleAuth(err)) setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const addReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!remDate) return;
    try {
      const created = await call(`/api/contacts/${id}/reminders`, { method: 'POST', body: JSON.stringify({ dueOn: remDate, note: remNote }) }, 'Failed to add reminder');
      setReminders((prev) => [...prev, created].sort((a, b) => a.due_on.localeCompare(b.due_on)));
      setRemDate('');
      setRemNote('');
      await loadProfile();
    } catch (err) {
      if (!handleAuth(err)) setError(err instanceof Error ? err.message : 'Failed to add reminder');
    }
  };

  const toggleReminder = async (r: ContactReminderRow) => {
    try {
      const updated = await call(`/api/contacts/${id}/reminders`, { method: 'PATCH', body: JSON.stringify({ reminderId: r.id, done: !r.done_at }) }, 'Failed to update');
      setReminders((prev) => prev.map((x) => (x.id === r.id ? updated : x)));
      await loadProfile();
    } catch (err) {
      if (!handleAuth(err)) setError(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const removeReminder = async (rid: string) => {
    try {
      await call(`/api/contacts/${id}/reminders?reminder=${rid}`, { method: 'DELETE' }, 'Failed to delete');
      setReminders((prev) => prev.filter((x) => x.id !== rid));
      await loadProfile();
    } catch (err) {
      if (!handleAuth(err)) setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const organizations = useMemo(() => allContacts.filter((c) => c.contact_type === 'organization'), [allContacts]);
  // People who could be added to this organization: not organizations, and not already here.
  const linkable = useMemo(
    () => allContacts.filter((c) => c.contact_type !== 'organization' && c.id !== id && c.organization_id !== id).sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || '')),
    [allContacts, id]
  );

  const linkExisting = async () => {
    const person = allContacts.find((c) => c.id === linkId);
    if (!person) return;
    setLinking(true);
    setError('');
    try {
      // The contact API saves the whole record, so send the person's current details with the new organization.
      await call(
        `/api/contacts/${person.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            name: person.name,
            email: person.email,
            phone: person.phone,
            company: person.company || profile?.contact.name || '',
            role: person.role,
            notes: person.notes,
            tags: person.tags,
            newsletter: person.newsletter,
            contactType: 'person',
            organizationId: id,
          }),
        },
        'Failed to add this person'
      );
      setLinkId('');
      await loadAll();
    } catch (err) {
      if (!handleAuth(err)) setError(err instanceof Error ? err.message : 'Failed to add this person');
    } finally {
      setLinking(false);
    }
  };

  const open = useMemo(() => reminders.filter((r) => !r.done_at), [reminders]);
  const done = useMemo(() => reminders.filter((r) => r.done_at), [reminders]);
  const today = todayLocal();

  if (loading) {
    return (
      <div className="p-4 md:p-8">
        <p className="text-slate-400">Loading contact…</p>
      </div>
    );
  }
  if (!profile) {
    return (
      <div className="p-4 md:p-8">
        <p className="text-red-400 mb-3">{error || 'Contact not found'}</p>
        <Link href="/dashboard/contacts" className="text-blue-400 hover:text-blue-300 text-sm">
          Back to contacts
        </Link>
      </div>
    );
  }

  const { contact, stats } = profile;
  const isOrg = contact.contact_type === 'organization';
  const title = contact.name || contact.email || 'Contact';
  const tx = stats.transactionsTotal;
  const summary = [
    tx > 0 ? `${tx} transaction${tx === 1 ? '' : 's'} together${stats.transactionsActive > 0 ? `, ${stats.transactionsActive} active` : ''}` : 'No transactions together yet',
    stats.listingsTotal > 0 ? `${stats.listingsTotal} listing${stats.listingsTotal === 1 ? '' : 's'}` : null,
    profile.lastInteractionAt ? `last communicated ${timeAgo(profile.lastInteractionAt)}` : 'no interactions logged yet',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <Link href="/dashboard/contacts" className="text-sm text-slate-400 hover:text-slate-200">
        ← All contacts
      </Link>

      <div className={`${cardCls} mt-3 mb-5`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <span className={`w-14 h-14 shrink-0 flex items-center justify-center text-xl font-bold text-white bg-gradient-to-br from-blue-500 to-blue-600 ${isOrg ? 'rounded-xl' : 'rounded-full'}`}>
              {(title[0] || '?').toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-display font-semibold text-slate-100 break-words">{title}</h1>
                <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border border-slate-600 text-slate-300">{isOrg ? 'Organization' : 'Person'}</span>
                {contact.team_id && (
                  <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border border-emerald-600/50 text-emerald-300">
                    {profile.isOwner ? 'Shared with team' : `Shared by ${profile.sharedByName || 'a teammate'}`}
                  </span>
                )}
                {contact.agent_id && <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border border-blue-500/50 text-blue-300">Agent profile</span>}
              </div>
              <p className="text-sm text-slate-400 mt-0.5">
                {[contact.role, contact.company].filter(Boolean).join(' · ')}
                {profile.organization && (
                  <>
                    {contact.role || contact.company ? ' · ' : ''}works at{' '}
                    <Link href={`/dashboard/contacts/${profile.organization.id}`} className="text-blue-400 hover:text-blue-300">
                      {profile.organization.name || profile.organization.email}
                    </Link>
                  </>
                )}
              </p>
              <p className="text-sm text-slate-300 mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {contact.email && (
                  <a href={`mailto:${contact.email}`} className="text-blue-400 hover:text-blue-300 break-all">
                    {contact.email}
                  </a>
                )}
                {contact.phone && (
                  <a href={`tel:${contact.phone}`} className="text-blue-400 hover:text-blue-300">
                    {contact.phone}
                  </a>
                )}
              </p>
              {(contact.tags || []).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {contact.tags.map((t) => (
                    <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setAddToDeal(true)} className="px-4 py-2 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm font-semibold rounded-lg transition">
              Add to deal
            </button>
            <button type="button" onClick={() => setEditing(true)} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition">
              Edit
            </button>
          </div>
        </div>
        <p className="mt-4 text-sm text-slate-300">{summary}</p>
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Transactions" value={String(stats.transactionsTotal)} sub={`${stats.transactionsActive} active · ${stats.transactionsClosed} closed`} />
        <Stat label="Listings" value={String(stats.listingsTotal)} sub={`${stats.listingsActive} in progress`} />
        <Stat label="Last communicated" value={profile.lastInteractionAt ? timeAgo(profile.lastInteractionAt) : '—'} sub={profile.lastInteractionAt ? shortDate(profile.lastInteractionAt) : 'Log a call, email, text or meeting'} />
        <Stat
          label="Next follow-up"
          value={profile.nextFollowUpOn ? shortDate(profile.nextFollowUpOn) : '—'}
          sub={profile.nextFollowUpOn ? dueLabel(profile.nextFollowUpOn, today).text : 'None set'}
          alert={!!profile.nextFollowUpOn && dueLabel(profile.nextFollowUpOn, today).overdue}
        />
      </div>

      <div className="grid lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3 space-y-5">
          <section className={cardCls}>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-1">Notes &amp; activity</h2>
            {contact.team_id && <p className="text-xs text-slate-500 mb-3">Private to you. Teammates keep their own notes, history and follow-ups on this shared contact.</p>}
            {!contact.team_id && <div className="mb-2" />}
            <form onSubmit={addEntry} className="space-y-2 mb-4">
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(KIND_LABEL) as ActivityKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={`text-xs px-3 py-1 rounded-full border transition ${kind === k ? 'border-blue-500 text-blue-300 bg-blue-500/10' : 'border-slate-600 text-slate-400 hover:text-slate-200'}`}
                  >
                    {KIND_LABEL[k]}
                  </button>
                ))}
              </div>
              <textarea
                className={inputCls}
                rows={3}
                maxLength={4000}
                value={entry}
                onChange={(e) => setEntry(e.target.value)}
                placeholder={kind === 'note' ? 'Add a note: preferences, context, something to remember…' : `What was said on the ${KIND_LABEL[kind].toLowerCase()}?`}
              />
              <button type="submit" disabled={posting || !entry.trim()} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition">
                {posting ? 'Saving…' : kind === 'note' ? 'Add note' : `Log ${KIND_LABEL[kind].toLowerCase()}`}
              </button>
            </form>
            {activity.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing yet. Notes and the calls, emails, texts and meetings you log will build a history here.</p>
            ) : (
              <ul className="space-y-3">
                {activity.map((a) => (
                  <li key={a.id} className="border-l-2 border-slate-600 pl-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-slate-400">
                        <span className="font-semibold text-slate-300">{KIND_LABEL[a.kind]}</span> · {shortDate(a.occurred_at)}
                      </p>
                      <button type="button" onClick={() => removeEntry(a.id)} className="text-xs text-slate-500 hover:text-red-400">
                        Delete
                      </button>
                    </div>
                    <p className="text-sm text-slate-200 whitespace-pre-wrap break-words">{a.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={cardCls}>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-3">Transactions together ({profile.transactions.length})</h2>
            {profile.transactions.length === 0 ? (
              <p className="text-sm text-slate-500">No transactions yet. They appear here when this person is the agent or a party on one of your deals.</p>
            ) : (
              <ul className="divide-y divide-slate-700/60">
                {profile.transactions.map((t) => (
                  <li key={t.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/dashboard/transactions/${t.id}`} className="text-sm text-blue-400 hover:text-blue-300 break-words">
                      {t.property_address}
                    </Link>
                    <span className="text-xs text-slate-500">
                      {t.as} · {t.status || 'Open'}
                      {t.closing_date ? ` · closes ${shortDate(t.closing_date)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={cardCls}>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-3">Listings ({profile.listings.length})</h2>
            {profile.listings.length === 0 ? (
              <p className="text-sm text-slate-500">No listings yet.</p>
            ) : (
              <ul className="divide-y divide-slate-700/60">
                {profile.listings.map((l) => (
                  <li key={l.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/dashboard/listings/${l.id}`} className="text-sm text-blue-400 hover:text-blue-300 break-words">
                      {l.property_address}
                    </Link>
                    <span className="text-xs text-slate-500">
                      {l.as} · {LISTING_LABEL[l.status || ''] || l.status || 'Open'}
                      {l.list_price ? ` · $${Number(l.list_price).toLocaleString()}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="lg:col-span-2 space-y-5">
          <section className={cardCls}>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-3">Follow-ups</h2>
            <form onSubmit={addReminder} className="space-y-2 mb-3">
              <div className="flex gap-2">
                <input type="date" min={today} value={remDate} onChange={(e) => setRemDate(e.target.value)} className={`${inputCls} w-40`} aria-label="Follow-up date" />
                <input value={remNote} maxLength={300} onChange={(e) => setRemNote(e.target.value)} placeholder="Reason (optional)" className={inputCls} />
              </div>
              <button type="submit" disabled={!remDate} className="px-4 py-2 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm font-semibold rounded-lg disabled:opacity-50 transition">
                Remind me
              </button>
            </form>
            {open.length === 0 ? (
              <p className="text-sm text-slate-500">No follow-ups scheduled.</p>
            ) : (
              <ul className="space-y-2">
                {open.map((r) => {
                  const due = dueLabel(r.due_on, today);
                  return (
                    <li key={r.id} className="flex items-start gap-2">
                      <input type="checkbox" checked={false} onChange={() => toggleReminder(r)} className="mt-1 accent-blue-500" aria-label="Mark done" />
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm ${due.overdue ? 'text-red-300' : 'text-slate-200'}`}>
                          {shortDate(r.due_on)} <span className="text-xs text-slate-500">· {due.text}</span>
                        </p>
                        {r.note && <p className="text-xs text-slate-400 break-words">{r.note}</p>}
                      </div>
                      <button type="button" onClick={() => removeReminder(r.id)} className="text-xs text-slate-500 hover:text-red-400">
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {done.length > 0 && (
              <div className="mt-3">
                <button type="button" onClick={() => setShowDone(!showDone)} className="text-xs text-slate-400 hover:text-slate-200">
                  {showDone ? 'Hide' : 'Show'} {done.length} completed
                </button>
                {showDone && (
                  <ul className="mt-2 space-y-1.5">
                    {done.map((r) => (
                      <li key={r.id} className="flex items-start gap-2 text-sm text-slate-500">
                        <input type="checkbox" checked onChange={() => toggleReminder(r)} className="mt-1 accent-blue-500" aria-label="Mark not done" />
                        <span className="line-through break-words">
                          {shortDate(r.due_on)}
                          {r.note ? ` · ${r.note}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          <section className={cardCls}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Preferences &amp; context</h2>
              <button type="button" onClick={() => setEditing(true)} className="text-xs text-blue-400 hover:text-blue-300">
                Edit
              </button>
            </div>
            {contact.notes ? <p className="text-sm text-slate-200 whitespace-pre-wrap break-words">{contact.notes}</p> : <p className="text-sm text-slate-500">Nothing saved. Use Edit to record how they like to work.</p>}
          </section>

          {isOrg && (
            <section className={cardCls}>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-3">People ({profile.people.length})</h2>
              {profile.people.length === 0 ? (
                <p className="text-sm text-slate-500 mb-3">No one is linked here yet.</p>
              ) : (
                <ul className="space-y-2 mb-3">
                  {profile.people.map((p) => (
                    <li key={p.id}>
                      <Link href={`/dashboard/contacts/${p.id}`} className="text-sm text-blue-400 hover:text-blue-300">
                        {p.name || p.email}
                      </Link>
                      {p.role && <span className="text-xs text-slate-500"> · {p.role}</span>}
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={() => setAddingPerson(true)} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition">
                + Add person
              </button>
              {linkable.length > 0 && (
                <div className="mt-3 flex gap-2">
                  <select value={linkId} onChange={(e) => setLinkId(e.target.value)} className={inputCls} aria-label="Add an existing contact">
                    <option value="">Or add an existing contact…</option>
                    {linkable.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name || c.email}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={linkExisting}
                    disabled={!linkId || linking}
                    className="px-4 py-2 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm font-semibold rounded-lg disabled:opacity-50 transition shrink-0"
                  >
                    {linking ? 'Adding…' : 'Add'}
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {editing && (
        <ContactEditModal
          contact={contact}
          organizations={organizations}
          hasTeam={profile.hasTeam}
          isOwner={profile.isOwner}
          onClose={() => setEditing(false)}
          onAuthError={handleAuth}
          onSaved={async () => {
            setEditing(false);
            await loadAll();
          }}
        />
      )}
      {addingPerson && (
        <ContactEditModal
          contact={null}
          organizations={organizations}
          defaults={{ organizationId: id, company: contact.name }}
          hasTeam={profile.hasTeam}
          onClose={() => setAddingPerson(false)}
          onAuthError={handleAuth}
          onSaved={async () => {
            setAddingPerson(false);
            await loadAll();
          }}
        />
      )}
      {addToDeal && <AddContactToDealModal person={contact} onClose={() => setAddToDeal(false)} />}
    </div>
  );
}

function Stat({ label, value, sub, alert }: { label: string; value: string; sub: string; alert?: boolean }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`text-xl font-semibold mt-1 ${alert ? 'text-red-300' : 'text-slate-100'}`}>{value}</p>
      <p className={`text-xs mt-0.5 ${alert ? 'text-red-300/80' : 'text-slate-500'}`}>{sub}</p>
    </div>
  );
}
