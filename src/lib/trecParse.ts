// Reading TREC's public list of forms. No database in here, so it can be tested on its own.

export const TREC_BASE = 'https://www.trec.texas.gov';
export const TREC_LIST_URL = `${TREC_BASE}/agency-information/contracts`;
export const trecFormUrl = (slug: string) => `${TREC_BASE}/forms/${slug}`;

export type TrecSection = 'contracts' | 'addenda' | 'other';
export interface TrecRow {
  slug: string;
  name: string;
  formId: string;
  section: TrecSection;
  /** YYYY-MM-DD, or null when the page gave none. */
  effectiveDate: string | null;
}

const SECTION_BY_HEADING: Record<string, TrecSection> = { contracts: 'contracts', 'contract addenda': 'addenda', 'other forms': 'other' };
// Anything shorter than this means the page changed shape and the parse cannot be trusted.
export const MIN_SANE_ROWS = 20;

function decode(text: string): string {
  return text
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Reads TREC's contracts page: three groups (Contracts, Contract Addenda, Other Forms), each row a name, form ID and effective date. */
export function parseTrecContractsPage(html: string): TrecRow[] {
  const headings = [...html.matchAll(/view-grouping-header">\s*<div class="panel-title">([^<]+)<\/div>/g)].map((m) => ({ at: m.index ?? 0, section: SECTION_BY_HEADING[decode(m[1]).toLowerCase()] }));
  const rowRe = /<a href="(\/forms\/[A-Za-z0-9_-]+)">([^<]+)<\/a><\/span><\/a><\/div>[\s\S]*?Form ID:<\/div>\s*<div class="field-content">([^<]*)<\/div>[\s\S]*?Effective Date:<\/div>\s*([0-9/]+)/g;
  const rows: TrecRow[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(rowRe)) {
    const at = m.index ?? 0;
    const section = [...headings].reverse().find((h) => h.at < at)?.section;
    const slug = m[1].replace('/forms/', '');
    const formId = decode(m[3]);
    if (!section || !formId || seen.has(slug)) continue;
    seen.add(slug);
    const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(m[4]);
    rows.push({ slug, name: decode(m[2]), formId, section, effectiveDate: d ? `${d[3]}-${d[1]}-${d[2]}` : null });
  }
  return rows;
}

export interface StoredTrec {
  slug: string;
  form_id: string;
  effective_date: string | null;
  removed: boolean;
}

/** What to write after a check: new forms, forms whose number or date changed, and forms no longer listed. */
export function diffCatalog(existing: StoredTrec[], fetched: TrecRow[]) {
  const have = new Map(existing.map((e) => [e.slug, e]));
  const now = new Set(fetched.map((f) => f.slug));
  const added: TrecRow[] = [];
  const changed: Array<{ row: TrecRow; previousFormId: string }> = [];
  const unchanged: TrecRow[] = [];
  for (const row of fetched) {
    const was = have.get(row.slug);
    if (!was) added.push(row);
    else if (was.form_id !== row.formId || (was.effective_date ?? null) !== row.effectiveDate) changed.push({ row, previousFormId: was.form_id });
    else unchanged.push(row);
  }
  const gone = existing.filter((e) => !now.has(e.slug) && !e.removed).map((e) => e.slug);
  return { added, changed, unchanged, gone };
}

