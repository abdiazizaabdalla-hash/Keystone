// The terms of an offer as the TC sees and edits them, plus helpers to compare versions.
// Everything is a string so the same shape works for form inputs, the AI's answer and stored version
// snapshots. No imports on purpose: the listing page uses this in the browser.

export const TERM_FIELDS = [
  { key: 'buyerName', label: 'Buyer(s)', kind: 'text' },
  { key: 'buyerAgent', label: "Buyer's agent", kind: 'text' },
  { key: 'offerPrice', label: 'Offer price', kind: 'money' },
  { key: 'financing', label: 'Financing', kind: 'financing' },
  { key: 'earnestMoney', label: 'Earnest money', kind: 'money' },
  { key: 'optionDays', label: 'Option period (days)', kind: 'int' },
  { key: 'closingDate', label: 'Closing date', kind: 'date' },
  { key: 'sellerConcessions', label: 'Seller pays (concessions)', kind: 'money' },
  { key: 'offerExpires', label: 'Offer expires', kind: 'text' },
  { key: 'possession', label: 'Possession', kind: 'text' },
  { key: 'contingencies', label: 'Financing and appraisal contingencies', kind: 'longtext' },
  { key: 'otherTerms', label: 'Other terms, addenda and escalation', kind: 'longtext' },
] as const;

export type TermKey = (typeof TERM_FIELDS)[number]['key'];
export type OfferTerms = Record<TermKey, string>;

export const EMPTY_TERMS: OfferTerms = {
  buyerName: '',
  buyerAgent: '',
  offerPrice: '',
  financing: '',
  earnestMoney: '',
  optionDays: '',
  closingDate: '',
  sellerConcessions: '',
  offerExpires: '',
  possession: '',
  contingencies: '',
  otherTerms: '',
};

export const VERSION_KINDS = ['original', 'counteroffer', 'amendment', 'revised_offer'] as const;
export type VersionKind = (typeof VERSION_KINDS)[number];
export const VERSION_KIND_LABEL: Record<VersionKind, string> = {
  original: 'Original offer',
  counteroffer: 'Counteroffer',
  amendment: 'Amendment',
  revised_offer: 'Revised offer',
};

export const OFFER_DOC_KINDS = ['purchase_contract', 'addendum', 'counteroffer', 'other'] as const;
export type OfferDocKind = (typeof OFFER_DOC_KINDS)[number];
export const OFFER_DOC_KIND_LABEL: Record<OfferDocKind, string> = {
  purchase_contract: 'Purchase contract',
  addendum: 'Addendum',
  counteroffer: 'Counteroffer',
  other: 'Other',
};

const MONEY_KEYS: TermKey[] = ['offerPrice', 'earnestMoney', 'sellerConcessions'];

function clip(v: string, max: number): string {
  return v.replace(/\r/g, '').trim().slice(0, max);
}

/** Turns anything (numbers from the AI, form strings, a stored snapshot) into clean string terms. */
export function normalizeTerms(raw: Record<string, unknown> | null | undefined): OfferTerms {
  const out: OfferTerms = { ...EMPTY_TERMS };
  const r = raw || {};
  for (const f of TERM_FIELDS) {
    const v = r[f.key];
    if (v === null || v === undefined) continue;
    if (MONEY_KEYS.includes(f.key)) {
      const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
      out[f.key] = Number.isFinite(n) && n > 0 ? String(Math.round(n * 100) / 100) : '';
    } else if (f.key === 'optionDays') {
      const n = typeof v === 'number' ? v : Number(String(v).trim());
      out[f.key] = String(v).trim() !== '' && Number.isFinite(n) && n >= 0 && n < 400 ? String(Math.round(n)) : '';
    } else if (f.key === 'closingDate') {
      out[f.key] = /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim()) ? String(v).trim() : '';
    } else if (f.key === 'contingencies') {
      out[f.key] = clip(String(v), 2000);
    } else if (f.key === 'otherTerms') {
      out[f.key] = clip(String(v), 2000);
    } else if (f.key === 'possession') {
      out[f.key] = clip(String(v), 300);
    } else if (f.key === 'offerExpires') {
      out[f.key] = clip(String(v), 80);
    } else {
      out[f.key] = clip(String(v), 200);
    }
  }
  return out;
}

/** The current terms of a stored listing_offers row. */
export function rowToTerms(row: Record<string, unknown>): OfferTerms {
  return normalizeTerms({
    buyerName: row.buyer_name,
    buyerAgent: row.buyer_agent,
    offerPrice: row.offer_price,
    financing: row.financing,
    earnestMoney: row.earnest_money,
    optionDays: row.option_days,
    closingDate: row.closing_date,
    sellerConcessions: row.seller_concessions,
    offerExpires: row.offer_expires_at,
    possession: row.possession,
    contingencies: row.contingencies,
    otherTerms: row.terms,
  });
}

/** Shows a term the way a person reads it ("$450,000", "Closing Nov 8, 2026"). */
export function formatTerm(key: TermKey, value: string): string {
  if (!value) return 'not stated';
  if (MONEY_KEYS.includes(key)) return `$${Number(value).toLocaleString('en-US')}`;
  if (key === 'optionDays') return `${value} day${value === '1' ? '' : 's'}`;
  if (key === 'closingDate') {
    const d = new Date(`${value}T00:00:00Z`);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  return value;
}

export interface TermChange {
  key: TermKey;
  label: string;
  from: string;
  to: string;
}

/** Which terms differ between two versions (comparing normalized values; "not stated" on either side counts). */
export function diffTerms(prev: OfferTerms, next: OfferTerms): TermChange[] {
  const changes: TermChange[] = [];
  for (const f of TERM_FIELDS) {
    const a = (prev[f.key] || '').trim();
    const b = (next[f.key] || '').trim();
    if (a !== b) changes.push({ key: f.key, label: f.label, from: formatTerm(f.key, a), to: formatTerm(f.key, b) });
  }
  return changes;
}

/** The body the existing offer endpoints expect (camelCase, `terms` = other terms). */
export function termsToBody(t: OfferTerms) {
  return {
    buyerName: t.buyerName,
    buyerAgent: t.buyerAgent,
    offerPrice: t.offerPrice,
    financing: t.financing,
    earnestMoney: t.earnestMoney,
    optionDays: t.optionDays,
    closingDate: t.closingDate,
    sellerConcessions: t.sellerConcessions,
    offerExpires: t.offerExpires,
    possession: t.possession,
    contingencies: t.contingencies,
    terms: t.otherTerms,
  };
}
