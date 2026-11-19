import { resolveBrokerageActor } from '@/lib/brokerageAdminsServer';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { CLOSED_STAGE, agentLabels, listOwnerLinks, loadOversightDeals } from '@/lib/oversight';
import { oversightError, todayIso } from '@/lib/oversightServer';
import { REQUIRABLE_TYPES, compareReviewRows, inReviewWindow, missingRequired, requiredForDeal, type DocumentList, type ReviewStatus } from '@/lib/fileReview';

// The brokerage owner's file review list: closed files from the last 180 days and files closing within 30 days, each with the
// required documents that are missing and whether the owner has reviewed or flagged it. Only agents with an active link.
// Document names and types are not returned, only which required types are missing.
export async function GET(request: NextRequest) {
  try {
    const { user: caller } = await getUserFromRequest(request);
    const { owner: user } = await resolveBrokerageActor(caller, 'view');
    const today = todayIso();
    const links = await listOwnerLinks(user.id);
    const ids = links.filter((l) => l.status === 'active' && l.agent_user_id).map((l) => l.agent_user_id as string);

    const [labels, deals, reqRes, listsRes] = await Promise.all([
      agentLabels(ids),
      loadOversightDeals(ids, today),
      supabaseServer.from('brokerage_file_requirements').select('document_types').eq('owner_user_id', user.id).maybeSingle(),
      supabaseServer.from('brokerage_document_lists').select('name, template_names, document_types').eq('owner_user_id', user.id).order('position', { ascending: true }),
    ]);
    if (reqRes.error) throw reqRes.error;
    // A database without the lists table behaves as before: one default list for every file.
    const listsMissing = listsRes.error && (listsRes.error.code === 'PGRST205' || listsRes.error.code === '42P01');
    if (listsRes.error && !listsMissing) throw listsRes.error;
    const lists: DocumentList[] = (listsRes.data ?? []).map((r) => ({ name: r.name as string, templateNames: (r.template_names as string[]) ?? [], documentTypes: (r.document_types as string[]) ?? [] }));
    let required = ((reqRes.data?.document_types as string[] | undefined) ?? []).slice();
    // The first visit saves every document as required, the same starting point onboarding offers, so the owner removes what they do not want.
    if (!reqRes.data) {
      const seed = await supabaseServer.from('brokerage_file_requirements').upsert({ owner_user_id: user.id, document_types: REQUIRABLE_TYPES, updated_at: new Date().toISOString() }, { onConflict: 'owner_user_id', ignoreDuplicates: true });
      if (!seed.error) required = [...REQUIRABLE_TYPES];
    }

    const listed = deals.filter((d) => inReviewWindow(d, CLOSED_STAGE, today));
    const listedIds = listed.map((d) => d.id);
    const docsByDeal = new Map<string, { document_type: string | null }[]>();
    const reviewByDeal = new Map<string, { status: ReviewStatus; note: string | null; reviewedAt: string }>();
    for (let i = 0; i < listedIds.length; i += 80) {
      const part = listedIds.slice(i, i + 80);
      const [docs, reviews] = await Promise.all([
        required.length || lists.length ? supabaseServer.from('documents').select('transaction_id, document_type').in('transaction_id', part) : Promise.resolve({ data: [], error: null }),
        supabaseServer.from('brokerage_file_reviews').select('transaction_id, status, note, reviewed_at').eq('owner_user_id', user.id).in('transaction_id', part),
      ]);
      if (docs.error) throw docs.error;
      if (reviews.error) throw reviews.error;
      for (const d of docs.data ?? []) docsByDeal.set(d.transaction_id as string, [...(docsByDeal.get(d.transaction_id as string) ?? []), { document_type: d.document_type as string | null }]);
      for (const r of reviews.data ?? []) reviewByDeal.set(r.transaction_id as string, { status: r.status as ReviewStatus, note: (r.note as string | null) ?? null, reviewedAt: r.reviewed_at as string });
    }

    const rows = listed
      .map((d) => ({
        id: d.id,
        address: d.property_address,
        fileNumber: d.file_number,
        agentId: d.tc_user_id,
        agentName: labels.get(d.tc_user_id)?.name ?? 'Agent',
        closed: d.status === CLOSED_STAGE,
        closingDate: d.closing_date,
        listName: requiredForDeal(d.checklist_template_name, lists, required).listName,
        missing: missingRequired(requiredForDeal(d.checklist_template_name, lists, required).required, docsByDeal.get(d.id) ?? []),
        review: reviewByDeal.get(d.id) ?? null,
      }))
      .sort(compareReviewRows);

    return NextResponse.json({
      required,
      lists: lists.map((l) => ({ name: l.name, templateNames: l.templateNames, count: l.documentTypes.length })),
      files: rows,
      totals: { listed: rows.length, needsReview: rows.filter((r) => !r.review && r.missing.length > 0).length, flagged: rows.filter((r) => r.review?.status === 'flagged').length, reviewed: rows.filter((r) => r.review?.status === 'reviewed').length },
    });
  } catch (error) {
    return oversightError(error, 'load file review');
  }
}
