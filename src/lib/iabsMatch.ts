// Agents on different brokerages use different disclosures (IABS, agency notices). A TC keeps each one named for its
// brokerage ("Acme Realty IABS"); these pick the one that belongs to a deal's agent's brokerage.

export const IABS_RE = /iabs|information about brokerage|agency disclosure|consumer notice/i;

const SUFFIX = /\b(llc|inc|corp|co|ltd|lp|llp)\b/g;
const DISCLOSURE_WORDS = /\b(iabs|information about brokerage services|agency disclosure|consumer notice)\b/g;
const tidy = (v: string) => v.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

/** "Acme Realty, LLC" and "acme realty" are the same brokerage. */
export function brokerageKey(name: string): string {
  return tidy(name.toLowerCase().replace(SUFFIX, ''));
}

/** The disclosures in `forms` that are named for `brokerage`. Empty when the brokerage is unknown or nothing matches. */
export function iabsForBrokerage<T extends { name: string }>(forms: T[], brokerage: string | null | undefined): T[] {
  const want = brokerageKey(brokerage || '');
  if (want.length < 3) return [];
  return forms.filter((f) => {
    if (!IABS_RE.test(f.name)) return false;
    const own = tidy(brokerageKey(f.name).replace(DISCLOSURE_WORDS, ''));
    return own.length >= 3 && (own.includes(want) || want.includes(own));
  });
}
