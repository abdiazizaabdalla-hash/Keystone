'use client';

import DirectMessages from '@/components/DirectMessages';

// The agent's general messages with their coordinator(s). Deal messages are inside each deal
// (/agent/transactions/[id]/messages) and listing messages inside each listing.
export default function AgentMessagesPage() {
  return <DirectMessages self="agent" loginPath="/agent/login" />;
}
