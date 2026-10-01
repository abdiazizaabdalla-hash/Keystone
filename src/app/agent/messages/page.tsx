'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { useRouter } from 'next/navigation';

interface ConversationRow {
  transactionId: string;
  fileNumber: string;
  propertyAddress: string | null;
  tcLabel: string;
  lastMessage: {
    senderRole: 'tc' | 'agent';
    body: string;
    createdAt: string;
    attachmentFileName: string | null;
  } | null;
}

// Agent-side mirror of dashboard/messages/page.tsx -- every transaction
// this agent has been added to, with a preview of its latest message,
// newest activity first. What the new Messages tab in the agent side
// nav (agent/layout.tsx) opens into. See
// src/app/api/agent/messages/overview/route.ts.
export default function AgentMessagesOverviewPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await authFetch('/api/agent/messages/overview');
        if (!res.ok) throw new Error('Failed to load messages');
        const data = await res.json();
        setConversations(Array.isArray(data) ? data : []);
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          router.push('/agent/login');
          return;
        }
        console.error('Error loading agent messages overview:', err);
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
        <p className="text-slate-400 text-sm mb-8">Every conversation with a TC, across all your deals.</p>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        {!error && conversations === null && <p className="text-slate-500 text-sm">Loading…</p>}

        {!error && conversations !== null && conversations.length === 0 && (
          <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-8 text-center">
            <p className="text-slate-400 text-sm">No conversations yet.</p>
          </div>
        )}

        {!error && conversations !== null && conversations.length > 0 && (
          <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg divide-y divide-slate-600">
            {conversations.map((c) => (
              <Link
                key={c.transactionId}
                href={`/agent/transactions/${c.transactionId}/messages`}
                className="flex items-center gap-4 px-5 py-4 hover:bg-slate-700/40 transition first:rounded-t-lg last:rounded-b-lg"
              >
                <div className="w-11 h-11 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-sm font-bold text-white shrink-0">
                  {c.tcLabel[0]?.toUpperCase() || 'T'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-slate-100 font-semibold truncate">{c.tcLabel}</p>
                    {c.lastMessage && (
                      <p className="text-xs text-slate-500 shrink-0">{formatWhen(c.lastMessage.createdAt)}</p>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 truncate mb-0.5">{c.propertyAddress || c.fileNumber}</p>
                  {c.lastMessage ? (
                    <p className="text-sm text-slate-400 truncate">
                      {c.lastMessage.senderRole === 'agent' ? 'You: ' : ''}
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
