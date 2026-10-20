// Broad groups for the Contacts tag list. A person's role stays as specific as the deal needs it
// ("Seller's preferred inspector", "Title contact (escrow officer)"), but the tag they get is the
// category, so the tag list stays short: Agent, Seller, Title, Lender, Inspector...
// No imports on purpose: the Contacts page uses this in the browser.

export const CONTACT_CATEGORIES = ['Agent', 'Broker', 'Seller', 'Buyer', 'Title', 'Lender', 'Inspector', 'Appraiser', 'Attorney', 'HOA', 'Insurance', 'Vendor', 'Other'] as const;
export type ContactCategory = (typeof CONTACT_CATEGORIES)[number];

// Checked top to bottom, so "seller's preferred inspector" is an Inspector, not a Seller, and
// "mortgage broker" is a Lender, not a Broker.
const RULES: [ContactCategory, RegExp][] = [
  ['Inspector', /inspect/],
  ['Appraiser', /apprais/],
  ['Lender', /lender|mortgage|loan|underwrit/],
  ['Title', /\btitle\b|escrow|closer|closing/],
  ['Attorney', /attorney|lawyer|\blegal\b/],
  ['HOA', /\bhoa\b|homeowner|community manag|property manag|association|condo/],
  ['Insurance', /insur|warrant/],
  ['Agent', /\bagent|realtor|salesperson|sales associate/],
  ['Broker', /broker/],
  ['Seller', /seller|owner|landlord/],
  ['Buyer', /buyer|purchaser|tenant/],
  ['Vendor', /photograph|stager|staging|clean|contractor|handyman|repair|survey|pest|termite|plumb|hvac|roof|mover|moving|landscap|painter|vendor|electric/],
];

/** The broad category for a free-text role, or 'Other' when nothing fits. Empty role gives null. */
export function categoryForRole(role: string | null | undefined): ContactCategory | null {
  const r = (role || '').trim().toLowerCase();
  if (!r) return null;
  for (const [category, re] of RULES) if (re.test(r)) return category;
  return 'Other';
}

/**
 * Tidies one contact's tags: a tag that is just the contact's own role (what Relay used to save,
 * lowercased and cut to 30 characters) becomes the category. Anything the user typed themselves
 * ("past client", "Austin") is left alone. If the contact has a role but no category tag yet, the
 * category is added. Returns the same array when nothing changes.
 */
export function tidyTags(role: string | null | undefined, tags: string[]): string[] {
  const category = categoryForRole(role);
  if (!category) return tags;
  const roleTag = (role || '').trim().replace(/\s+/g, ' ').slice(0, 30).toLowerCase();
  const categoryKeys = new Set(CONTACT_CATEGORIES.map((c) => c.toLowerCase()));
  const out: string[] = [];
  const seen = new Set<string>();
  let changed = false;
  for (const t of tags) {
    const key = t.toLowerCase();
    const next = key === roleTag && !categoryKeys.has(key) ? category : t;
    if (next !== t) changed = true;
    if (seen.has(next.toLowerCase())) {
      changed = true;
      continue;
    }
    seen.add(next.toLowerCase());
    out.push(next);
  }
  if (!out.some((t) => categoryKeys.has(t.toLowerCase()))) {
    out.push(category);
    changed = true;
  }
  return changed ? out : tags;
}
