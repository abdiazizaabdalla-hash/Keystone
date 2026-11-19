'use client';

import InvitePersonModal from '@/components/InvitePersonModal';

// An agent adds a transaction coordinator to a deal or listing (see InvitePersonModal).
export default function AddCoordinatorModal({ transactionId, listingId, onClose, onInvited }: { transactionId?: string; listingId?: string; onClose: () => void; onInvited: () => void }) {
  return <InvitePersonModal role="tc" transactionId={transactionId} listingId={listingId} onClose={onClose} onInvited={onInvited} />;
}
