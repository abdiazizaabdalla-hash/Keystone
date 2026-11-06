import { randomUUID } from 'node:crypto';
import { AuthError } from './auth';
import { supabaseServer } from './supabase';
import { generateLetterPdf } from './templatePdf';
import { TEMPLATE_BUCKET } from './templatesServer';
import { resolveDocumentPlacement } from './documentTaxonomy';

// What a template does on a deal once it is approved: a letter becomes a PDF in Documents, a form is copied into
// Documents. (Emails go through sendDealEmail.) Shared by "use a template" and by approving an automatic draft.

function insertDocument(transactionId: string, userId: string, fileName: string, storagePath: string, contentType: string, size: number, placement: { category: string; documentType: string }) {
  return supabaseServer
    .from('documents')
    .insert({
      transaction_id: transactionId,
      category: placement.category,
      document_type: placement.documentType,
      file_name: fileName,
      storage_path: storagePath,
      content_type: contentType,
      file_size: size,
      uploaded_by: userId,
    })
    .select()
    .single();
}

/** The file name a letter template is saved under in a deal's Documents. */
export const letterFileName = (templateName: string) => `${templateName.replace(/[^A-Za-z0-9._ -]/g, '').trim().slice(0, 80) || 'Letter'}.pdf`;

export async function saveLetterToDeal(userId: string, transactionId: string, templateName: string, heading: string, text: string, placeAs?: { document_category?: unknown; document_type?: unknown }) {
  if (!text.trim()) throw new AuthError('The letter is empty.', 400);
  const fileName = letterFileName(templateName);
  // The heading is always filled in: if it was left blank, the letter's own name is used.
  const pdf = await generateLetterPdf(heading.trim() || templateName, text);
  const storagePath = `${transactionId}/${randomUUID()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const { error: uploadError } = await supabaseServer.storage.from(TEMPLATE_BUCKET).upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false });
  if (uploadError) throw uploadError;
  const { data, error } = await insertDocument(transactionId, userId, fileName, storagePath, 'application/pdf', pdf.length, resolveDocumentPlacement(placeAs?.document_category, placeAs?.document_type));
  if (error) {
    await supabaseServer.storage.from(TEMPLATE_BUCKET).remove([storagePath]);
    throw error;
  }
  return data;
}

// The copy is the deal's own file (its own storage object and Documents row): editing, renaming or removing it never touches the library
// template, and deleting the template later leaves this copy where it is. It files itself under the template's document category.
export async function attachFormToDeal(userId: string, transactionId: string, template: { storage_path?: unknown; file_name?: unknown; content_type?: unknown; file_size?: unknown; document_category?: unknown; document_type?: unknown }) {
  if (!template.storage_path) throw new AuthError('Upload your form to this template first.', 400);
  const fileName = (template.file_name as string) || 'Form.pdf';
  const storagePath = `${transactionId}/${randomUUID()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const { error: copyError } = await supabaseServer.storage.from(TEMPLATE_BUCKET).copy(template.storage_path as string, storagePath);
  if (copyError) throw copyError;
  const { data, error } = await insertDocument(transactionId, userId, fileName, storagePath, (template.content_type as string) || 'application/pdf', (template.file_size as number) || 0, resolveDocumentPlacement(template.document_category, template.document_type));
  if (error) {
    await supabaseServer.storage.from(TEMPLATE_BUCKET).remove([storagePath]);
    throw error;
  }
  return data;
}
