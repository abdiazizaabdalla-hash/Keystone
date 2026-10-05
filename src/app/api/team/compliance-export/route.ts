import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { getTeamForUser, getTeamMemberUserIds } from '@/lib/team';

// A minimal RFC 4180 CSV field escape: wrap in quotes (doubling any
// embedded quotes) whenever the value contains a comma, quote, or
// newline -- otherwise leave it bare, same as every spreadsheet app's
// own CSV writer does.
function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Spreadsheet formula injection: a cell starting with = + - @ (or a tab/CR)
  // is executed as a formula by Excel/Sheets. Prefix with an apostrophe.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /api/team/compliance-export
//
// A brokerage-wide audit CSV -- one row per transaction across every TC
// on the team (plus anything still sitting in the unassigned queue),
// with its checklist completion and overdue counts. This is the
// brokerage-level complement to GET /api/transactions/[id]/compliance-
// export, which is a single deal's full PDF (documents, messages,
// checklist) -- that one is for a deep dive on one file; this one is
// for "show me every file's compliance status at a glance," which is
// what a broker doing a file review or responding to an audit actually
// starts from. Owner-only.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);

    const membership = await getTeamForUser(user.id);
    if (!membership || membership.role !== 'owner') {
      return NextResponse.json({ error: 'Only the team owner can export compliance data' }, { status: 403 });
    }

    const memberIds = await getTeamMemberUserIds(membership.team.id);

    const { data: teamAgents, error: agentsError } = await supabaseServer
      .from('agents')
      .select('id, tc_user_id, name')
      .in('tc_user_id', memberIds);
    if (agentsError) throw agentsError;

    const agentById = new Map((teamAgents || []).map((a) => [a.id as string, a]));
    const teamAgentIds = (teamAgents || []).map((a) => a.id as string);

    // Everything assigned to a team member, plus anything in the
    // unassigned queue whose agent still belongs to this team -- same
    // two-part scoping as GET /api/team/unassigned.
    const orFilter =
      teamAgentIds.length > 0
        ? `tc_user_id.in.(${memberIds.join(',')}),and(tc_user_id.is.null,agent_id.in.(${teamAgentIds.join(',')}))`
        : `tc_user_id.in.(${memberIds.join(',')})`;

    const { data: transactions, error: txError } = await supabaseServer
      .from('transactions')
      .select('id, file_number, property_address, status, tc_user_id, agent_id, acceptance_date, closing_date, created_at')
      .or(orFilter)
      .order('created_at', { ascending: true });
    if (txError) throw txError;

    const rows = transactions || [];
    const txIds = rows.map((t) => t.id as string);

    const taskCountByTx = new Map<string, { total: number; completed: number; overdue: number }>();
    if (txIds.length > 0) {
      const { data: tasks } = await supabaseServer
        .from('tasks')
        .select('transaction_id, completed, due_date')
        .in('transaction_id', txIds);
      const todayStr = new Date().toISOString().split('T')[0];
      for (const t of tasks || []) {
        const txId = t.transaction_id as string;
        const entry = taskCountByTx.get(txId) || { total: 0, completed: 0, overdue: 0 };
        entry.total += 1;
        if (t.completed) entry.completed += 1;
        else if (t.due_date && (t.due_date as string) < todayStr) entry.overdue += 1;
        taskCountByTx.set(txId, entry);
      }
    }

    // TC display names -- a single batch of lookups rather than one
    // Auth Admin call per row.
    const tcLabelById = new Map<string, string>();
    await Promise.all(
      memberIds.map(async (id) => {
        const { data } = await supabaseServer.auth.admin.getUserById(id);
        tcLabelById.set(id, (data.user?.user_metadata?.full_name as string | undefined) || data.user?.email || id);
      })
    );

    const header = [
      'File Number',
      'Property Address',
      'Status',
      'TC',
      'Agent',
      'Acceptance Date',
      'Closing Date',
      'Created At',
      'Checklist Total',
      'Checklist Completed',
      'Checklist Overdue',
    ];

    const lines = [header.map(csvField).join(',')];
    for (const t of rows) {
      const tasksSummary = taskCountByTx.get(t.id as string) || { total: 0, completed: 0, overdue: 0 };
      const agent = agentById.get(t.agent_id as string);
      const tcUserId = t.tc_user_id as string | null;
      lines.push(
        [
          t.file_number,
          t.property_address,
          t.status,
          tcUserId ? tcLabelById.get(tcUserId) || tcUserId : 'Unassigned',
          agent?.name || '',
          t.acceptance_date || '',
          t.closing_date || '',
          t.created_at,
          tasksSummary.total,
          tasksSummary.completed,
          tasksSummary.overdue,
        ]
          .map(csvField)
          .join(',')
      );
    }

    const csv = lines.join('\n');
    const dateStr = new Date().toISOString().split('T')[0];

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="compliance-export-${dateStr}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error generating brokerage compliance export:', error);
    return NextResponse.json({ error: 'Failed to generate compliance export' }, { status: 500 });
  }
}
