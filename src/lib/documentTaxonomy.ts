// Document categorization taxonomy for the transaction Documents system.
// Kept deliberately separate from the 6-stage checklist in
// transactionStages.ts — a document can optionally be associated with a
// checklist stage (via its task_id), but the two are independent axes.

export interface DocumentCategory {
  key: string;
  label: string;
  types: string[];
}

export const DOCUMENT_CATEGORIES: DocumentCategory[] = [
  {
    // Deliberately first and the default (see DEFAULT_CATEGORY_KEY below)
    // -- a catch-all for anything the TC doesn't want to categorize right
    // now. Key stays 'other' rather than being renamed to 'general' so
    // documents already stored under the old label keep matching this
    // entry without a data migration; only the label/types shown in the
    // UI changed.
    key: 'other',
    label: 'General',
    types: ['General'],
  },
  {
    key: 'contract_disclosures',
    label: 'Contract & Disclosures',
    types: [
      'Purchase Contract',
      'Buyer Representation Agreement',
      'Listing Agreement',
      'Seller Disclosure',
      'Lead-Based Paint Disclosure',
      'IABS / Agency Documents',
      'Other Contract Documents',
    ],
  },
  {
    key: 'earnest_money_option',
    label: 'Earnest Money & Option',
    types: ['Earnest Money Receipt', 'Option Fee Receipt', 'Deposit Confirmation', 'Other Deposit Documents'],
  },
  {
    key: 'inspection_repairs',
    label: 'Inspection & Repairs',
    types: [
      'Inspection Report',
      'Specialized Inspections',
      'Repair Requests',
      'Repair Amendment',
      'Repair Receipts',
      'Re-Inspection',
    ],
  },
  {
    key: 'title_escrow',
    label: 'Title & Escrow',
    types: ['Title Commitment', 'Survey', 'HOA Documents', 'Title Notices', 'Payoff Information', 'Escrow Documents'],
  },
  {
    key: 'appraisal',
    label: 'Appraisal',
    types: ['Appraisal', 'Appraisal Revisions', 'Appraisal Waiver', 'Other Appraisal Documents'],
  },
  {
    key: 'financing_underwriting',
    label: 'Financing & Underwriting',
    types: [
      'Pre-Approval',
      'Loan Documents',
      'Underwriting Conditions',
      'Insurance',
      'Clear to Close',
      'Other Financing Documents',
    ],
  },
  {
    key: 'amendments_addenda',
    label: 'Amendments & Addenda',
    types: ['Contract Amendment', 'Extension', 'Financing Amendment', 'Closing Date Extension', 'Other Addenda'],
  },
  {
    key: 'closing',
    label: 'Closing',
    types: [
      'Closing Disclosure',
      'Settlement Statement',
      'Closing Instructions',
      'Final Walkthrough',
      'Closing Package',
      'Closing Confirmation',
    ],
  },
  {
    key: 'commission_brokerage',
    label: 'Commission & Brokerage',
    types: [
      'Commission Instructions',
      'Commission Disbursement Authorization',
      'Broker Compliance Forms',
      'Referral Agreement',
      'Other Commission Documents',
    ],
  },
  {
    key: 'post_closing',
    label: 'Post-Closing',
    types: ['Recorded Documents', 'Final File', 'Compliance Documents'],
  },
];

export const DEFAULT_CATEGORY_KEY = 'other';
export const DEFAULT_DOCUMENT_TYPE = 'General';

export function isValidCategory(key: string): boolean {
  return DOCUMENT_CATEGORIES.some((c) => c.key === key);
}

export function isValidDocumentType(categoryKey: string, type: string): boolean {
  const category = DOCUMENT_CATEGORIES.find((c) => c.key === categoryKey);
  return !!category && category.types.includes(type);
}

export function categoryLabel(key: string | null | undefined): string {
  return DOCUMENT_CATEGORIES.find((c) => c.key === key)?.label || 'Uncategorized';
}

export function typesForCategory(key: string): string[] {
  return DOCUMENT_CATEGORIES.find((c) => c.key === key)?.types || [];
}
