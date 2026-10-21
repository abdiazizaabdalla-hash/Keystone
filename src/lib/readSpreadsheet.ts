import JSZip from 'jszip';
import { parseCsv } from './csvImport';

// Reads an uploaded .csv or .xlsx into rows of text, in the browser. QuickBooks exports Excel files, so
// this opens the .xlsx (a zip of XML files) directly instead of asking the TC to re-save as CSV.
// Only the first sheet is read; formulas come through as their last computed value.

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5000;

function colIndex(ref: string): number {
  const letters = (ref.match(/^[A-Z]+/i) || ['A'])[0].toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}

const textOf = (el: Element | null | undefined) => (el ? Array.from(el.getElementsByTagName('t')).map((t) => t.textContent || '').join('') : '');

async function readXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const zip = await JSZip.loadAsync(buffer);

  // Which file is the first sheet? workbook.xml names it by relationship id; the .rels file says where it lives.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  try {
    const wb = parseXml(await zip.file('xl/workbook.xml')!.async('string'));
    const rels = parseXml(await zip.file('xl/_rels/workbook.xml.rels')!.async('string'));
    const first = wb.getElementsByTagName('sheet')[0];
    const rid = first?.getAttribute('r:id') || first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const rel = Array.from(rels.getElementsByTagName('Relationship')).find((r) => r.getAttribute('Id') === rid);
    const target = rel?.getAttribute('Target');
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  } catch {
    // fall back to sheet1.xml
  }
  const sheetFile = zip.file(sheetPath);
  if (!sheetFile) throw new Error('Could not find a sheet in that Excel file');

  const shared: string[] = [];
  const sst = zip.file('xl/sharedStrings.xml');
  if (sst) {
    const doc = parseXml(await sst.async('string'));
    for (const si of Array.from(doc.getElementsByTagName('si'))) shared.push(textOf(si));
  }

  const sheet = parseXml(await sheetFile.async('string'));
  const out: string[][] = [];
  for (const rowEl of Array.from(sheet.getElementsByTagName('row'))) {
    if (out.length >= MAX_ROWS) break;
    const r: string[] = [];
    for (const c of Array.from(rowEl.getElementsByTagName('c'))) {
      const idx = colIndex(c.getAttribute('r') || 'A1');
      const type = c.getAttribute('t');
      let value = '';
      if (type === 'inlineStr') value = textOf(c.getElementsByTagName('is')[0]);
      else {
        const v = c.getElementsByTagName('v')[0]?.textContent || '';
        value = type === 's' ? shared[Number(v)] ?? '' : v;
      }
      while (r.length < idx) r.push('');
      r[idx] = value;
    }
    // Rows are numbered; keep blank ones out but preserve order.
    if (r.some((x) => x.trim() !== '')) out.push(r);
  }
  return out;
}

export async function readSpreadsheetFile(file: File): Promise<string[][]> {
  if (file.size > MAX_BYTES) throw new Error('That file is too big (5 MB max). Export a shorter date range.');
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) return readXlsx(await file.arrayBuffer());
  if (name.endsWith('.xls')) throw new Error('Older .xls files are not supported. In Excel choose Save As, then CSV or Excel Workbook (.xlsx).');
  const rows = parseCsv(await file.text());
  return rows.slice(0, MAX_ROWS);
}
