import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { assertBrokerageOwner } from '@/lib/oversight';
import { assertBrokerageManageable } from '@/lib/brokerageAccount';
import { oversightError } from '@/lib/oversightServer';
import { cleanRequiredTypes } from '@/lib/fileReview';

// PUT { types: string[] }: the document types every file in this brokerage must contain. Replaces the whole list; unknown types are ignored.
export async function PUT(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    assertBrokerageOwner(user);
    await assertBrokerageManageable(user.id);
    const body = (await request.json().catch(() => ({}))) as { types?: unknown };
    const types = cleanRequiredTypes(body.types);
    const { error } = await supabaseServer.from('brokerage_file_requirements').upsert({ owner_user_id: user.id, document_types: types, updated_at: new Date().toISOString() }, { onConflict: 'owner_user_id' });
    if (error) throw error;
    await logAudit(request, user, 'brokerage.file_requirements', { entityType: 'brokerage', entityId: user.id, metadata: { count: types.length } });
    return NextResponse.json({ required: types });
  } catch (error) {
    return oversightError(error, 'save the required documents');
  }
}
