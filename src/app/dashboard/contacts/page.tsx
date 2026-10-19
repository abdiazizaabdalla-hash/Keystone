'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import type { ContactRow } from '@/lib/contactsCrm';

// Contacts: the TC's address book. Everyone in their business in one place, with
// tags to slice it ("lender", "past client", "Austin") and a newsletter flag that
// exports to any email tool. Relay doesn't send newsletters itself.

interface FormState {
  id?: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  role: string;
  notes: string;
  tags: string;
  newsletter: boolean;
}

const EMPTY_FORM: FormState = { name: '', email: '', phone: '', company: '', role: '', notes: '', tags: '', newsletter: false };

const inputCls =
  'w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none';

export default function ContactsPage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [newsletterOnly, setNewsletterOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTag, setBulkTag] = useState('');

  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [working, setWorking] = useState(false);

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

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/contacts');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load contacts');
      setContacts(data);
      setError('');
    } catch (err) {
      if (handleAuth(err)) return;
      setError(err instanceof Error ? err.message : 'Failed to load contacts');
    } finally {
      setLoading(false);
    }
  }, [handleAuth]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3500);
  };

  const tagCounts = useMemo(() => {
    const map = new Map<string, { label: string; count: number }>();
    for (const c of contacts) {
      for (const t of c.tags || []) {
        const key = t.toLowerCase();
        const entry = map.get(key);
        if (entry) entry.count += 1;
        else map.set(key, { label: t, count: 1 });
      }
    }
    return [...map.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [contacts]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (newsletterOnly && !c.newsletter) return false;
      if (activeTag && !(c.tags || []).some((t) => t.toLowerCase() === activeTag)) return false;
      if (!q) return true;
      return [c.name, c.email, c.phone, c.company, c.role, ...(c.tags || [])].some((v) => (v || '').toLowerCase().includes(q));
    });
  }, [contacts, search, activeTag, newsletterOnly]);

  const newsletterCount = contacts.filter((c) => c.newsletter && c.email).length;
  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach((c) => next.delete(c.id));
      else visible.forEach((c) => next.add(c.id));
      return next;
    });

  const openEdit = (c: ContactRow) =>
    setForm({
      id: c.id,
      name: c.name || '',
      email: c.email || '',
      phone: c.phone || '',
      company: c.company || '',
      role: c.role || '',
      notes: c.notes || '',
      tags: (c.tags || []).join(', '),
      newsletter: c.newsletter,
    });

  const saveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setFormError('');
    try {
      const res = await authFetch(form.id ? `/api/contacts/${form.id}` : '/api/contacts', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, tags: form.tags.split(',') }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save contact');
      setForm(null);
      await load();
    } catch (err) {
      if (handleAuth(err)) return;
      setFormError(err instanceof Error ? err.message : 'Failed to save contact');
    } finally {
      setSaving(false);
    }
  };

  const runBulk = async (action: string, extra: Record<string, unknown> = {}) => {
    if (selected.size === 0) return;
    if (action === 'delete' && !confirm(`Delete ${selected.size} contact${selected.size === 1 ? '' : 's'}? This cannot be undone.`)) return;
    setWorking(true);
    try {
      const res = await authFetch('/api/contacts/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selected], action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      if (action === 'delete') setSelected(new Set());
      if (action === 'add_tag' || action === 'remove_tag') setBulkTag('');
      await load();
      flash('Done.');
    } catch (err) {
      if (handleAuth(err)) return;
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setWorking(false);
    }
  };

  const importFromDeals = async () => {
    setWorking(true);
    setError('');
    try {
      const res = await authFetch('/api/contacts/import-from-deals', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to import');
      await load();
      flash(data.added > 0 ? `Added ${data.added} contact${data.added === 1 ? '' : 's'} from your deals.` : 'Everyone from your deals is already here.');
    } catch (err) {
      if (handleAuth(err)) return;
      setError(err instanceof Error ? err.message : 'Failed to import');
    } finally {
      setWorking(false);
    }
  };

  const exportCsv = async (newsletter: boolean) => {
    try {
      const qs = new URLSearchParams();
      if (newsletter) qs.set('newsletter', '1');
      if (activeTag) qs.set('tag', activeTag);
      const res = await authFetch(`/api/contacts/export?${qs.toString()}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to export');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = newsletter ? 'relay-contacts-newsletter.csv' : 'relay-contacts.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (handleAuth(err)) return;
      setError(err instanceof Error ? err.message : 'Failed to export');
    }
  };

  if (loading) {
    return (
      <div className="p-4 md:p-8">
        <p className="text-slate-400">Loading contacts…</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-semibold text-slate-100 mb-1">Contacts</h1>
          <p className="text-slate-400">Everyone in your business in one place, with tags to sort them.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={importFromDeals}
            disabled={working}
            className="px-4 py-2.5 border border-slate-600 hover:border-slate-500 text-slate-200 text-sm font-semibold rounded-lg transition disabled:opacity-50"
          >
            Import from my deals
          </button>
          <button
            type="button"
            onClick={() => {
              setFormError('');
              setForm({ ...EMPTY_FORM });
            }}
            className="px-4 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white text-sm font-semibold rounded-lg transition"
          >
            + Add contact
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
      {notice && <p className="mb-4 text-sm text-green-400">{notice}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, company, tag…"
          className={`${inputCls} max-w-sm`}
        />
        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
          <input type="checkbox" checked={newsletterOnly} onChange={(e) => setNewsletterOnly(e.target.checked)} className="accent-blue-500" />
          Newsletter only ({newsletterCount})
        </label>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <button type="button" onClick={() => exportCsv(false)} className="text-blue-400 hover:text-blue-300">
            Export CSV
          </button>
          <button type="button" onClick={() => exportCsv(true)} disabled={newsletterCount === 0} className="text-blue-400 hover:text-blue-300 disabled:opacity-40">
            Export newsletter list
          </button>
        </div>
      </div>

      {tagCounts.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveTag(null)}
            className={`text-xs px-3 py-1 rounded-full border transition ${
              activeTag === null ? 'border-blue-500 text-blue-300 bg-blue-500/10' : 'border-slate-600 text-slate-400 hover:text-slate-200'
            }`}
          >
            All ({contacts.length})
          </button>
          {tagCounts.map(([key, { label, count }]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTag(activeTag === key ? null : key)}
              className={`text-xs px-3 py-1 rounded-full border transition ${
                activeTag === key ? 'border-blue-500 text-blue-300 bg-blue-500/10' : 'border-slate-600 text-slate-400 hover:text-slate-200'
              }`}
            >
              {label} ({count})
            </button>
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 px-4 py-3 bg-slate-700/60 border border-slate-600 rounded-lg text-sm">
          <span className="text-slate-200 font-medium">{selected.size} selected</span>
          <input
            value={bulkTag}
            onChange={(e) => setBulkTag(e.target.value)}
            placeholder="Tag name"
            maxLength={30}
            className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-slate-100 text-sm w-36"
          />
          <button type="button" disabled={working || !bulkTag.trim()} onClick={() => runBulk('add_tag', { tag: bulkTag })} className="text-blue-400 hover:text-blue-300 disabled:opacity-40">
            Add tag
          </button>
          <button type="button" disabled={working || !bulkTag.trim()} onClick={() => runBulk('remove_tag', { tag: bulkTag })} className="text-blue-400 hover:text-blue-300 disabled:opacity-40">
            Remove tag
          </button>
          <span className="text-slate-600">|</span>
          <button type="button" disabled={working} onClick={() => runBulk('subscribe')} className="text-blue-400 hover:text-blue-300 disabled:opacity-40">
            Add to newsletter
          </button>
          <button type="button" disabled={working} onClick={() => runBulk('unsubscribe')} className="text-slate-300 hover:text-slate-100 disabled:opacity-40">
            Remove from newsletter
          </button>
          <button type="button" disabled={working} onClick={() => runBulk('delete')} className="text-red-400 hover:text-red-300 disabled:opacity-40 ml-auto">
            Delete
          </button>
        </div>
      )}

      {contacts.length === 0 ? (
        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8 text-center">
          <p className="text-slate-200 font-semibold mb-1">Your address book is empty</p>
          <p className="text-slate-400 text-sm mb-5">Pull in the agents and lenders already on your deals, or add someone by hand.</p>
          <button
            type="button"
            onClick={importFromDeals}
            disabled={working}
            className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
          >
            Import from my deals
          </button>
        </div>
      ) : (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-700">
                <th className="px-4 py-3 w-8">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} className="accent-blue-500" aria-label="Select all shown" />
                </th>
                <th className="px-2 py-3">Name</th>
                <th className="px-2 py-3">Email / phone</th>
                <th className="px-2 py-3">Tags</th>
                <th className="px-2 py-3">Newsletter</th>
                <th className="px-2 py-3 w-16" />
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id} className="border-b border-slate-700/60 last:border-0 hover:bg-slate-700/20">
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} className="accent-blue-500" aria-label={`Select ${c.name || c.email}`} />
                  </td>
                  <td className="px-2 py-3">
                    <p className="text-slate-100 font-medium break-words">{c.name || c.email}</p>
                    <p className="text-xs text-slate-500 break-words">{[c.role, c.company].filter(Boolean).join(' · ')}</p>
                  </td>
                  <td className="px-2 py-3 text-slate-300">
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="text-blue-400 hover:text-blue-300 break-all">
                        {c.email}
                      </a>
                    )}
                    {c.phone && <p className="text-xs text-slate-500">{c.phone}</p>}
                  </td>
                  <td className="px-2 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(c.tags || []).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setActiveTag(t.toLowerCase())}
                          className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 hover:text-blue-300"
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-3">
                    {c.newsletter ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/30 text-green-300 border border-green-700/50">Subscribed</span>
                    ) : (
                      <span className="text-xs text-slate-600">No</span>
                    )}
                  </td>
                  <td className="px-2 py-3 text-right">
                    <button type="button" onClick={() => openEdit(c)} className="text-xs text-blue-400 hover:text-blue-300">
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No contacts match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-slate-500 max-w-2xl">
        Relay doesn&rsquo;t send newsletters. Mark people who agreed to hear from you, then export the list into Mailchimp, Constant Contact, or any email tool.
        Only add people who have said yes, and keep an unsubscribe link in every email you send.
      </p>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <form onSubmit={saveForm} className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-slate-800 border border-slate-600 rounded-xl p-6 space-y-3">
            <h2 className="text-lg font-bold text-slate-100">{form.id ? 'Edit contact' : 'Add contact'}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input className={inputCls} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className={inputCls} placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <input className={inputCls} placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <input className={inputCls} placeholder="Company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              <input className={inputCls} placeholder="Role (Agent, Lender, Title…)" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
              <input className={inputCls} placeholder="Tags, separated by commas" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
            </div>
            <textarea className={inputCls} rows={3} placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={form.newsletter}
                disabled={!form.email.trim()}
                onChange={(e) => setForm({ ...form, newsletter: e.target.checked })}
                className="accent-blue-500"
              />
              Agreed to receive my newsletter {!form.email.trim() && <span className="text-slate-500">(needs an email)</span>}
            </label>
            {formError && <p className="text-sm text-red-400">{formError}</p>}
            <div className="flex items-center gap-3 pt-1">
              <button type="submit" disabled={saving} className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={() => setForm(null)} className="text-sm text-slate-400 hover:text-slate-200">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
