import { resolveBrokerageActor } from '@/lib/brokerageAdminsServer';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { agentLabels, canOverseeDeal, ownerMayOpenDocuments } from '@/lib/oversight';
import { logAudit } from '@/lib/audit';
import { oversightError } from '@/lib/oversightServer';

const BUCKET = 'transaction-documents';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

// Everything the deal page needs to show an agent's deal to the brokerage owner, in the shapes the agent's own page
// reads them in: the deal, its checklist, documents (with links) and contacts. Read-only; 404 unless the caller
// oversees the deal's owner. Messages, the coordinator, client sharing, invoices and fee terms are left out on purpose.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user: caller } = await getUserFromRequest(request);
    const { owner: user } = await resolveBrokerageActor(caller, 'view');
    if (!(await canOverseeDeal(user.id, id))) throw new AuthError('Not found', 404);

    const { data: deal, error } = await supabaseServer.from('transactions').select('*').eq('id', id).single();
    if (error) throw error;
    const { inbound_token: _token, ...transaction } = deal as Record<string, unknown>;
    void _token;

    const [{ data: tasks }, { data: docs }, { data: contacts }, { data: keyDates }] = await Promise.all([
      supabaseServer.from('tasks').select('*').eq('transaction_id', id).order('sort_order', { ascending: true }),
      supabaseServer.from('documents').select('*').eq('transaction_id', id).order('created_at', { ascending: false }),
      supabaseServer.from('transaction_contacts').select('*').eq('transaction_id', id).order('position', { ascending: true }),
      supabaseServer.from('transaction_key_dates').select('*').eq('transaction_id', id).order('due_date', { ascending: true }),
    ]);
    // Document files open only while the agent allows it; otherwise the owner gets names without links.
    const mayOpen = await ownerMayOpenDocuments(user.id, deal.tc_user_id as string);
    if (mayOpen && (docs ?? []).length) await logAudit(request, user, 'brokerage.documents_opened', { entityType: 'transaction', entityId: id, metadata: { count: (docs ?? []).length } });
    const documents = await Promise.all(
      (docs ?? []).map(async (doc) => {
        if (!mayOpen) return { ...doc, url: null };
        const { data: signed } = await supabaseServer.storage.from(BUCKET).createSignedUrl(doc.storage_path as string, SIGNED_URL_TTL_SECONDS);
        return { ...doc, url: signed?.signedUrl ?? null };
      })
    );
    const label = (await agentLabels([deal.tc_user_id as string])).get(deal.tc_user_id as string) ?? null;
    return NextResponse.json({ transaction, agent: label ? { name: label.name, email: label.email } : null, tasks: tasks ?? [], documents, documentsLocked: !mayOpen, contacts: contacts ?? [], keyDates: keyDates ?? [] });
  } catch (error) {
    return oversightError(error, 'load that deal');
  }
}
