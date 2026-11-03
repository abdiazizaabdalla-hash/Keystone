import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { authorizeDeal } from '@/lib/authorize';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAudit } from '@/lib/audit';
import { displayNameOf } from '@/lib/templateContext';
import { EMAIL_RE, sendDealEmail } from '@/lib/dealEmail';
import { attachFormToDeal, saveLetterToDeal } from '@/lib/templateActions';
import { loadOwnTemplate, requireTemplatesUser, templateError } from '@/lib/templatesServer';

// POST { transactionId, action: 'send' | 'save_pdf' | 'attach_form', subject?, body?, to? }
//   send        an email template: send it to the people picked (recorded in the outbox on a developer machine)
//   save_pdf    a letter template: save the filled-in text as a PDF in the deal's Documents
//   attach_form a form template: copy your uploaded form into the deal's Documents
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, isAdmin } = await requireTemplatesUser(request);
    const { id } = await params;
    const input = (await request.json().catch(() => ({}))) as { transactionId?: string; action?: string; subject?: string; body?: string; to?: unknown };
    if (!input.transactionId) return NextResponse.json({ error: 'Choose a deal' }, { status: 400 });
    const template = await loadOwnTemplate(id, user.id);
    await authorizeDeal(user, isAdmin, input.transactionId, { scope: 'owner', participants: 'full', deniedMessage: 'You do not have permission to use templates on this transaction' });
    await assertTrialActive(user);
    const transactionId = input.transactionId;
    const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
    const text = typeof input.body === 'string' ? input.body.trim() : '';

    if (input.action === 'send') {
      if (template.kind !== 'email') throw new AuthError('Only an email template can be sent.', 400);
      const to = Array.isArray(input.to) ? input.to.filter((x): x is string => typeof x === 'string').map((x) => x.trim().toLowerCase()) : [];
      if (to.length === 0 || to.length > 10) throw new AuthError('Choose between 1 and 10 recipients.', 400);
      if (to.some((a) => !EMAIL_RE.test(a))) throw new AuthError('One of the email addresses is not valid.', 400);
      if (!subject || subject.length > 200) throw new AuthError('Add a subject (up to 200 characters).', 400);
      if (!text || text.length > 20000) throw new AuthError('Add a message.', 400);
      if (!(await checkRateLimit(`template-email:${user.id}`, 40, 60 * 60))) throw new AuthError('You have sent a lot of emails in the last hour. Try again a bit later.', 429);
      const result = await sendDealEmail({
        ownerUserId: user.id,
        ownerName: displayNameOf(user),
        ownerEmail: user.email ?? null,
        transactionId,
        to,
        subject,
        message: text,
        copySender: true,
        source: 'template',
      });
      await logAudit(request, { id: user.id, email: user.email }, 'transaction.template_email_sent', { entityType: 'transaction', entityId: transactionId, metadata: { templateId: id, recipients: to.length, mode: result.mode } });
      return NextResponse.json({ ok: true, mode: result.mode });
    }

    if (input.action === 'save_pdf') {
      if (template.kind !== 'letter') throw new AuthError('Only a letter template can be saved as a PDF.', 400);
      if (!text) throw new AuthError('The letter is empty.', 400);
      const doc = await saveLetterToDeal(user.id, transactionId, template.name as string, subject, text);
      await logAudit(request, { id: user.id, email: user.email }, 'transaction.template_letter_saved', { entityType: 'transaction', entityId: transactionId, metadata: { templateId: id } });
      return NextResponse.json({ ok: true, document: doc });
    }

    if (input.action === 'attach_form') {
      if (template.kind !== 'form') throw new AuthError('Only a form template carries a file.', 400);
      const doc = await attachFormToDeal(user.id, transactionId, template);
      await logAudit(request, { id: user.id, email: user.email }, 'transaction.template_form_attached', { entityType: 'transaction', entityId: transactionId, metadata: { templateId: id } });
      return NextResponse.json({ ok: true, document: doc });
    }

    throw new AuthError('Choose what to do with the template.', 400);
  } catch (error) {
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    return templateError(error, 'use');
  }
}
