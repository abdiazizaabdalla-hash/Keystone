import PDFDocument from 'pdfkit';
import { formatDisplayDate } from './dueDates';

// Full audit-trail export for a transaction -- a brokerage compliance
// review or E&O dispute needs the whole paper trail (documents,
// communication, checklist) as it stood at one point in time, not a
// live app view that could keep changing after the fact. Deliberately
// reuses pdfkit (already a dependency, see invoicePdf.ts) rather than
// pulling in a second PDF library for one more document type.
//
// Note on completeness: tasks only carry a `completed` boolean, not a
// completed-at timestamp (see database-schema.sql) -- so this is a
// snapshot of checklist status as of the export, not a timestamped
// history of when each item was checked off. Documents and messages DO
// carry real created_at timestamps and are reported as such.

export interface ComplianceTransactionInfo {
  file_number: string;
  property_address: string;
  purchase_price: number;
  status: string;
  acceptance_date: string | null;
  closing_date: string | null;
  created_at: string;
}

export interface ComplianceAgentInfo {
  name: string;
  brokerage: string | null;
}

export interface ComplianceDocumentRow {
  file_name: string;
  category: string | null;
  document_type: string | null;
  is_signed: boolean;
  requires_signature: boolean;
  created_at: string;
}

export interface ComplianceMessageRow {
  sender_role: string;
  body: string;
  created_at: string;
}

export interface ComplianceTaskRow {
  name: string;
  completed: boolean;
  due_date: string | null;
}

export interface ComplianceExportInput {
  transaction: ComplianceTransactionInfo;
  agent: ComplianceAgentInfo;
  documents: ComplianceDocumentRow[];
  messages: ComplianceMessageRow[];
  tasks: ComplianceTaskRow[];
  generatedByName: string;
  generatedByEmail: string | null;
}

const PAGE_MARGIN = 56;

export function generateComplianceExportPdf(input: ComplianceExportInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', margin: PAGE_MARGIN });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const { transaction, agent, documents, messages, tasks, generatedByName, generatedByEmail } = input;
      const money = (n: number) =>
        `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const generatedAt = new Date();

      const pageWidth = doc.page.width - PAGE_MARGIN * 2;

      const ensureSpace = (height: number) => {
        if (doc.y + height > doc.page.height - PAGE_MARGIN) {
          doc.addPage();
        }
      };

      const sectionHeading = (text: string) => {
        ensureSpace(40);
        doc.moveDown(0.75);
        doc
          .fillColor('#08080b')
          .font('Helvetica-Bold')
          .fontSize(14)
          .text(text, { width: pageWidth });
        doc
          .moveTo(PAGE_MARGIN, doc.y + 4)
          .lineTo(PAGE_MARGIN + pageWidth, doc.y + 4)
          .strokeColor('#cccccc')
          .lineWidth(1)
          .stroke();
        doc.moveDown(0.75);
      };

      // Header
      doc
        .fillColor('#08080b')
        .font('Helvetica-Bold')
        .fontSize(20)
        .text('Transaction Compliance Export', { width: pageWidth });
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#555555')
        .text(
          `Generated ${generatedAt.toLocaleString()} by ${generatedByName}${generatedByEmail ? ` (${generatedByEmail})` : ''}`,
          { width: pageWidth }
        );
      doc.moveDown(1);

      // Transaction summary
      sectionHeading('Transaction Summary');
      const summaryRows: [string, string][] = [
        ['File Number', transaction.file_number],
        ['Property Address', transaction.property_address || '—'],
        ['Agent', `${agent.name}${agent.brokerage ? ` (${agent.brokerage})` : ''}`],
        ['Purchase Price', money(transaction.purchase_price)],
        ['Status', transaction.status],
        ['Acceptance Date', transaction.acceptance_date ? formatDisplayDate(transaction.acceptance_date) : '—'],
        ['Target Closing Date', transaction.closing_date ? formatDisplayDate(transaction.closing_date) : '—'],
        ['Created', new Date(transaction.created_at).toLocaleString()],
      ];
      summaryRows.forEach(([label, value]) => {
        ensureSpace(18);
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#333333').text(`${label}: `, { continued: true, width: pageWidth });
        doc.font('Helvetica').fillColor('#08080b').text(value);
      });

      // Documents
      sectionHeading(`Documents (${documents.length})`);
      if (documents.length === 0) {
        doc.font('Helvetica').fontSize(10).fillColor('#555555').text('No documents on file.');
      } else {
        documents
          .slice()
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
          .forEach((d) => {
            ensureSpace(28);
            doc.font('Helvetica-Bold').fontSize(10).fillColor('#08080b').text(d.file_name, { width: pageWidth });
            const signedLabel = d.requires_signature ? (d.is_signed ? 'Signed' : 'Not yet signed') : null;
            const metaParts = [
              d.document_type || d.category || null,
              signedLabel,
              `uploaded ${new Date(d.created_at).toLocaleString()}`,
            ].filter(Boolean);
            doc.font('Helvetica').fontSize(9).fillColor('#555555').text(metaParts.join(' · '), { width: pageWidth });
            doc.moveDown(0.4);
          });
      }

      // Checklist (snapshot -- see note above about no per-item timestamp)
      sectionHeading(`Checklist (${tasks.filter((t) => t.completed).length}/${tasks.length} complete, as of export)`);
      if (tasks.length === 0) {
        doc.font('Helvetica').fontSize(10).fillColor('#555555').text('No checklist items.');
      } else {
        tasks.forEach((t) => {
          ensureSpace(16);
          const mark = t.completed ? '[x]' : '[ ]';
          const dueLabel = t.due_date ? ` — due ${formatDisplayDate(t.due_date)}` : '';
          doc
            .font('Helvetica')
            .fontSize(10)
            .fillColor(t.completed ? '#555555' : '#08080b')
            .text(`${mark} ${t.name}${dueLabel}`, { width: pageWidth });
        });
      }

      // Messages
      sectionHeading(`Communication (${messages.length} message${messages.length === 1 ? '' : 's'})`);
      if (messages.length === 0) {
        doc.font('Helvetica').fontSize(10).fillColor('#555555').text('No messages on record.');
      } else {
        messages
          .slice()
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
          .forEach((m) => {
            ensureSpace(32);
            const who = m.sender_role === 'agent' ? 'Agent' : m.sender_role === 'tc' ? 'TC' : m.sender_role;
            doc
              .font('Helvetica-Bold')
              .fontSize(9)
              .fillColor('#333333')
              .text(`${who} — ${new Date(m.created_at).toLocaleString()}`, { width: pageWidth });
            doc.font('Helvetica').fontSize(10).fillColor('#08080b').text(m.body, { width: pageWidth });
            doc.moveDown(0.4);
          });
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
