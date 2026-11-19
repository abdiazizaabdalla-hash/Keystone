// Starting points for an agent's invoices. Choosing one fills in the title, the lines, the payment terms and a note;
// every part stays editable. Pure data, so the page and the tests can both use it.

export interface InvoiceTemplateLine {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface InvoiceTemplate {
  key: string;
  name: string;
  /** One line shown under the name when picking. */
  blurb: string;
  title: string;
  lines: InvoiceTemplateLine[];
  /** Days from the issue date until payment is due. */
  dueInDays: number;
  memo: string;
}

const line = (description: string, unitPrice = 0, quantity = 1): InvoiceTemplateLine => ({ description, quantity, unitPrice });

export const INVOICE_TEMPLATES: InvoiceTemplate[] = [
  {
    key: 'blank',
    name: 'Blank invoice',
    blurb: 'Start empty and add your own lines.',
    title: 'Invoice',
    lines: [line('')],
    dueInDays: 14,
    memo: '',
  },
  {
    key: 'referral_fee',
    name: 'Referral fee',
    blurb: 'Fee owed for sending a client to another agent or broker.',
    title: 'Referral fee',
    lines: [line('Referral fee for client referral at closing')],
    dueInDays: 10,
    memo: 'Payable at closing per our referral agreement. Thank you for the business.',
  },
  {
    key: 'commission_split',
    name: 'Commission split',
    blurb: 'Your share of a commission, billed to a co-broker or brokerage.',
    title: 'Commission split',
    lines: [line('Agreed share of commission')],
    dueInDays: 7,
    memo: 'Share of the commission on the closed transaction, as agreed.',
  },
  {
    key: 'buyer_agent_fee',
    name: 'Buyer representation fee',
    blurb: 'Fee for representing a buyer when it is not paid out of the sale.',
    title: 'Buyer representation fee',
    lines: [line('Buyer representation services')],
    dueInDays: 7,
    memo: 'Due at or before closing.',
  },
  {
    key: 'consulting',
    name: 'Consultation or showing time',
    blurb: 'Hourly time for consulting, showings or property tours.',
    title: 'Consultation services',
    lines: [line('Consultation / showing time (hours)', 0, 1)],
    dueInDays: 14,
    memo: '',
  },
  {
    key: 'coordination_fee',
    name: 'Transaction coordination fee',
    blurb: 'Coordination services you provide to another agent.',
    title: 'Transaction coordination',
    lines: [line('Transaction coordination, start to close')],
    dueInDays: 7,
    memo: 'Thank you for trusting me with your transaction.',
  },
  {
    key: 'marketing',
    name: 'Marketing and listing prep',
    blurb: 'Photos, staging, signage, flyers, ads you front for a client.',
    title: 'Marketing and listing preparation',
    lines: [line('Professional photography'), line('Staging'), line('Signage and print materials')],
    dueInDays: 14,
    memo: 'Costs advanced for the listing. Receipts available on request.',
  },
  {
    key: 'reimbursement',
    name: 'Expense reimbursement',
    blurb: 'Costs you paid for a client or another agent and want back.',
    title: 'Expense reimbursement',
    lines: [line('Reimbursement: ')],
    dueInDays: 14,
    memo: 'Receipts are attached or available on request.',
  },
  {
    key: 'admin_fee',
    name: 'Administrative or processing fee',
    blurb: 'Paperwork, filing and processing charges.',
    title: 'Administrative fee',
    lines: [line('Administrative and processing fee')],
    dueInDays: 7,
    memo: '',
  },
  {
    key: 'bonus',
    name: 'Bonus or incentive',
    blurb: 'A bonus owed to you under an agreement.',
    title: 'Bonus',
    lines: [line('Bonus per agreement')],
    dueInDays: 14,
    memo: '',
  },
  {
    key: 'rental',
    name: 'Rental or leasing fee',
    blurb: 'Fee for placing a tenant or finding a rental.',
    title: 'Leasing fee',
    lines: [line('Tenant placement / leasing fee')],
    dueInDays: 10,
    memo: 'Due on lease signing.',
  },
];

export function getInvoiceTemplate(key: string | null | undefined): InvoiceTemplate {
  return INVOICE_TEMPLATES.find((t) => t.key === key) ?? INVOICE_TEMPLATES[0];
}
