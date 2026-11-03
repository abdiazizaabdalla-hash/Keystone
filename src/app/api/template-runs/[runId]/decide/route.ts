import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rateLimit';
import { logAudit } from '@/lib/audit';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { displayNameOf, loadDealForTemplates, recipientsOf } from '@/lib/templateContext';
import { EMAIL_RE, sendDealEmail } from '@/lib/dealEmail';
import { attachFormToDeal, saveLetterToDeal } from '@/lib/templateActions';
import { requireTemplatesUser, templateError } from '@/lib/templatesServer';

const DAILY_CAP = 100;

// POST { action: 'approve' | 'dismiss', subject?, body?, to? }: the person's decision on one automatic draft.
// Approving is the only thing that ever sends or saves anything. An email may only go to people who are on the deal,
// and at most DAILY_CAP approved emails go out per person per day.
export async function POST(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { user } = await requireTemplatesUser(request);
    const { runId } = await params;
    const input = (await request.json().catch(() => ({}))) as { action?: string; subject?: string; body?: string; to?: unknown };
    const { data: run } = await supabaseServer.from('template_runs').select('*').eq('id', runId).maybeSingle();
    if (!run || run.owner_user_id !== user.id) throw new AuthError('Draft not found', 404);
    if (run.status !== 'pending') throw new AuthError('That draft has already been handled.', 409);

    const now = new Date().toISOString();
    if (input.action === 'dismiss') {
      await supabaseServer.from('template_runs').update({ status: 'dismissed', decided_at: now }).eq('id', runId).eq('status', 'pending');
      return NextResponse.json({ ok: true, status: 'dismissed' });
    }
    if (input.action !== 'approve') throw new AuthError('Choose approve or dismiss.', 400);
    await assertTrialActive(user);

    const subject = typeof input.subject === 'string' ? input.subject.trim() : ((run.subject as string | null) ?? '');
    const text = typeof input.body === 'string' ? input.body.trim() : ((run.body as string | null) ?? '').trim();
    const chosen = Array.isArray(input.to)
      ? input.to.filter((x): x is string => typeof x === 'string').map((x) => x.trim().toLowerCase())
      : ((run.recipients as Array<{ email: string }>) || []).map((r) => r.email.toLowerCase());

    const deal = await loadDealForTemplates(run.transaction_id as string);
    if (!deal) throw new AuthError('The deal for this draft no longer exists.', 404);
    const { data: template } = run.template_id ? await supabaseServer.from('doc_templates').select('*').eq('id', run.template_id).maybeSingle() : { data: null };

    // Check everything before claiming the draft, so a mistake can be fixed and tried again.
    if (run.kind === 'email') {
      const onDeal = new Set(recipientsOf(deal).map((p) => p.email!.toLowerCase()));
      if (chosen.length === 0) throw new AuthError('This draft has no one to send to. Add an email address to a contact on the deal first.', 400);
      if (chosen.some((a) => !EMAIL_RE.test(a) || !onDeal.has(a))) throw new AuthError('Automatic emails can only go to people on the deal.', 400);
      if (!subject || !text) throw new AuthError('The draft needs a subject and a message.', 400);
      if (!(await checkRateLimit(`template-run-email:${user.id}`, DAILY_CAP, 24 * 60 * 60))) throw new AuthError('You have approved a lot of emails today. Try again tomorrow.', 429);
    } else if (!template) {
      throw new AuthError('The template for this draft was deleted.', 400);
    } else if (run.kind === 'letter' && !text) {
      throw new AuthError('The letter is empty.', 400);
    } else if (run.kind === 'form' && !template.storage_path) {
      throw new AuthError('Upload your form to the template first.', 400);
    }

    const { data: claimed } = await supabaseServer.from('template_runs').update({ status: 'sent', decided_at: now }).eq('id', runId).eq('status', 'pending').select('id');
    if (!claimed || claimed.length === 0) throw new AuthError('That draft has already been handled.', 409);

    try {
      let documentId: string | null = null;
      if (run.kind === 'email') {
        await sendDealEmail({ ownerUserId: user.id, ownerName: displayNameOf(user), ownerEmail: user.email ?? null, transactionId: run.transaction_id as string, to: chosen, subject, message: text, source: 'rule' });
      } else if (run.kind === 'letter') {
        documentId = ((await saveLetterToDeal(user.id, run.transaction_id as string, template!.name as string, subject, text)) as { id: string }).id;
      } else {
        documentId = ((await attachFormToDeal(user.id, run.transaction_id as string, template!)) as { id: string }).id;
      }
      await supabaseServer.from('template_runs').update({ sent_at: new Date().toISOString(), subject: subject || null, body: text || null, generated_document_id: documentId }).eq('id', runId);
      await logAudit(request, { id: user.id, email: user.email }, 'transaction.template_run_approved', { entityType: 'transaction', entityId: run.transaction_id as string, metadata: { runId, kind: run.kind, recipients: chosen.length } });
      return NextResponse.json({ ok: true, status: 'sent' });
    } catch (error) {
      console.error('Approved template draft failed:', error);
      await supabaseServer.from('template_runs').update({ status: 'failed', error: error instanceof Error ? error.message.slice(0, 300) : 'Failed' }).eq('id', runId);
      return NextResponse.json({ error: 'That could not be completed. The draft was marked as failed.' }, { status: 502 });
    }
  } catch (error) {
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    return templateError(error, 'decide on a draft of');
  }
}
