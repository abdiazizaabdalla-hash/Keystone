// Merge fields for templates: {{client_name}} and friends are filled from the deal when a template is used.

export interface MergeContext {
  client_name?: string;
  client_first_name?: string;
  agent_name?: string;
  agent_first_name?: string;
  my_name?: string;
  my_email?: string;
  tc_name?: string;
  property_address?: string;
  property_state?: string;
  file_number?: string;
  purchase_price?: string;
  closing_date?: string;
  acceptance_date?: string;
  today?: string;
}

export const MERGE_FIELDS: { key: keyof MergeContext; label: string }[] = [
  { key: 'client_name', label: 'Client name' },
  { key: 'client_first_name', label: 'Client first name' },
  { key: 'agent_name', label: 'Agent name' },
  { key: 'agent_first_name', label: 'Agent first name' },
  { key: 'my_name', label: 'Your name' },
  { key: 'my_email', label: 'Your email' },
  { key: 'tc_name', label: 'Coordinator name' },
  { key: 'property_address', label: 'Property address' },
  { key: 'property_state', label: 'State' },
  { key: 'file_number', label: 'File number' },
  { key: 'purchase_price', label: 'Purchase price' },
  { key: 'closing_date', label: 'Closing date' },
  { key: 'acceptance_date', label: 'Acceptance date' },
  { key: 'today', label: 'Today’s date' },
];

const KNOWN = new Set<string>(MERGE_FIELDS.map((f) => f.key));

/**
 * Fills {{fields}} in `text`. A field that is known but has no value for this deal is replaced with nothing and reported in
 * `missing` so the person can see what to fill in; text in braces that is not a merge field is left exactly as typed.
 */
export function renderTemplate(text: string | null | undefined, ctx: MergeContext): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const out = (text ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, raw: string) => {
    const key = raw.toLowerCase();
    if (!KNOWN.has(key)) return whole;
    const value = ctx[key as keyof MergeContext];
    if (value === undefined || value === '') {
      missing.add(key);
      return '';
    }
    return value;
  });
  return { text: out, missing: [...missing] };
}

/** Merge fields used in a piece of text, for showing "this template needs: closing date". */
export function fieldsUsed(text: string | null | undefined): string[] {
  const found = new Set<string>();
  for (const m of (text ?? '').matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) {
    if (KNOWN.has(m[1].toLowerCase())) found.add(m[1].toLowerCase());
  }
  return [...found];
}
