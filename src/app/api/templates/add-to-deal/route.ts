import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { authorizeDeal } from '@/lib/authorize';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { logAudit } from '@/lib/audit';
import { supabaseServer } from '@/lib/supabase';
import { buildMergeContext, displayNameOf, loadDealForTemplates } from '@/lib/templateContext';
import { renderTemplate } from '@/lib/templateMerge';
import { attachFormToDeal, letterFileName, saveLetterToDeal } from '@/lib/templateActions';
import { loadUsableTemplate, markTemplateUsed, requireTemplatesUser, templateError } from '@/lib/templatesServer';

// POST { transactionId, templateIds: string[], skipExisting?: boolean }
// Adds letters and forms straight to a deal's Documents, with no pop-up to click through:
//   a letter is filled in with the deal's details and saved as a PDF whose heading is already set (its own, else the template's name);
//   a form is copied in as it is.
// One template is a click on it; "add all" sends every template shown. With skipExisting, one whose file is already in the deal's
// Documents is left out, so adding all twice does not double up. A letter that needs something the deal does not have yet is still
// added, with that part left blank, and listed under `blanks` so the person can fix the deal and add it again.
// Emails are not added here (they are sent, not filed). Answers { added: [...], skipped: [...] }.
export async function POST(request: NextRequest) {
  try {
    const { user, isAdmin } = await requireTemplatesUser(request);
    const input = (await request.json().catch(() => ({}))) as { transactionId?: string; templateIds?: unknown; skipExisting?: boolean };
    if (!input.transactionId) return NextResponse.json({ error: 'Choose a deal' }, { status: 400 });
    const ids = Array.isArray(input.templateIds) ? [...new Set(input.templateIds.filter((x): x is string => typeof x === 'string'))] : [];
    if (ids.length === 0) return NextResponse.json({ error: 'Choose at least one template.' }, { status: 400 });
    if (ids.length > 40) return NextResponse.json({ error: 'That is too many at once (40 at most).' }, { status: 400 });
    const transactionId = input.transactionId;
    await authorizeDeal(user, isAdmin, transactionId, { scope: 'owner', participants: 'full', deniedMessage: 'You do not have permission to use templates on this transaction' });
    await assertTrialActive(user);
    const deal = await loadDealForTemplates(transactionId);
    if (!deal) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    const ctx = buildMergeContext(deal, { name: displayNameOf(user), email: user.email ?? null }, null);

    const existing = new Set<string>();
    if (input.skipExisting) {
      const { data } = await supabaseServer.from('documents').select('file_name').eq('transaction_id', transactionId);
      for (const d of data ?? []) existing.add(String(d.file_name).toLowerCase());
    }

    const added: { templateId: string; name: string; kind: 'letter' | 'form'; documentId: string | null; blanks: string[] }[] = [];
    const skipped: { templateId: string; name: string; reason: string }[] = [];

    for (const id of ids) {
      let template;
      try {
        template = await loadUsableTemplate(id, user.id);
      } catch {
        skipped.push({ templateId: id, name: 'A template', reason: 'It is not available to you.' });
        continue;
      }
      const name = template.name as string;
      try {
        if (template.kind === 'letter') {
          if (input.skipExisting && existing.has(letterFileName(name).toLowerCase())) {
            skipped.push({ templateId: id, name, reason: 'Already in this deal’s Documents.' });
            continue;
          }
          const subject = renderTemplate(template.subject as string | null, ctx);
          const body = renderTemplate(template.body as string | null, ctx);
          if (!body.text.trim()) {
            skipped.push({ templateId: id, name, reason: 'The letter is empty.' });
            continue;
          }
          const doc = await saveLetterToDeal(user.id, transactionId, name, subject.text.trim() || name, body.text);
          added.push({ templateId: id, name, kind: 'letter', documentId: (doc?.id as string) ?? null, blanks: [...new Set([...subject.missing, ...body.missing])] });
        } else if (template.kind === 'form') {
          if (!template.storage_path) {
            skipped.push({ templateId: id, name, reason: 'No file has been uploaded to this form yet.' });
            continue;
          }
          if (input.skipExisting && existing.has(String(template.file_name ?? 'Form.pdf').toLowerCase())) {
            skipped.push({ templateId: id, name, reason: 'Already in this deal’s Documents.' });
            continue;
          }
          const doc = await attachFormToDeal(user.id, transactionId, template);
          added.push({ templateId: id, name, kind: 'form', documentId: (doc?.id as string) ?? null, blanks: [] });
        } else {
          skipped.push({ templateId: id, name, reason: 'Emails are sent, not added to Documents.' });
          continue;
        }
        if (!template.from_brokerage) await markTemplateUsed(id, user.id);
      } catch (error) {
        if (error instanceof AuthError) throw error;
        console.error('Could not add a template to a deal:', error);
        skipped.push({ templateId: id, name, reason: 'Something went wrong adding it.' });
      }
    }

    if (added.length > 0) await logAudit(request, { id: user.id, email: user.email }, 'transaction.templates_added', { entityType: 'transaction', entityId: transactionId, metadata: { added: added.length, skipped: skipped.length } });
    return NextResponse.json({ added, skipped });
  } catch (error) {
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    return templateError(error, 'use');
  }
}
