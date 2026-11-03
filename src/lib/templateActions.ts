import { randomUUID } from 'node:crypto';
import { AuthError } from './auth';
import { supabaseServer } from './supabase';
import { generateLetterPdf } from './templatePdf';
import { TEMPLATE_BUCKET } from './templatesServer';

// What a template does on a deal once it is approved: a letter becomes a PDF in Documents, a form is copied into
// Documents. (Emails go through sendDealEmail.) Shared by "use a template" and by approving an automatic draft.

function insertDocument(transactionId: string, userId: string, fileName: string, storagePath: string, contentType: string, size: number) {
  return supabaseServer
    .from('documents')
    .insert({
      transaction_id: transactionId,
      category: 'other',
      document_type: 'General',
      file_name: fileName,
      storage_path: storagePath,
      content_type: contentType,
      file_size: size,
      uploaded_by: userId,
    })
    .select()
    .single();
}

export async function saveLetterToDeal(userId: string, transactionId: string, templateName: string, heading: string, text: string) {
  if (!text.trim()) throw new AuthError('The letter is empty.', 400);
  const fileName = `${templateName.replace(/[^A-Za-z0-9._ -]/g, '').trim().slice(0, 80) || 'Letter'}.pdf`;
  const pdf = await generateLetterPdf(heading, text);
  const storagePath = `${transactionId}/${randomUUID()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const { error: uploadError } = await supabaseServer.storage.from(TEMPLATE_BUCKET).upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false });
  if (uploadError) throw uploadError;
  const { data, error } = await insertDocument(transactionId, userId, fileName, storagePath, 'application/pdf', pdf.length);
  if (error) {
    await supabaseServer.storage.from(TEMPLATE_BUCKET).remove([storagePath]);
    throw error;
  }
  return data;
}

export async function attachFormToDeal(userId: string, transactionId: string, template: { storage_path?: unknown; file_name?: unknown; content_type?: unknown; file_size?: unknown }) {
  if (!template.storage_path) throw new AuthError('Upload your form to this template first.', 400);
  const fileName = (template.file_name as string) || 'Form.pdf';
  const storagePath = `${transactionId}/${randomUUID()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const { error: copyError } = await supabaseServer.storage.from(TEMPLATE_BUCKET).copy(template.storage_path as string, storagePath);
  if (copyError) throw copyError;
  const { data, error } = await insertDocument(transactionId, userId, fileName, storagePath, (template.content_type as string) || 'application/pdf', (template.file_size as number) || 0);
  if (error) {
    await supabaseServer.storage.from(TEMPLATE_BUCKET).remove([storagePath]);
    throw error;
  }
  return data;
}
