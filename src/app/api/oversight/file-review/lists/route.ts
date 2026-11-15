import { resolveBrokerageActor } from '@/lib/brokerageAdminsServer';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { listOwnerLinks } from '@/lib/oversight';
import { assertBrokerageManageable, getAccount } from '@/lib/brokerageAccount';
import { oversightError } from '@/lib/oversightServer';
import { cleanDocumentLists, extraListLimit, type DocumentList } from '@/lib/fileReview';
import { BROKERAGE_LIMITS } from '@/lib/tiers';

// The brokerage's named required-document lists (Brokerage Pro). Each applies to files whose checklist template it names; every
// other file uses the default list. GET gives the lists, how many are allowed, and the checklist templates the agents use.
// PUT { lists } replaces them all. Basic gets the default list only.

async function limits(ownerId: string) {
  const account = await getAccount(ownerId);
  const tier = account?.tier === 'pro' ? 'pro' : 'basic';
  return { tier, max: extraListLimit(BROKERAGE_LIMITS[tier].requiredDocumentLists) };
}

export async function GET(request: NextRequest) {
  try {
    const { user: caller } = await getUserFromRequest(request);
    const { owner: user } = await resolveBrokerageActor(caller, 'view');
    const [{ tier, max }, listsRes, links] = await Promise.all([
      limits(user.id),
      supabaseServer.from('brokerage_document_lists').select('name, template_names, document_types').eq('owner_user_id', user.id).order('position', { ascending: true }),
      listOwnerLinks(user.id),
    ]);
    // Before add-brokerage-document-lists.sql has run, there are simply no extra lists.
    if (listsRes.error && listsRes.error.code !== 'PGRST205' && listsRes.error.code !== '42P01') throw listsRes.error;
    const agentIds = links.filter((l) => l.status === 'active' && l.agent_user_id).map((l) => l.agent_user_id as string);
    const templates = new Set<string>();
    if (agentIds.length) {
      const { data, error } = await supabaseServer.from('transactions').select('checklist_template_name').in('tc_user_id', agentIds).not('checklist_template_name', 'is', null).limit(2000);
      if (error) throw error;
      for (const r of data ?? []) if (r.checklist_template_name) templates.add(String(r.checklist_template_name));
    }
    const lists: DocumentList[] = (listsRes.data ?? []).map((r) => ({ name: r.name as string, templateNames: (r.template_names as string[]) ?? [], documentTypes: (r.document_types as string[]) ?? [] }));
    return NextResponse.json({ tier, maxLists: max, lists, templates: [...templates].sort((a, b) => a.localeCompare(b)) });
  } catch (error) {
    return oversightError(error, 'load the document lists');
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { user: caller } = await getUserFromRequest(request);
    const { owner: user } = await resolveBrokerageActor(caller, 'compliance');
    await assertBrokerageManageable(user.id);
    const { max } = await limits(user.id);
    const body = (await request.json().catch(() => ({}))) as { lists?: unknown };
    const incoming = Array.isArray(body.lists) ? body.lists.length : 0;
    if (incoming > max) {
      return NextResponse.json({ error: max === 0 ? 'More than one required-document list is part of Brokerage Pro.' : `Your plan allows ${max} extra lists besides the default.` }, { status: 403 });
    }
    const lists = cleanDocumentLists(body.lists, max);
    const { error: delError } = await supabaseServer.from('brokerage_document_lists').delete().eq('owner_user_id', user.id);
    if (delError) throw delError;
    if (lists.length) {
      const { error } = await supabaseServer.from('brokerage_document_lists').insert(lists.map((l, i) => ({ owner_user_id: user.id, name: l.name, template_names: l.templateNames, document_types: l.documentTypes, position: i })));
      if (error) throw error;
    }
    await logAudit(request, user, 'brokerage.document_lists', { entityType: 'brokerage', entityId: user.id, metadata: { count: lists.length } });
    return NextResponse.json({ lists });
  } catch (error) {
    return oversightError(error, 'save the document lists');
  }
}
