import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { CLOSED_STAGE, agentLabels, assertBrokerageOwner, isOpenListing, listOwnerLinks, loadOversightDeals, loadOversightListings, productionFor } from '@/lib/oversight';
import { oversightError, todayIso } from '@/lib/oversightServer';
import { inReviewWindow, missingRequired, type ReviewStatus } from '@/lib/fileReview';
import { generateComplianceReportPdf, reportCsv, type ReportAgent, type ReportMeta, type ReportRow } from '@/lib/complianceReport';

// GET ?format=csv|pdf  The brokerage owner's compliance snapshot: every agent with an active link, and each of their open files with
// its stage, checklist progress, late steps, missing required documents and file review. Closed files appear for the same
// window the file review uses. Read-only; it never includes client details, messages or document names.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    assertBrokerageOwner(user);
    const format = request.nextUrl.searchParams.get('format') === 'pdf' ? 'pdf' : 'csv';
    const today = todayIso();
    const links = (await listOwnerLinks(user.id)).filter((l) => l.status === 'active' && l.agent_user_id);
    const ids = links.map((l) => l.agent_user_id as string);

    const [labels, deals, listings, reqRes] = await Promise.all([
      agentLabels([...ids, user.id]),
      loadOversightDeals(ids, today),
      loadOversightListings(ids, today),
      supabaseServer.from('brokerage_file_requirements').select('document_types').eq('owner_user_id', user.id).maybeSingle(),
    ]);
    if (reqRes.error) throw reqRes.error;
    const required = ((reqRes.data?.document_types as string[] | undefined) ?? []).slice();

    const included = deals.filter((d) => d.status !== CLOSED_STAGE || inReviewWindow(d, CLOSED_STAGE, today));
    const docsByDeal = new Map<string, { document_type: string | null }[]>();
    const reviewByDeal = new Map<string, ReviewStatus>();
    const dealIds = included.map((d) => d.id);
    for (let i = 0; i < dealIds.length; i += 80) {
      const part = dealIds.slice(i, i + 80);
      const [docs, reviews] = await Promise.all([
        required.length ? supabaseServer.from('documents').select('transaction_id, document_type').in('transaction_id', part) : Promise.resolve({ data: [], error: null }),
        supabaseServer.from('brokerage_file_reviews').select('transaction_id, status').eq('owner_user_id', user.id).in('transaction_id', part),
      ]);
      if (docs.error) throw docs.error;
      if (reviews.error) throw reviews.error;
      for (const d of docs.data ?? []) docsByDeal.set(d.transaction_id as string, [...(docsByDeal.get(d.transaction_id as string) ?? []), { document_type: d.document_type as string | null }]);
      for (const r of reviews.data ?? []) reviewByDeal.set(r.transaction_id as string, r.status as ReviewStatus);
    }

    const nameOf = (id: string) => labels.get(id)?.name ?? 'Agent';
    const day = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : '');
    const price = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

    const dealRows: ReportRow[] = included.map((d) => {
      const closed = d.status === CLOSED_STAGE;
      const missing = missingRequired(required, docsByDeal.get(d.id) ?? []);
      const review = reviewByDeal.get(d.id);
      return {
        agent: nameOf(d.tc_user_id),
        kind: 'Deal',
        property: d.property_address ?? '',
        fileNumber: d.file_number ?? '',
        stage: d.status ?? '',
        price: price(d.purchase_price),
        acceptance: day(d.acceptance_date),
        closing: day(d.closing_date),
        stepsDone: d.tasksDone,
        stepsTotal: d.tasksTotal,
        lateSteps: closed ? 0 : d.health.overdueTasks,
        nextStep: d.nextStep?.name ?? '',
        nextDue: d.nextStep?.dueDate ?? '',
        missingDocs: missing,
        review: review === 'reviewed' ? 'Reviewed' : review === 'flagged' ? 'Flagged' : '',
        flags: d.health.flags,
        updated: day(d.updated_at),
      };
    });
    const listingRows: ReportRow[] = listings
      .filter((l) => isOpenListing(l.status))
      .map((l) => ({
        agent: nameOf(l.tc_user_id),
        kind: 'Listing' as const,
        property: l.property_address ?? '',
        fileNumber: l.mls_number ?? '',
        stage: (l.status ?? '').replace(/_/g, ' '),
        price: price(l.list_price),
        acceptance: '',
        closing: day(l.expiration_date),
        stepsDone: l.tasksDone,
        stepsTotal: l.tasksTotal,
        lateSteps: l.health.overdueTasks,
        nextStep: l.nextStep?.name ?? '',
        nextDue: l.nextStep?.dueDate ?? '',
        missingDocs: [],
        review: '',
        flags: l.health.flags,
        updated: day(l.updated_at),
      }));
    // Closing date column on a listing holds the date its agreement ends, which is what a broker watches; the stage says so.
    const rows = [...dealRows, ...listingRows].sort((a, b) => a.agent.localeCompare(b.agent) || a.kind.localeCompare(b.kind) || (a.closing || '9999').localeCompare(b.closing || '9999'));

    const agents: ReportAgent[] = ids
      .map((id) => {
        const mine = deals.filter((d) => d.tc_user_id === id);
        const myRows = rows.filter((r) => r.agent === nameOf(id));
        const stamps = [...mine.map((d) => d.updated_at), ...listings.filter((l) => l.tc_user_id === id).map((l) => l.updated_at)].filter((x): x is string => !!x).sort();
        return {
          name: nameOf(id),
          email: labels.get(id)?.email ?? '',
          openDeals: mine.filter((d) => d.status !== CLOSED_STAGE).length,
          openListings: listings.filter((l) => l.tc_user_id === id && isOpenListing(l.status)).length,
          closedThisYear: productionFor(mine, today).closedThisYear,
          lateSteps: myRows.reduce((n, r) => n + r.lateSteps, 0),
          filesMissingDocs: myRows.filter((r) => r.missingDocs.length > 0).length,
          lastActivity: stamps.length ? stamps[stamps.length - 1].slice(0, 10) : '',
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const meta: ReportMeta = { brokerage: labels.get(user.id)?.name ?? 'Brokerage', generatedOn: today, requiredDocs: required };
    await logAudit(request, user, 'brokerage.compliance_report', { entityType: 'brokerage', metadata: { format, agents: agents.length, files: rows.length } });

    if (format === 'pdf') {
      const pdf = await generateComplianceReportPdf(meta, agents, rows);
      return new NextResponse(new Uint8Array(pdf), { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="compliance-report-${today}.pdf"`, 'Cache-Control': 'no-store' } });
    }
    return new NextResponse(reportCsv(meta, agents, rows), { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="compliance-report-${today}.csv"`, 'Cache-Control': 'no-store' } });
  } catch (error) {
    return oversightError(error, 'create the compliance report');
  }
}
