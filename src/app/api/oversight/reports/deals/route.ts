import { resolveBrokerageActor } from '@/lib/brokerageAdminsServer';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase';
import { agentLabels, listOwnerLinks, loadOversightDeals } from '@/lib/oversight';
import { oversightError, todayIso } from '@/lib/oversightServer';
import { toCsv } from '@/lib/contactsCrm';
import { buildReport, cleanColumns, cleanFilters, filterDeals, REPORT_COLUMNS, type ReportDeal } from '@/lib/dealReport';
import { missingRequired, requiredForDeal, type DocumentList } from '@/lib/fileReview';

// A deal-level report for the brokerage owner. ?columns=a,b  ?agents=id,id  ?scope=all|open|closed  ?stages=a,b  ?from=&to= (closing
// date)  ?format=csv for a download. Only agents with an active link. Nothing private to the agent: no clients, fees or messages.
const MAX_ROWS = 2000;

export async function GET(request: NextRequest) {
  try {
    const { user: caller } = await getUserFromRequest(request);
    const { owner: user } = await resolveBrokerageActor(caller, 'view');
    const q = request.nextUrl.searchParams;
    const columns = cleanColumns(q.get('columns'));
    const filters = cleanFilters({ agents: q.get('agents'), scope: q.get('scope'), stages: q.get('stages'), from: q.get('from'), to: q.get('to') });
    const links = await listOwnerLinks(user.id);
    const ids = links.filter((l) => l.status === 'active' && l.agent_user_id).map((l) => l.agent_user_id as string);
    const [labels, all] = await Promise.all([agentLabels(ids), loadOversightDeals(ids, todayIso())]);
    const deals = filterDeals(all as ReportDeal[], filters).slice(0, MAX_ROWS);

    // Missing required documents only when asked for: it reads each file's document list.
    const missingByDeal = new Map<string, string[]>();
    if (columns.includes('missing') && deals.length) {
      const [reqRes, listsRes] = await Promise.all([
        supabaseServer.from('brokerage_file_requirements').select('document_types').eq('owner_user_id', user.id).maybeSingle(),
        supabaseServer.from('brokerage_document_lists').select('name, template_names, document_types').eq('owner_user_id', user.id).order('position', { ascending: true }),
      ]);
      const required = ((reqRes.data?.document_types as string[] | undefined) ?? []).slice();
      const lists: DocumentList[] = (listsRes.error ? [] : listsRes.data ?? []).map((r) => ({ name: r.name as string, templateNames: (r.template_names as string[]) ?? [], documentTypes: (r.document_types as string[]) ?? [] }));
      const docs = new Map<string, { document_type: string | null }[]>();
      const dealIds = deals.map((d) => d.id);
      for (let i = 0; i < dealIds.length; i += 80) {
        const { data, error } = await supabaseServer.from('documents').select('transaction_id, document_type').in('transaction_id', dealIds.slice(i, i + 80));
        if (error) throw error;
        for (const r of data ?? []) docs.set(r.transaction_id as string, [...(docs.get(r.transaction_id as string) ?? []), { document_type: r.document_type as string | null }]);
      }
      for (const d of deals) missingByDeal.set(d.id, missingRequired(requiredForDeal(d.checklist_template_name, lists, required).required, docs.get(d.id) ?? []));
    }

    const { head, rows } = buildReport(deals, columns, (d) => ({
      agentName: labels.get(d.tc_user_id)?.name ?? 'Agent',
      agentEmail: labels.get(d.tc_user_id)?.email ?? '',
      missing: columns.includes('missing') ? missingByDeal.get(d.id) ?? [] : null,
    }));

    if (q.get('format') === 'csv') {
      const csv = toCsv(head.map((h) => h.label), rows);
      return new NextResponse(`﻿${csv}`, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="deal-report.csv"', 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({
      columns: head,
      rows,
      total: rows.length,
      truncated: filterDeals(all as ReportDeal[], filters).length > MAX_ROWS,
      options: {
        columns: REPORT_COLUMNS,
        agents: ids.map((id) => ({ id, name: labels.get(id)?.name ?? 'Agent' })).sort((a, b) => a.name.localeCompare(b.name)),
        stages: [...new Set(all.map((d) => d.status).filter(Boolean) as string[])].sort(),
      },
    });
  } catch (error) {
    return oversightError(error, 'build the report');
  }
}
