'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/authClient';
import { isFeatureOnClient } from '@/lib/features';

interface Invitation {
  inviteId: string;
  transactionId: string;
  propertyAddress: string | null;
  agentLabel: string;
}

/**
 * Deals an agent has invited this coordinator onto, waiting for a yes.
 * Shown at the top of the dashboard; accepting puts the deal in their account.
 * Renders nothing when there are none (or the agent workspace is off).
 */
export default function TcInvitationBanner({ onAccepted }: { onAccepted?: () => void }) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isFeatureOnClient('agent_workspace')) return;
    (async () => {
      try {
        const res = await authFetch('/api/agent-invites');
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data)) setInvitations(data);
      } catch {
        // The banner is a convenience; the Transactions page still lists invitations.
      }
    })();
  }, []);

  const accept = async (transactionId: string) => {
    try {
      setError('');
      setAcceptingId(transactionId);
      const res = await authFetch('/api/agent-invites/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId }),
      });
      if (!res.ok) throw new Error('Could not accept the invitation');
      setInvitations((prev) => prev.filter((i) => i.transactionId !== transactionId));
      onAccepted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept the invitation');
    } finally {
      setAcceptingId(null);
    }
  };

  if (invitations.length === 0) return null;

  return (
    <div className="mb-6 space-y-2" aria-label="Invitations">
      {invitations.map((inv) => (
        <div key={inv.inviteId} className="flex flex-wrap items-center justify-between gap-3 bg-sky-500/10 border border-sky-400/30 rounded-2xl px-4 py-3">
          <p className="text-sm text-slate-200">
            <span className="font-semibold">{inv.agentLabel}</span> invited you to coordinate {inv.propertyAddress ? <span className="font-semibold">{inv.propertyAddress}</span> : 'a deal'}.
          </p>
          <button
            type="button"
            onClick={() => accept(inv.transactionId)}
            disabled={acceptingId === inv.transactionId}
            className="px-4 py-2 bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold rounded-xl transition disabled:opacity-50"
          >
            {acceptingId === inv.transactionId ? 'Accepting…' : 'Accept'}
          </button>
        </div>
      ))}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
