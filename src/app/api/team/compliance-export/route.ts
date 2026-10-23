import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { getTeamForUser, getTeamMemberUserIds } from '@/lib/team';
import { TRANSACTION_STAGES } from '@/lib/transactionStages';
import { logAudit } from '@/lib/audit';

const CLOSED_STATUS = TRANSACTION_STAGES[TRANSACTION_STAGES.length - 1];

// GET /api/team/compliance-export
//
// The team compliance report: a CSV, one row per OPEN file, showing where each team member's files stand right now
// (stage, checklist progress, closing date, next deadline, overdue deadlines). Team owner only.
//
// It is deliberately a status summary and nothing more: no prices, no client names, no documents, no messages, no
// contacts. Everything else a team member has stays private to their own login. Each download is recorded in the
// audit log.

function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  // Spreadsheet formula injection: a cell that starts with = + - @ (or tab/CR) would run as a formula when opened.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const ymd = (d: unknown) => (typeof d === 'string' ? d.slice(0, 10) : '');

async function memberLabel(userId: string): Promise<{ name: string; email: string }> {
  const { data } = await supabaseServer.auth.admin.getUserById(userId);
  const email = data.user?.email || '';
  const full = data.user?.user_metadata?.full_name;
  return { name: typeof full === 'string' && full.trim() ? full.trim() : email, email };
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);

    const membership = await getTeamForUser(user.id);
    if (!membership || membership.role !== 'owner') {
      return NextResponse.json({ error: 'Only the team owner can download the team compliance report.' }, { status: 403 });
    }

    const memberIds = await getTeamMemberUserIds(membership.team.id);
    const labels = new Map(await Promise.all(memberIds.map(async (id) => [id, await memberLabel(id)] as const)));

    const { data: txs, error: txError } = await supabaseServer
      .from('transactions')
      .select('id, tc_user_id, agent_id, file_number, property_address, status, acceptance_date, closing_date')
      .in('tc_user_id', memberIds)
      .neq('status', CLOSED_STATUS)
      .limit(5000);
    if (txError) throw txError;
    const rows = txs || [];

    const txIds = rows.map((t) => t.id as string);
    const agentIds = [...new Set(rows.map((t) => t.agent_id as string).filter(Boolean))];

    const [agentsRes, tasksRes, datesRes] = await Promise.all([
      agentIds.length ? supabaseServer.from('agents').select('id, name').in('id', agentIds) : Promise.resolve({ data: [], error: null }),
      txIds.length ? supabaseServer.from('tasks').select('transaction_id, completed').in('transaction_id', txIds).limit(50000) : Promise.resolve({ data: [], error: null }),
      txIds.length
        ? supabaseServer.from('transaction_key_dates').select('transaction_id, label, due_date, completed').in('transaction_id', txIds).eq('completed', false).limit(50000)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (agentsRes.error) throw agentsRes.error;
    if (tasksRes.error) throw tasksRes.error;
    if (datesRes.error) throw datesRes.error;

    const agentName = new Map((agentsRes.data || []).map((a) => [a.id as string, (a.name as string) || '']));

    const progress = new Map<string, { done: number; total: number }>();
    for (const t of tasksRes.data || []) {
      const p = progress.get(t.transaction_id as string) || { done: 0, total: 0 };
      p.total += 1;
      if (t.completed) p.done += 1;
      progress.set(t.transaction_id as string, p);
    }

    const today = new Date().toISOString().slice(0, 10);
    const datesByTx = new Map<string, { label: string; due: string }[]>();
    for (const d of datesRes.data || []) {
      const list = datesByTx.get(d.transaction_id as string) || [];
      list.push({ label: (d.label as string) || '', due: ymd(d.due_date) });
      datesByTx.set(d.transaction_id as string, list);
    }

    const sorted = [...rows].sort((a, b) => {
      const la = labels.get(a.tc_user_id as string)?.name || '';
      const lb = labels.get(b.tc_user_id as string)?.name || '';
      return la.localeCompare(lb) || String(a.file_number).localeCompare(String(b.file_number));
    });

    const header = ['Team member', 'Member email', 'File number', 'Property', 'Agent', 'Stage', 'Checklist done', 'Checklist total', 'Acceptance date', 'Closing date', 'Days to closing', 'Next deadline', 'Next deadline date', 'Overdue deadlines'];
    const lines = [header.map(csvCell).join(',')];

    for (const t of sorted) {
      const who = labels.get(t.tc_user_id as string) || { name: '', email: '' };
      const p = progress.get(t.id as string) || { done: 0, total: 0 };
      const dates = (datesByTx.get(t.id as string) || []).sort((a, b) => a.due.localeCompare(b.due));
      const overdue = dates.filter((d) => d.due && d.due < today).length;
      const next = dates.find((d) => d.due && d.due >= today) || dates[0];
      const closing = ymd(t.closing_date);
      const daysToClosing = closing ? Math.round((new Date(`${closing}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000) : '';
      lines.push(
        [
          who.name,
          who.email,
          t.file_number,
          t.property_address,
          agentName.get(t.agent_id as string) || '',
          t.status,
          p.done,
          p.total,
          ymd(t.acceptance_date),
          closing,
          daysToClosing,
          next?.label || '',
          next?.due || '',
          overdue,
        ]
          .map(csvCell)
          .join(',')
      );
    }

    await logAudit(request, user, 'team.compliance_export', { entityType: 'team', entityId: membership.team.id, metadata: { files: sorted.length, members: memberIds.length } });

    return new NextResponse(`﻿${lines.join('\r\n')}\r\n`, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="team-compliance-report-${today}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error building team compliance report:', error);
    return NextResponse.json({ error: 'Could not build the compliance report' }, { status: 500 });
  }
}
