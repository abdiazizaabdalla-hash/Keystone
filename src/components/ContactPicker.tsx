'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';

interface DirectoryContact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
}

export interface PickedContact {
  name: string;
  email: string;
  phone: string;
  role: string;
}

// "Add from my contacts": opens the TC's Contacts directory so a saved person can be dropped onto a
// listing or a deal in one click, with the role for that job (a contact can be a Lender on one deal and
// a Buyer's agent on the next). The picker stays open so several people can be added in a row.
// `onPick` does the actual save and rejects if it fails, which is shown against that row.
export default function ContactPicker({
  onPick,
  existingEmails = [],
  label = 'Add from my contacts',
  className = 'text-xs text-blue-400 hover:text-blue-300 font-medium',
}: {
  onPick: (c: PickedContact) => Promise<void>;
  existingEmails?: (string | null | undefined)[];
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [contacts, setContacts] = useState<DirectoryContact[]>([]);
  const [q, setQ] = useState('');
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const onDeal = useMemo(() => new Set(existingEmails.map((e) => (e || '').trim().toLowerCase()).filter(Boolean)), [existingEmails]);

  const openPicker = async () => {
    setOpen(true);
    setError('');
    if (contacts.length > 0) return;
    setLoading(true);
    try {
      const res = await authFetch('/api/contacts');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load contacts');
      setContacts(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contacts');
    } finally {
      setLoading(false);
    }
  };

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? contacts.filter((c) => [c.name, c.email, c.company, c.role, c.phone].some((v) => (v || '').toLowerCase().includes(needle)))
      : contacts;
    return list.slice(0, 100);
  }, [contacts, q]);

  const pick = async (c: DirectoryContact) => {
    setBusy(c.id);
    setRowError((prev) => ({ ...prev, [c.id]: '' }));
    try {
      await onPick({
        name: c.name || c.company || '',
        email: c.email || '',
        phone: c.phone || '',
        role: (roles[c.id] ?? c.role ?? '').trim(),
      });
      setAdded((prev) => new Set(prev).add(c.id));
    } catch (err) {
      setRowError((prev) => ({ ...prev, [c.id]: err instanceof Error ? err.message : 'Could not add' }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <button type="button" onClick={openPicker} className={className}>
        {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg max-h-[85vh] flex flex-col bg-slate-800 border border-slate-600 rounded-xl p-5">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-lg font-bold text-slate-100">Add from my contacts</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-400 hover:text-slate-200">
                Done
              </button>
            </div>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, email, company or role"
              className="w-full bg-slate-800/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none mb-3"
            />
            <div className="overflow-y-auto space-y-2 min-h-[8rem]">
              {loading && <p className="text-sm text-slate-400">Loading contacts…</p>}
              {error && <p className="text-sm text-red-400">{error}</p>}
              {!loading && !error && contacts.length === 0 && (
                <p className="text-sm text-slate-400">
                  Nobody saved yet. People you add to deals are saved automatically, or add them on the{' '}
                  <Link href="/dashboard/contacts" className="text-blue-400 hover:text-blue-300">
                    Contacts page
                  </Link>
                  .
                </p>
              )}
              {!loading && contacts.length > 0 && shown.length === 0 && <p className="text-sm text-slate-400">No match.</p>}
              {shown.map((c) => {
                const already = added.has(c.id) || (c.email ? onDeal.has(c.email.toLowerCase()) : false);
                return (
                  <div key={c.id} className="rounded-lg bg-slate-700/40 border border-slate-600/60 px-3 py-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-slate-100 font-medium break-words">{c.name || c.company || c.email}</p>
                        <p className="text-xs text-slate-400 break-all">{[c.company && c.name ? c.company : '', c.email, c.phone].filter(Boolean).join(' · ')}</p>
                      </div>
                      {already ? (
                        <span className="text-xs text-green-400 shrink-0 pt-0.5">{added.has(c.id) ? 'Added' : 'Already here'}</span>
                      ) : (
                        <button
                          type="button"
                          disabled={busy === c.id}
                          onClick={() => pick(c)}
                          className="text-xs px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50 shrink-0"
                        >
                          {busy === c.id ? 'Adding…' : 'Add'}
                        </button>
                      )}
                    </div>
                    {!already && (
                      <input
                        value={roles[c.id] ?? c.role ?? ''}
                        onChange={(e) => setRoles((prev) => ({ ...prev, [c.id]: e.target.value }))}
                        placeholder="Role on this one (Buyer, Lender, Photographer…)"
                        className="mt-2 w-full bg-slate-600 border border-slate-600 rounded-md px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                      />
                    )}
                    {rowError[c.id] && <p className="text-xs text-red-400 mt-1">{rowError[c.id]}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
