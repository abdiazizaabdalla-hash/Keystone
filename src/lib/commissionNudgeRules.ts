// The rules for gentle follow-ups between an agent and their brokerage around closing and getting paid. Pure (no database) so they
// can be tested on their own; commissionNudges.ts runs them daily and writes the bell notifications. The same nudge is never
// repeated sooner than its `repeatDays`.

export interface NudgeDeal {
  id: string;
  address: string | null;
  status: string | null;
  closingDate: string | null;
  updatedAt: string | null;
  agentId: string;
}
export interface NudgeCommission {
  id: string;
  transactionId: string;
  statementNumber: string;
  status: string;
  changeNote: string | null;
  ownerId: string;
  agentId: string;
  proposedAt: string;
  acceptedAt: string | null;
}
export interface Nudge {
  recipientId: string;
  transactionId: string;
  title: string;
  /** Also the de-duplication key: the same recipient and link are not nudged again within `repeatDays`. */
  link: string;
  repeatDays: number;
}

export const APPROVAL_WAIT_DAYS = 2;
export const CLOSED_NO_INVOICE_DAYS = 2;
export const UNPAID_AFTER_APPROVAL_DAYS = 7;

const day = (iso: string) => iso.slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${day(to)}T00:00:00Z`) - Date.parse(`${day(from)}T00:00:00Z`)) / 86_400_000);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function commissionNudges(input: { deals: NudgeDeal[]; commissions: NudgeCommission[]; ownerOf: (agentId: string) => string | null; today: string }): Nudge[] {
  const { deals, commissions, ownerOf, today } = input;
  const byDeal = new Map(commissions.filter((c) => c.status !== 'void').map((c) => [c.transactionId, c]));
  const dealById = new Map(deals.map((d) => [d.id, d]));
  const out: Nudge[] = [];
  const at = (id: string) => ` · ${dealById.get(id)?.address ?? 'a deal'}`;
  // Owners oversee a deal from Collaborate. The tag keeps each nudge's link distinct.
  const ownerLink = (id: string, tag: string) => `/dashboard/collaborate/deals/${id}#n-${tag}`;

  // An invoice the agent generated that the brokerage has not answered.
  for (const c of byDeal.values()) {
    const owner = ownerOf(c.agentId);
    if (c.status === 'change_requested' && !c.changeNote && owner === c.ownerId) {
      const waited = daysBetween(c.proposedAt, today);
      if (waited >= APPROVAL_WAIT_DAYS) out.push({ recipientId: c.ownerId, transactionId: c.transactionId, title: `${c.statementNumber} has waited ${plural(waited, 'day')} for your approval${at(c.transactionId)}`, link: ownerLink(c.transactionId, `approve-${c.id}`), repeatDays: 3 });
    }
    // Approved and the deal has closed, but nobody has recorded the payment.
    if (c.status === 'accepted' && c.acceptedAt && owner === c.ownerId && dealById.get(c.transactionId)?.status === 'Closed') {
      const waited = daysBetween(c.acceptedAt, today);
      if (waited >= UNPAID_AFTER_APPROVAL_DAYS) out.push({ recipientId: c.ownerId, transactionId: c.transactionId, title: `${c.statementNumber} was approved ${plural(waited, 'day')} ago and is not marked paid${at(c.transactionId)}`, link: ownerLink(c.transactionId, `pay-${c.id}`), repeatDays: 7 });
    }
  }

  // Closing: the brokerage owner is the one who confirms the real commission, from the closing documents. The agent is not asked to
  // invoice anyone; they only see the estimate and, later, the confirmed statement.
  for (const d of deals) {
    const owner = ownerOf(d.agentId);
    if (!owner) continue;
    const c = byDeal.get(d.id);
    const estimateOnly = c?.status === 'estimate';
    if (c && !estimateOnly) continue;
    if (d.status === 'Closed') {
      const closedOn = d.closingDate && d.closingDate <= today ? d.closingDate : d.updatedAt ? day(d.updatedAt) : null;
      if (closedOn && daysBetween(closedOn, today) >= CLOSED_NO_INVOICE_DAYS) {
        out.push(estimateOnly
          ? { recipientId: owner, transactionId: d.id, title: `This deal closed. Confirm the actual commission from the closing documents${at(d.id)}`, link: ownerLink(d.id, 'confirm-commission'), repeatDays: 7 }
          : { recipientId: owner, transactionId: d.id, title: `This deal closed and has no commission statement. Set the agent’s commission terms to create one${at(d.id)}`, link: ownerLink(d.id, 'closed-no-statement'), repeatDays: 7 });
      }
    }
  }
  return out;
}
