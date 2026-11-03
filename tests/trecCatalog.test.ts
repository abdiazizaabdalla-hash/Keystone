import { describe, expect, it } from 'vitest';
import { diffCatalog, parseTrecContractsPage, trecFormUrl } from '@/lib/trecParse';

// A small page shaped like TREC's contracts listing: three groups, each row a name link, a form ID and an effective date.
const row = (slug: string, name: string, id: string, date: string) => `
<!-- BEGIN OUTPUT from 'sites/all/themes/trec/templates/pdf-forms/views-view-fields--contracts.tpl.php' -->
<div class="responsive-field col-md-8">
  <div class="responsive-label">Form Name:</div>
  <a href="/" target="_blank"><span class="field-content"><a href="/forms/${slug}">${name}</a></span></a></div>
<div class="responsive-field col-md-2">
  <div class="responsive-label">Form ID:</div>
  <div class="field-content">${id}</div></div>
<div class="responsive-field col-md-2">
  <div class="responsive-label">Effective Date:</div>
  ${date}</div>
<!-- END OUTPUT -->`;
const group = (title: string) => `<dl class="view-grouping"><dt class="view-grouping-header">   <div class="panel-title">${title}</div> </dt><dd>`;
const PAGE = [
  group('Contracts'),
  row('one-four-family-residential-contract-resale', 'One to Four Family Residential Contract (Resale)', '20-19', '07/01/2026'),
  row('sellers-disclosure-notice', 'Seller&#039;s Disclosure Notice', '55-1', '05/28/2026'),
  '</dd></dl>',
  group('Contract Addenda'),
  row('seller-financing-addendum', 'Seller Financing Addendum', '26-8', '02/01/2023'),
  '</dd></dl>',
  group('Other Forms'),
  row('inspection-report-form', 'Property Inspection Report', 'REI 7-6', '02/01/2022'),
].join('\n');

describe('reading the TREC list', () => {
  const rows = parseTrecContractsPage(PAGE);

  it('finds every form with its group, number and date', () => {
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({ slug: 'one-four-family-residential-contract-resale', name: 'One to Four Family Residential Contract (Resale)', formId: '20-19', section: 'contracts', effectiveDate: '2026-07-01' });
    expect(rows[2].section).toBe('addenda');
    expect(rows[3]).toMatchObject({ section: 'other', formId: 'REI 7-6', effectiveDate: '2022-02-01' });
  });

  it('turns HTML entities into plain text', () => {
    expect(rows[1].name).toBe("Seller's Disclosure Notice");
  });

  it('returns nothing from a page that is not the list', () => {
    expect(parseTrecContractsPage('<html><body>Maintenance</body></html>')).toEqual([]);
  });

  it('links to TREC’s own page for the form', () => {
    expect(trecFormUrl('amendment')).toBe('https://www.trec.texas.gov/forms/amendment');
  });
});

describe('noticing a revised form', () => {
  const rows = parseTrecContractsPage(PAGE);
  const stored = [
    { slug: 'one-four-family-residential-contract-resale', form_id: '20-18', effective_date: '2025-01-03', removed: false },
    { slug: 'sellers-disclosure-notice', form_id: '55-1', effective_date: '2026-05-28', removed: false },
    { slug: 'retired-form', form_id: '1-1', effective_date: null, removed: false },
  ];
  const diff = diffCatalog(stored, rows);

  it('flags the contract that went from 20-18 to 20-19', () => {
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].previousFormId).toBe('20-18');
    expect(diff.changed[0].row.formId).toBe('20-19');
  });
  it('sees new, unchanged and no-longer-listed forms', () => {
    expect(diff.added.map((r) => r.slug).sort()).toEqual(['inspection-report-form', 'seller-financing-addendum']);
    expect(diff.unchanged.map((r) => r.slug)).toEqual(['sellers-disclosure-notice']);
    expect(diff.gone).toEqual(['retired-form']);
  });
});
