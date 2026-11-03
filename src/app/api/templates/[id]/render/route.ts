import { NextRequest, NextResponse } from 'next/server';
import { authorizeDeal } from '@/lib/authorize';
import { buildMergeContext, displayNameOf, loadDealForTemplates, recipientsOf } from '@/lib/templateContext';
import { renderTemplate } from '@/lib/templateMerge';
import { templateFitsState } from '@/lib/usStates';
import { loadUsableTemplate, requireTemplatesUser, templateError } from '@/lib/templatesServer';

// POST { transactionId, recipientEmail? }: the template with this deal's details filled in, plus who it could go to.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, isAdmin } = await requireTemplatesUser(request);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { transactionId?: string; recipientEmail?: string };
    if (!body.transactionId) return NextResponse.json({ error: 'Choose a deal' }, { status: 400 });
    const template = await loadUsableTemplate(id, user.id);
    await authorizeDeal(user, isAdmin, body.transactionId, { scope: 'owner', participants: 'full', deniedMessage: 'You do not have permission to use templates on this transaction' });
    const deal = await loadDealForTemplates(body.transactionId);
    if (!deal) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });

    const recipients = recipientsOf(deal);
    const wanted = body.recipientEmail?.trim().toLowerCase();
    const to = wanted ? recipients.find((r) => r.email?.toLowerCase() === wanted) ?? null : null;
    const ctx = buildMergeContext(deal, { name: displayNameOf(user), email: user.email ?? null }, to);
    const subject = renderTemplate(template.subject as string | null, ctx);
    const text = renderTemplate(template.body as string | null, ctx);
    return NextResponse.json({
      kind: template.kind,
      name: template.name,
      subject: subject.text,
      body: text.text,
      missing: [...new Set([...subject.missing, ...text.missing])],
      fileName: template.file_name ?? null,
      dealState: deal.state,
      fitsState: templateFitsState(template.states as string[], deal.state),
      recipients,
    });
  } catch (error) {
    return templateError(error, 'fill in');
  }
}
