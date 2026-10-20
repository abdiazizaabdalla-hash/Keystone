'use client';

import DirectMessages from '@/components/DirectMessages';

// General messages with agents. Deal messages are inside each deal and listing messages inside each listing.
export default function MessagesPage() {
  return <DirectMessages self="tc" loginPath="/auth" />;
}
