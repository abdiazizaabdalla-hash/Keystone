'use client';

import { useEffect, useState } from 'react';
import DirectMessages from '@/components/DirectMessages';
import AgentMessagesPage from '@/components/AgentMessagesPage';
import { readPersona } from '@/lib/persona';

// Messages. A coordinator sees general conversations with their agents; an agent with a workspace sees their
// private conversation with their brokerage. Deal messages are inside each deal and listing messages inside each listing.
export default function MessagesPage() {
  const [mode, setMode] = useState<'unknown' | 'agent' | 'coordinator'>('unknown');
  useEffect(() => {
    const t = setTimeout(() => setMode(readPersona().workspace === true ? 'agent' : 'coordinator'), 0);
    return () => clearTimeout(t);
  }, []);
  if (mode === 'unknown') return null;
  return mode === 'agent' ? <AgentMessagesPage /> : <DirectMessages self="tc" loginPath="/auth" />;
}
