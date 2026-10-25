'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';

interface Status {
  hasTeam: boolean;
  canShare: number;
  canCopy: number;
  sharedByMe: number;
}

// Sync contacts between "mine" and "the team's shared list". Nothing is overwritten: anyone
// whose email is already on the other side is skipped. Copies are separate, so changing a copy
// never changes the teammate's contact.
export default function SyncContactsModal({
  tags,
  onClose,
  onDone,
  onAuthError,
}: {
  tags: string[];
  onClose: () => void;
  onDone: () => void | Promise<void>;
  onAuthError?: (err: unknown) => boolean;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [tag, setTag] = useState('');
  const [doShare, setDoShare] = useState(false);
  const [doCopy, setDoCopy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  const loadStatus = async () => {
    const res = await authFetch('/api/contacts/sync');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not check your team contacts');
    setStatus(data);
  };

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await authFetch('/api/contacts/sync');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not check your team contacts');
        if (!cancelled) setStatus(data);
      } catch (err) {
        if (onAuthError?.(err)) return;
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not check your team contacts');
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [onAuthError]);

  const run = async () => {
    if (!doShare && !doCopy) return;
    if (doShare && !confirm(`Share ${tag ? `your "${tag}" contacts` : 'all your personal contacts'} with your team? Everyone on the team will be able to see and edit their details.`)) return;
    setBusy(true);
    setError('');
    setResult('');
    try {
      const res = await authFetch('/api/contacts/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ share: doShare, copy: doCopy, tag: doShare && tag ? tag : undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      const parts: string[] = [];
      if (doCopy) parts.push(`Copied ${data.copied} to your list${data.copiedSkipped ? ` (${data.copiedSkipped} already there)` : ''}.`);
      if (doShare) parts.push(`Shared ${data.shared} with your team${data.sharedSkipped ? ` (${data.sharedSkipped} already on the team list)` : ''}.`);
      setResult(parts.join(' '));
      await loadStatus();
      await onDone();
    } catch (err) {
      if (onAuthError?.(err)) return;
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-slate-800 border border-slate-600 rounded-xl p-6">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-lg font-bold text-slate-100">Sync contacts</h2>
          <button type="button" onClick={onClose} className="text-sm text-slate-400 hover:text-slate-200">
            Close
          </button>
        </div>
        <p className="text-sm text-slate-400 mb-4">
          Your contacts are personal until you share them. Nothing is overwritten: anyone already on the other side is skipped.
        </p>
        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
        {result && <p className="mb-3 text-sm text-green-400">{result}</p>}
        {!status ? (
          !error && <p className="text-sm text-slate-400">Checking…</p>
        ) : !status.hasTeam ? (
          <p className="text-sm text-slate-300">You are not on a team yet, so there is no shared list to sync with.</p>
        ) : (
          <div className="space-y-3">
            <label className="block border border-slate-600 rounded-lg p-3 cursor-pointer">
              <span className="flex items-start gap-2">
                <input type="checkbox" checked={doShare} onChange={(e) => setDoShare(e.target.checked)} disabled={status.canShare === 0} className="mt-1 accent-blue-500" />
                <span className="text-sm">
                  <span className="text-slate-100 font-medium">Share my contacts with the team</span>
                  <span className="block text-xs text-slate-400">
                    {status.canShare} of your contacts can be shared. Teammates see and edit their details; your notes and follow-ups stay private. They stay on your account.
                  </span>
                </span>
              </span>
              {doShare && tags.length > 0 && (
                <select
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  className="mt-2 w-full bg-slate-800/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-100"
                  aria-label="Only share contacts with this tag"
                >
                  <option value="">All my personal contacts</option>
                  {tags.map((t) => (
                    <option key={t} value={t}>
                      Only tagged “{t}”
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label className="block border border-slate-600 rounded-lg p-3 cursor-pointer">
              <span className="flex items-start gap-2">
                <input type="checkbox" checked={doCopy} onChange={(e) => setDoCopy(e.target.checked)} disabled={status.canCopy === 0} className="mt-1 accent-blue-500" />
                <span className="text-sm">
                  <span className="text-slate-100 font-medium">Copy team contacts to my list</span>
                  <span className="block text-xs text-slate-400">
                    {status.canCopy} teammate-shared contacts are not in your list yet. The copies are yours alone, and they are never added to your newsletter.
                  </span>
                </span>
              </span>
            </label>
            <button
              type="button"
              onClick={run}
              disabled={busy || (!doShare && !doCopy)}
              className="px-5 py-2.5 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition"
            >
              {busy ? 'Syncing…' : 'Sync now'}
            </button>
            <p className="text-xs text-slate-500">Already sharing {status.sharedByMe} contact{status.sharedByMe === 1 ? '' : 's'}.</p>
          </div>
        )}
      </div>
    </div>
  );
}
