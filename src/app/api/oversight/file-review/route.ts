import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { CLOSED_STAGE, agentLabels, assertBrokerageOwner, listOwnerLinks, loadOversightDeals } from '@/lib/oversight';
import { oversightError, todayIso } from '@/lib/oversightServer';
import { compareReviewRows, inReviewWindow, missingRequired, type ReviewStatus } from '@/lib/fileReview';

// The brokerage owner's file review list: closed files from the last 180 days and files closing within 30 days, each with the
// required documents that are missing and whether the owner has reviewed or flagged it. Only agents with an active link.
// Document names and types are not returned, only which required types are missing.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    await assertBrokerageOwner(user);
    const today = todayIso();
    const links = await listOwnerLinks(user.id);
    const ids = links.filter((l) => l.status === 'active' && l.agent_user_id).map((l) => l.agent_user_id as string);

    const [labels, deals, reqRes] = await Promise.all([
      agentLabels(ids),
      loadOversightDeals(ids, today),
      supabaseServer.from('brokerage_file_requirements').select('document_types').eq('owner_user_id', user.id).maybeSingle(),
    ]);
    if (reqRes.error) throw reqRes.error;
    const required = ((reqRes.data?.document_types as string[] | undefined) ?? []).slice();

    const listed = deals.filter((d) => inReviewWindow(d, CLOSED_STAGE, today));
    const listedIds = listed.map((d) => d.id);
    const docsByDeal = new Map<string, { document_type: string | null }[]>();
    const reviewByDeal = new Map<string, { status: ReviewStatus; note: string | null; reviewedAt: string }>();
    for (let i = 0; i < listedIds.length; i += 80) {
      const part = listedIds.slice(i, i + 80);
      const [docs, reviews] = await Promise.all([
        required.length ? supabaseServer.from('documents').select('transaction_id, document_type').in('transaction_id', part) : Promise.resolve({ data: [], error: null }),
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
        missing: missingRequired(required, docsByDeal.get(d.id) ?? []),
        review: reviewByDeal.get(d.id) ?? null,
      }))
      .sort(compareReviewRows);

    return NextResponse.json({
      required,
      files: rows,
      totals: { listed: rows.length, needsReview: rows.filter((r) => !r.review && r.missing.length > 0).length, flagged: rows.filter((r) => r.review?.status === 'flagged').length, reviewed: rows.filter((r) => r.review?.status === 'reviewed').length },
    });
  } catch (error) {
    return oversightError(error, 'load file review');
  }
}
