'use client';

import { useEffect, useState } from 'react';
import DirectMessages from '@/components/DirectMessages';
import AgentMessagesPage from '@/components/AgentMessagesPage';
import { readPersona } from '@/lib/persona';
import { useBrokerageOwner } from '@/lib/useBrokerageOwner';

// Messages. A coordinator sees general conversations with their agents. An agent with a workspace and a brokerage owner both see the
// brokerage's Messages (the team board and private conversations), the same screen as Collaborate → Messages. Deal messages are
// inside each deal and listing messages inside each listing.
export default function MessagesPage() {
  const [workspace, setWorkspace] = useState<boolean | null>(null);
  const brokerOwner = useBrokerageOwner();
  useEffect(() => {
    const t = setTimeout(() => setWorkspace(readPersona().workspace === true), 0);
    return () => clearTimeout(t);
  }, []);
  if (workspace === null || (!workspace && brokerOwner === null)) return null;
  return workspace || brokerOwner ? <AgentMessagesPage /> : <DirectMessages self="tc" loginPath="/auth" />;
}
