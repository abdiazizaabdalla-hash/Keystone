import PDFDocument from 'pdfkit';

// The brokerage owner's compliance snapshot: where every agent stands and what stage each of their files is in, as a CSV or a PDF.
// Built from the same read-only numbers the owner already sees in Collaborate (stage, checklist progress, late steps, missing required
// documents, file review). It never includes client details, messages or document names.

export interface ReportRow {
  agent: string;
  kind: 'Deal' | 'Listing';
  property: string;
  fileNumber: string;
  stage: string;
  price: number | null;
  acceptance: string;
  closing: string;
  stepsDone: number;
  stepsTotal: number;
  lateSteps: number;
  nextStep: string;
  nextDue: string;
  missingDocs: string[];
  review: string;
  flags: string[];
  updated: string;
}

export interface ReportAgent {
  name: string;
  email: string;
  openDeals: number;
  openListings: number;
  closedThisYear: number;
  lateSteps: number;
  filesMissingDocs: number;
  lastActivity: string;
}

export interface ReportMeta {
  brokerage: string;
  generatedOn: string;
  requiredDocs: string[];
}

const csvCell = (value: unknown): string => {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const FLAG_TEXT: Record<string, string> = { overdue: 'Late steps', closing_soon: 'Closing soon', no_closing_date: 'No closing date', expiring_soon: 'Listing expiring' };
export const flagText = (flags: string[]) => flags.map((f) => FLAG_TEXT[f] ?? f).join('; ');

const money = (n: number | null) => (n === null ? '' : n.toFixed(2));

export function reportCsv(meta: ReportMeta, agents: ReportAgent[], rows: ReportRow[]): string {
  const lines: string[] = [];
  const add = (cells: unknown[]) => lines.push(cells.map(csvCell).join(','));
  add([`${meta.brokerage} compliance snapshot`, `Generated ${meta.generatedOn}`]);
  add([meta.requiredDocs.length ? `Required documents: ${meta.requiredDocs.join('; ')}` : 'No required documents set']);
  lines.push('');
  add(['Agent summary']);
  add(['Agent', 'Email', 'Open deals', 'Open listings', 'Closed this year', 'Late steps', 'Files missing required documents', 'Last activity']);
  for (const a of agents) add([a.name, a.email, a.openDeals, a.openListings, a.closedThisYear, a.lateSteps, a.filesMissingDocs, a.lastActivity]);
  lines.push('');
  add(['Files']);
  add(['Agent', 'Type', 'Property', 'File number', 'Stage', 'Price', 'Accepted', 'Closing', 'Steps done', 'Steps total', 'Late steps', 'Next step', 'Next step due', 'Missing required documents', 'File review', 'Attention', 'Last updated']);
  for (const r of rows) add([r.agent, r.kind, r.property, r.fileNumber, r.stage, money(r.price), r.acceptance, r.closing, r.stepsDone, r.stepsTotal, r.lateSteps, r.nextStep, r.nextDue, r.missingDocs.join('; '), r.review, flagText(r.flags), r.updated]);
  return `﻿${lines.join('\r\n')}\r\n`;
}

const usd = (n: number | null) => (n === null ? '—' : `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`);

export function generateComplianceReportPdf(meta: ReportMeta, agents: ReportAgent[], rows: ReportRow[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = 40;
      const width = doc.page.width - 80;
      const bottom = () => doc.page.height - 50;
      let y = 40;
      const ensure = (h: number) => {
        if (y + h > bottom()) {
          doc.addPage();
          y = 40;
        }
      };

      doc.fillColor('#08080b').font('Helvetica-Bold').fontSize(20).text(`${meta.brokerage}`, left, y, { width });
      y = doc.y + 2;
      doc.font('Helvetica').fontSize(11).fillColor('#555555').text(`Compliance snapshot · ${meta.generatedOn}`, left, y, { width });
      y = doc.y + 2;
      doc.fontSize(9).fillColor('#777777').text(meta.requiredDocs.length ? `Required on every file: ${meta.requiredDocs.join(', ')}` : 'No required documents are set for this brokerage.', left, y, { width });
      y = doc.y + 14;

      // Table helper: columns are { title, w, get }, drawn with a header row and zebra lines.
      type Col<T> = { title: string; w: number; get: (item: T) => string; align?: 'left' | 'right' };
      const table = <T,>(cols: Col<T>[], items: T[], rowH = 18) => {
        const total = cols.reduce((n, c) => n + c.w, 0);
        const scale = width / total;
        const header = () => {
          ensure(rowH + 6);
          doc.rect(left, y, width, rowH).fill('#f1f1f4');
          let x = left;
          doc.fillColor('#555555').font('Helvetica-Bold').fontSize(8);
          for (const c of cols) {
            doc.text(c.title, x + 4, y + 5, { width: c.w * scale - 8, align: c.align ?? 'left', lineBreak: false, ellipsis: true });
            x += c.w * scale;
          }
          y += rowH;
        };
        header();
        for (const item of items) {
          // A row grows to fit its longest cell (e.g. a list of missing documents).
          doc.font('Helvetica').fontSize(8.5);
          const heights = cols.map((c) => doc.heightOfString(c.get(item) || ' ', { width: c.w * scale - 8 }));
          const h = Math.max(rowH, Math.max(...heights) + 8);
          if (y + h > bottom()) {
            doc.addPage();
            y = 40;
            header();
          }
          let x = left;
          doc.fillColor('#08080b');
          for (const c of cols) {
            doc.text(c.get(item) || '', x + 4, y + 4, { width: c.w * scale - 8, align: c.align ?? 'left' });
            x += c.w * scale;
          }
          y += h;
          doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.5).strokeColor('#e3e3e8').stroke();
        }
      };

      const heading = (text: string) => {
        ensure(40);
        doc.fillColor('#08080b').font('Helvetica-Bold').fontSize(12).text(text, left, y, { width });
        y = doc.y + 6;
      };

      heading('Where each agent stands');
      if (agents.length === 0) {
        doc.font('Helvetica').fontSize(10).fillColor('#555555').text('No agents have joined yet.', left, y);
        y = doc.y + 10;
      } else {
        table<ReportAgent>(
          [
            { title: 'Agent', w: 150, get: (a) => a.name },
            { title: 'Open deals', w: 60, get: (a) => String(a.openDeals), align: 'right' },
            { title: 'Open listings', w: 70, get: (a) => String(a.openListings), align: 'right' },
            { title: 'Closed this year', w: 80, get: (a) => String(a.closedThisYear), align: 'right' },
            { title: 'Late steps', w: 60, get: (a) => String(a.lateSteps), align: 'right' },
            { title: 'Files missing documents', w: 110, get: (a) => String(a.filesMissingDocs), align: 'right' },
            { title: 'Last activity', w: 90, get: (a) => a.lastActivity },
          ],
          agents
        );
        y += 14;
      }

      const names = [...new Set(rows.map((r) => r.agent))];
      for (const name of names) {
        const mine = rows.filter((r) => r.agent === name);
        heading(`${name} · ${mine.length} file${mine.length === 1 ? '' : 's'}`);
        table<ReportRow>(
          [
            { title: 'Property', w: 160, get: (r) => `${r.property || '—'}${r.fileNumber ? ` (${r.fileNumber})` : ''}` },
            { title: 'Type', w: 42, get: (r) => r.kind },
            { title: 'Stage', w: 100, get: (r) => r.stage },
            { title: 'Price', w: 62, get: (r) => usd(r.price), align: 'right' },
            { title: 'Closing', w: 62, get: (r) => r.closing || '—' },
            { title: 'Steps', w: 48, get: (r) => (r.stepsTotal ? `${r.stepsDone}/${r.stepsTotal}` : '—'), align: 'right' },
            { title: 'Late', w: 34, get: (r) => String(r.lateSteps), align: 'right' },
            { title: 'Next step', w: 110, get: (r) => (r.nextStep ? `${r.nextStep}${r.nextDue ? ` (${r.nextDue})` : ''}` : '') },
            { title: 'Missing documents', w: 120, get: (r) => r.missingDocs.join(', ') },
            { title: 'Review', w: 52, get: (r) => r.review },
          ],
          mine
        );
        y += 14;
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
