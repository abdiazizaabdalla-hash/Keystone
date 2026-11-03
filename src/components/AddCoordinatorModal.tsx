'use client';

import { useState } from 'react';
import { authFetch } from '@/lib/authClient';

// An agent adds a transaction coordinator to their deal. First question: does your coordinator already use Relay TC?
// Either way the coordinator is emailed; the wording differs (sign in vs. create an account), and the deal appears in
// their list once they accept.
export default function AddCoordinatorModal({
  transactionId,
  onClose,
  onInvited,
}: {
  transactionId: string;
  onClose: () => void;
  onInvited: () => void;
}) {
  const [usesRelay, setUsesRelay] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState('');

  const send = async () => {
    const address = email.trim();
    if (!address.includes('@')) {
      setError('Enter your coordinator’s email address.');
      return;
    }
    setSending(true);
    setError('');
    try {
      const res = await authFetch('/api/agent-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId, email: address, inviteeRole: 'tc', usesRelay: usesRelay !== false }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send the invitation');
      setSentTo(address);
      onInvited();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the invitation');
    } finally {
      setSending(false);
    }
  };

  const choice = 'w-full text-left bg-slate-800/60 hover:bg-slate-800 border border-white/10 hover:border-blue-500/50 rounded-xl p-4 transition';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Add a transaction coordinator">
      <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 className="text-lg font-bold text-slate-100">Add a transaction coordinator</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-200">
            ✕
          </button>
        </div>

        {sentTo ? (
          <div>
            <p className="text-slate-200 mb-2">Invitation sent to {sentTo}.</p>
            <p className="text-sm text-slate-400 mb-5">
              {usesRelay === false
                ? 'The email explains Relay TC and how to create an account. Once they accept, the deal appears in their list and you can message each other here.'
                : 'Once they accept from their Transactions page, the deal appears in their list and you can message each other here.'}
            </p>
            <button type="button" onClick={onClose} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl">
              Done
            </button>
          </div>
        ) : usesRelay === null ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-300 mb-1">Does your transaction coordinator already use Relay TC?</p>
            <button type="button" className={choice} onClick={() => setUsesRelay(true)}>
              <p className="font-semibold text-slate-100 text-sm">Yes, they have an account</p>
              <p className="text-xs text-slate-400 mt-1">We email them to sign in and accept.</p>
            </button>
            <button type="button" className={choice} onClick={() => setUsesRelay(false)}>
              <p className="font-semibold text-slate-100 text-sm">No, not yet</p>
              <p className="text-xs text-slate-400 mt-1">We email them what Relay TC is and how to create an account to take this deal.</p>
            </button>
          </div>
        ) : (
          <div>
            <p className="text-sm text-slate-300 mb-3">{usesRelay ? 'Their email address on Relay TC' : 'Their email address'}</p>
            <input
              type="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !sending && send()}
              placeholder="coordinator@example.com"
              className="w-full bg-slate-800/70 border border-white/10 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 text-sm focus:border-blue-500 focus:outline-none"
            />
            {error && <p className="text-sm text-red-300 mt-2">{error}</p>}
            <div className="flex flex-wrap gap-2 mt-4">
              <button type="button" onClick={send} disabled={sending || !email.trim()} className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-xl disabled:opacity-50">
                {sending ? 'Sending…' : 'Send invitation'}
              </button>
              <button type="button" onClick={() => { setUsesRelay(null); setError(''); }} className="px-4 py-2 text-slate-300 hover:text-slate-100 text-sm rounded-xl">
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
