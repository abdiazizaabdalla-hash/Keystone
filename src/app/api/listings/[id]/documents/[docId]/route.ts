import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { requireListingAccess } from '@/lib/listings';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
  try {
    const { id, docId } = await params;
    const { user } = await requireListingAccess(request, id);
    await assertTrialActive(user);
    const { data: doc } = await supabaseServer.from('listing_documents').select('id, storage_path').eq('id', docId).eq('listing_id', id).maybeSingle();
    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { error: removeError } = await supabaseServer.storage.from('transaction-documents').remove([doc.storage_path as string]);
    if (removeError) console.warn('Listing document storage removal failed; deleting the row anyway', removeError);
    const { error } = await supabaseServer.from('listing_documents').delete().eq('id', docId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    console.error('Error deleting listing document:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
