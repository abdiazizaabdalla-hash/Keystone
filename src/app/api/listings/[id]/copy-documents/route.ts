import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { getVisibleTcUserIds } from '@/lib/team';
import { requireListingAccess } from '@/lib/listings';

const BUCKET = 'transaction-documents';

// After "Convert to deal": copies every file on the listing onto the new transaction's Documents
// (the files are duplicated in storage, so deleting one side never touches the other).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, isAdmin } = await requireListingAccess(request, id);
    const body = await request.json().catch(() => ({}));
    const transactionId = typeof body.transactionId === 'string' ? body.transactionId : '';
    if (!transactionId) return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });

    const { data: tx } = await supabaseServer.from('transactions').select('id, agent_id').eq('id', transactionId).maybeSingle();
    if (!tx) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    if (!isAdmin) {
      const visible = await getVisibleTcUserIds(user.id);
      const { data: agent } = await supabaseServer.from('agents').select('tc_user_id').eq('id', tx.agent_id).maybeSingle();
      if (!agent || !visible.includes(agent.tc_user_id as string)) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    const { data: docs } = await supabaseServer.from('listing_documents').select('*').eq('listing_id', id).order('created_at', { ascending: true });
    let copied = 0;
    for (const d of docs || []) {
      const safeName = String(d.file_name).replace(/[^a-zA-Z0-9._-]/g, '_');
      const dest = `${transactionId}/${crypto.randomUUID()}-${safeName}`;
      const { error: copyError } = await supabaseServer.storage.from(BUCKET).copy(d.storage_path as string, dest);
      if (copyError) {
        console.error('Copying listing document failed', copyError);
        continue;
      }
      const general = d.document_type === 'General';
      const { error: insertError } = await supabaseServer.from('documents').insert({
        transaction_id: transactionId,
        category: general ? 'other' : 'contract_disclosures',
        document_type: general ? 'General' : d.document_type,
        file_name: d.file_name,
        storage_path: dest,
        content_type: d.content_type,
        file_size: d.file_size,
        uploaded_by: user.id,
        requires_signature: false,
      });
      if (insertError) {
        await supabaseServer.storage.from(BUCKET).remove([dest]);
        console.error('Inserting copied document failed', insertError);
        continue;
      }
      copied += 1;
    }
    return NextResponse.json({ copied, total: (docs || []).length });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error copying listing documents:', error);
    return NextResponse.json({ error: 'Failed to copy documents' }, { status: 500 });
  }
}
