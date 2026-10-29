import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { loadAgentContext } from '@/lib/agentClientShare';

// PATCH { clientVisible: boolean } -- the agent decides whether their
// client can open this document from the client progress page. Agents
// only: the TC cannot change it (the TC's /api/documents PATCH ignores
// the field). Off by default.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
  try {
    const { id: transactionId, docId } = await params;
    await loadAgentContext(request, transactionId);

    const body = await request.json().catch(() => ({}));
    if (typeof body.clientVisible !== 'boolean') {
      return NextResponse.json({ error: 'clientVisible must be true or false' }, { status: 400 });
    }

    const { data, error } = await supabaseServer
      .from('documents')
      .update({ client_visible: body.clientVisible })
      .eq('id', docId)
      .eq('transaction_id', transactionId)
      .select('id, client_visible')
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error updating client document visibility:', error);
    return NextResponse.json({ error: 'Failed to update document' }, { status: 500 });
  }
}
