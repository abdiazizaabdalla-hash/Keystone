'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { useRouter } from 'next/navigation';

interface ConversationRow {
  transactionId: string;
  fileNumber: string;
  propertyAddress: string | null;
  agentName: string;
  lastMessage: {
    senderRole: 'tc' | 'agent';
    body: string;
    createdAt: string;
    attachmentFileName: string | null;
  } | null;
}

// Top-level inbox the sidebar's new Messages tab opens into -- every
// conversation across every transaction that has agent-portal access
// switched on, newest activity first, so a TC can jump straight into
// whichever thread needs a reply instead of hunting through
// Transactions first. See src/app/api/messages/overview/route.ts.
export default function MessagesOverviewPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await authFetch('/api/messages/overview');
        if (!res.ok) throw new Error('Failed to load messages');
        const data = await res.json();
        setConversations(Array.isArray(data) ? data : []);
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          router.push('/auth');
          return;
        }
        console.error('Error loading messages overview:', err);
        setError('Could not load your conversations.');
      }
    };
    load();
  }, [router]);

  const formatWhen = (value: string) => {
    const hasOffset = /Z$|[+-]\d{2}:?\d{2}$/.test(value);
    const date = new Date(hasOffset ? value : `${value}Z`);
    return date.toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen px-6 py-12">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-display font-semibold text-slate-100 mb-1">Messages</h1>
        <p className="text-slate-400 text-sm mb-8">
          Every conversation with an agent who has portal access, across all your deals.
        </p>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        {!error && conversations === null && <p className="text-slate-500 text-sm">Loading…</p>}

        {!error && conversations !== null && conversations.length === 0 && (
          <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-8 text-center">
            <p className="text-slate-400 text-sm">
              No conversations yet. Invite an agent to a transaction to start one -- it will show up here.
            </p>
          </div>
        )}

        {!error && conversations !== null && conversations.length > 0 && (
          <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg divide-y divide-slate-600">
            {conversations.map((c) => (
              <Link
                key={c.transactionId}
                href={`/dashboard/transactions/${c.transactionId}/messages`}
                className="flex items-center gap-4 px-5 py-4 hover:bg-slate-700/40 transition first:rounded-t-lg last:rounded-b-lg"
              >
                <div className="w-11 h-11 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-sm font-bold text-white shrink-0">
                  {c.agentName[0]?.toUpperCase() || 'A'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-slate-100 font-semibold truncate">{c.agentName}</p>
                    {c.lastMessage && (
                      <p className="text-xs text-slate-500 shrink-0">{formatWhen(c.lastMessage.createdAt)}</p>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 truncate mb-0.5">{c.propertyAddress || c.fileNumber}</p>
                  {c.lastMessage ? (
                    <p className="text-sm text-slate-400 truncate">
                      {c.lastMessage.senderRole === 'tc' ? 'You: ' : ''}
                      {c.lastMessage.body || (c.lastMessage.attachmentFileName ? `📎 ${c.lastMessage.attachmentFileName}` : '')}
                    </p>
                  ) : (
                    <p className="text-sm text-slate-500 italic">No messages yet -- say hello.</p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
