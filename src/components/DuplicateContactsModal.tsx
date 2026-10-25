'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';

interface Dup {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
  contact_type: string | null;
}
interface Group {
  contacts: Dup[];
  reasons: string[];
}

// Likely duplicates (same name or phone number). Nothing changes until you pick the contact to
// keep and press Merge; the others are folded into it (notes, history and reminders move over).
export default function DuplicateContactsModal({
  onClose,
  onMerged,
  onAuthError,
}: {
  onClose: () => void;
  onMerged: () => void | Promise<void>;
  onAuthError?: (err: unknown) => boolean;
}) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [keep, setKeep] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await authFetch('/api/contacts/duplicates');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to look for duplicates');
        if (!cancelled) setGroups(data.groups || []);
      } catch (err) {
        if (onAuthError?.(err)) return;
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to look for duplicates');
          setGroups([]);
        }
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [onAuthError]);

  const merge = async (index: number, group: Group) => {
    const keepId = keep[index] || group.contacts[0].id;
    const others = group.contacts.filter((c) => c.id !== keepId);
    const label = group.contacts.find((c) => c.id === keepId)?.name || 'this contact';
    if (!confirm(`Merge ${others.length} contact${others.length === 1 ? '' : 's'} into ${label}? The others will be removed. This cannot be undone.`)) return;
    setBusy(index);
    setError('');
    try {
      const res = await authFetch('/api/contacts/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepId, mergeIds: others.map((c) => c.id) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Merge failed');
      setGroups((prev) => (prev || []).filter((_, i) => i !== index));
      setKeep({});
      await onMerged();
    } catch (err) {
      if (onAuthError?.(err)) return;
      setError(err instanceof Error ? err.message : 'Merge failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-800 border border-slate-600 rounded-xl p-6">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-lg font-bold text-slate-100">Possible duplicates</h2>
          <button type="button" onClick={onClose} className="text-sm text-slate-400 hover:text-slate-200">
            Close
          </button>
        </div>
        <p className="text-sm text-slate-400 mb-4">Pick the one to keep in each group. Blank details are filled in from the others, tags are combined, and notes, history and reminders move over.</p>
        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
        {groups === null ? (
          <p className="text-slate-400 text-sm">Looking…</p>
        ) : groups.length === 0 ? (
          <p className="text-slate-300 text-sm">No duplicates found. Contacts with the same name or phone number would show up here.</p>
        ) : (
          <ul className="space-y-4">
            {groups.map((g, i) => {
              const selected = keep[i] || g.contacts[0].id;
              return (
                <li key={g.contacts.map((c) => c.id).join('-')} className="border border-slate-600 rounded-lg p-3">
                  <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Match: {g.reasons.join(', ')}</p>
                  <ul className="space-y-2">
                    {g.contacts.map((c) => (
                      <li key={c.id}>
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input type="radio" name={`keep-${i}`} checked={selected === c.id} onChange={() => setKeep({ ...keep, [i]: c.id })} className="mt-1 accent-blue-500" />
                          <span className="text-sm min-w-0">
                            <span className="text-slate-100 font-medium">{c.name || c.email}</span>
                            <span className="block text-xs text-slate-400 break-words">{[c.email, c.phone, c.role, c.company].filter(Boolean).join(' · ') || 'No other details'}</span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => merge(i, g)}
                    className="mt-3 px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition"
                  >
                    {busy === i ? 'Merging…' : 'Merge into selected'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
