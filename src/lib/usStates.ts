// The 50 states and DC, for filtering templates and tagging deals.

export const US_STATES: { code: string; name: string }[] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'],
  ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'],
  ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'],
  ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'],
  ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'],
  ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'],
  ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'],
  ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
].map(([code, name]) => ({ code, name }));

const CODES = new Set(US_STATES.map((s) => s.code));

export function isStateCode(value: unknown): value is string {
  return typeof value === 'string' && CODES.has(value);
}

/**
 * Best guess at the state from a typed address such as "12 Oak St, Austin, TX 78701" or "..., Austin TX".
 * Returns null when nothing in the address looks like a state; the person can always set it by hand.
 */
export function stateFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const text = address.toUpperCase();
  // "..., TX 78701" or "..., TX" at the end, or "TX 78701" anywhere after a comma/space.
  const patterns = [/[,\s]([A-Z]{2})\s+\d{5}(?:-\d{4})?\s*$/, /,\s*([A-Z]{2})\s*(?:,\s*USA?)?\s*$/, /\s([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m && CODES.has(m[1])) return m[1];
  }
  return null;
}

/** A template with no states listed is for every state. */
export function templateFitsState(templateStates: string[] | null | undefined, dealState: string | null | undefined): boolean {
  if (!templateStates || templateStates.length === 0) return true;
  if (!dealState) return true; // state unknown: do not hide anything
  return templateStates.includes(dealState);
}
