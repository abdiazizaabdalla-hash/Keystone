import ExcelJS from 'exceljs';
import { supabaseServer } from '@/lib/supabase';
import { TRANSACTION_STAGES } from '@/lib/transactionStages';
import { closedOnDate } from '@/lib/oversightMath';
import { getTeamMemberUserIds } from '@/lib/team';
import { activeAgentIds, brokerageOn } from '@/lib/oversight';

// The team owner's activity report: where every file stands, and what happened in a period (new deals, closings, steps completed,
// deadlines met, documents added, listings). Built from the data, saved as a snapshot (so the same week or month can be downloaded
// again) and written out as an Excel workbook with one sheet each for the summary, transactions, listings, activity and the owner's
// notes. Deliberately no prices, client names, document names, messages or contacts.

const CLOSED = TRANSACTION_STAGES[TRANSACTION_STAGES.length - 1];
const OPEN_LISTING = ['preparing', 'active', 'under_offer'];

export interface ReportFile {
  agent: string;
  member: string;
  kind: 'Deal' | 'Listing';
  fileNumber: string;
  property: string;
  stage: string;
  stepsDone: number;
  stepsTotal: number;
  acceptance: string;
  closing: string;
  daysToClosing: number | null;
  nextDeadline: string;
  nextDeadlineDate: string;
  overdueDeadlines: number;
  updated: string;
}
export interface ReportEvent {
  date: string;
  agent: string;
  member: string;
  type: string;
  fileNumber: string;
  property: string;
  detail: string;
}
export interface TeamReportData {
  teamName: string;
  periodStart: string;
  periodEnd: string;
  generatedOn: string;
  files: ReportFile[];
  events: ReportEvent[];
  /** false when tasks have no completion time yet (add-team-reports.sql not run), so "steps completed" cannot be reported */
  stepsTracked: boolean;
}

const ymd = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : '');
function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
const inPeriod = (date: string, start: string, end: string) => !!date && date >= start && date <= end;
const daysBetween = (from: string, to: string) => Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000);

async function label(userId: string): Promise<{ name: string; email: string }> {
  const { data } = await supabaseServer.auth.admin.getUserById(userId);
  const email = data.user?.email || '';
  const full = data.user?.user_metadata?.full_name;
  return { name: typeof full === 'string' && full.trim() ? full.trim() : email || 'Team member', email };
}

export async function buildTeamReportData(opts: { ownerId: string; teamId: string; teamName: string; periodStart: string; periodEnd: string; today: string }): Promise<TeamReportData> {
  const { ownerId, teamId, teamName, periodStart, periodEnd, today } = opts;
  const teamIds = await getTeamMemberUserIds(teamId);
  // With brokerage oversight on, agents who joined this brokerage are in the report too.
  const joined = brokerageOn() ? await activeAgentIds(ownerId) : [];
  const joinedSet = new Set(joined);
  const memberIds = [...new Set([...teamIds, ...joined])];
  const labels = new Map(await Promise.all(memberIds.map(async (id) => [id, await label(id)] as const)));

  const [txRes, lsRes] = await Promise.all([
    supabaseServer.from('transactions').select('id, tc_user_id, agent_id, file_number, property_address, status, acceptance_date, closing_date, created_at, updated_at').in('tc_user_id', memberIds).limit(5000),
    supabaseServer.from('listings').select('id, tc_user_id, agent_id, property_address, mls_number, status, expiration_date, listed_on, created_at, updated_at').in('tc_user_id', memberIds).limit(5000),
  ]);
  if (txRes.error) throw txRes.error;
  if (lsRes.error) throw lsRes.error;
  const allDeals = txRes.data || [];
  const allListings = lsRes.data || [];

  const agentIds = [...new Set([...allDeals, ...allListings].map((r) => r.agent_id as string).filter(Boolean))];
  const agentRes = agentIds.length ? await supabaseServer.from('agents').select('id, name').in('id', agentIds) : { data: [], error: null };
  if (agentRes.error) throw agentRes.error;
  const agentName = new Map((agentRes.data || []).map((a) => [a.id as string, ((a.name as string) || '').trim()]));
  // An agent who joined the brokerage owns their files; for a coordinator's file the agent is the agent on the file.
  const agentOf = (row: { tc_user_id: unknown; agent_id: unknown }) => (joinedSet.has(row.tc_user_id as string) ? labels.get(row.tc_user_id as string)?.name || 'Agent' : agentName.get(row.agent_id as string) || '(no agent)');
  const memberOf = (row: { tc_user_id: unknown }) => labels.get(row.tc_user_id as string)?.name || '';

  // Which deals belong in the report: everything open, plus anything that closed in the period.
  const closedOn = (d: { closing_date: unknown; updated_at: unknown }) => closedOnDate({ closing_date: ymd(d.closing_date), updated_at: ymd(d.updated_at) } as never, today);
  const deals = allDeals.filter((d) => d.status !== CLOSED || inPeriod(closedOn(d), periodStart, periodEnd));
  const listings = allListings.filter((l) => OPEN_LISTING.includes(l.status as string) || inPeriod(ymd(l.updated_at), periodStart, periodEnd));
  const dealIds = deals.map((d) => d.id as string);
  const listingIds = listings.map((l) => l.id as string);

  // Checklist progress, deadlines, and what happened in the period.
  const progress = new Map<string, { done: number; total: number }>();
  const dates = new Map<string, { label: string; due: string }[]>();
  const events: ReportEvent[] = [];
  let stepsTracked = true;
  const docCount = new Map<string, number>();
  const base = (row: { tc_user_id: unknown; agent_id: unknown }) => ({ agent: agentOf(row), member: memberOf(row) });
  const dealById = new Map(allDeals.map((d) => [d.id as string, d]));
  const listingById = new Map(allListings.map((l) => [l.id as string, l]));

  for (const part of chunks(dealIds, 80)) {
    const [tasks, keyDates, docs] = await Promise.all([
      supabaseServer.from('tasks').select('transaction_id, completed').in('transaction_id', part).limit(50000),
      supabaseServer.from('transaction_key_dates').select('transaction_id, label, due_date, completed, updated_at').in('transaction_id', part).limit(50000),
      supabaseServer.from('documents').select('transaction_id, created_at').in('transaction_id', part).gte('created_at', `${periodStart}T00:00:00Z`).lte('created_at', `${periodEnd}T23:59:59Z`).limit(50000),
    ]);
    if (tasks.error) throw tasks.error;
    if (keyDates.error) throw keyDates.error;
    for (const t of tasks.data || []) {
      const p = progress.get(t.transaction_id as string) || { done: 0, total: 0 };
      p.total += 1;
      if (t.completed) p.done += 1;
      progress.set(t.transaction_id as string, p);
    }
    for (const k of keyDates.data || []) {
      if (!k.completed) {
        const list = dates.get(k.transaction_id as string) || [];
        list.push({ label: (k.label as string) || '', due: ymd(k.due_date) });
        dates.set(k.transaction_id as string, list);
      } else if (inPeriod(ymd(k.updated_at), periodStart, periodEnd)) {
        const d = dealById.get(k.transaction_id as string);
        if (d) events.push({ date: ymd(k.updated_at), ...base(d), type: 'Deadline completed', fileNumber: (d.file_number as string) || '', property: (d.property_address as string) || '', detail: (k.label as string) || '' });
      }
    }
    if (!docs.error) for (const d of docs.data || []) docCount.set(d.transaction_id as string, (docCount.get(d.transaction_id as string) || 0) + 1);

    // Steps ticked in the period (needs tasks.completed_at; without it the report says so rather than guessing).
    const done = await supabaseServer.from('tasks').select('transaction_id, name, completed_at').in('transaction_id', part).eq('completed', true).gte('completed_at', `${periodStart}T00:00:00Z`).lte('completed_at', `${periodEnd}T23:59:59Z`).limit(50000);
    if (done.error) stepsTracked = false;
    else {
      for (const t of done.data || []) {
        const d = dealById.get(t.transaction_id as string);
        if (d) events.push({ date: ymd(t.completed_at), ...base(d), type: 'Step completed', fileNumber: (d.file_number as string) || '', property: (d.property_address as string) || '', detail: (t.name as string) || '' });
      }
    }
  }
  for (const [txId, n] of docCount) {
    const d = dealById.get(txId);
    if (d) events.push({ date: periodEnd, ...base(d), type: 'Documents added', fileNumber: (d.file_number as string) || '', property: (d.property_address as string) || '', detail: `${n} document${n === 1 ? '' : 's'} added` });
  }

  const listingProgress = new Map<string, { done: number; total: number }>();
  for (const part of chunks(listingIds, 80)) {
    const lt = await supabaseServer.from('listing_tasks').select('listing_id, name, completed, completed_at').in('listing_id', part).limit(50000);
    if (lt.error) throw lt.error;
    for (const t of lt.data || []) {
      const p = listingProgress.get(t.listing_id as string) || { done: 0, total: 0 };
      p.total += 1;
      if (t.completed) p.done += 1;
      listingProgress.set(t.listing_id as string, p);
      if (t.completed && inPeriod(ymd(t.completed_at), periodStart, periodEnd)) {
        const l = listingById.get(t.listing_id as string);
        if (l) events.push({ date: ymd(t.completed_at), ...base(l), type: 'Listing step completed', fileNumber: (l.mls_number as string) || '', property: (l.property_address as string) || '', detail: (t.name as string) || '' });
      }
    }
  }

  // New deals, closings, new listings, listings going live.
  for (const d of allDeals) {
    if (inPeriod(ymd(d.created_at), periodStart, periodEnd)) events.push({ date: ymd(d.created_at), ...base(d), type: 'New deal', fileNumber: (d.file_number as string) || '', property: (d.property_address as string) || '', detail: (d.status as string) || '' });
    if (d.status === CLOSED && inPeriod(closedOn(d), periodStart, periodEnd)) events.push({ date: closedOn(d), ...base(d), type: 'Closed', fileNumber: (d.file_number as string) || '', property: (d.property_address as string) || '', detail: 'Closed' });
  }
  for (const l of allListings) {
    if (inPeriod(ymd(l.created_at), periodStart, periodEnd)) events.push({ date: ymd(l.created_at), ...base(l), type: 'New listing', fileNumber: (l.mls_number as string) || '', property: (l.property_address as string) || '', detail: '' });
    if (inPeriod(ymd(l.listed_on), periodStart, periodEnd)) events.push({ date: ymd(l.listed_on), ...base(l), type: 'Listing went live', fileNumber: (l.mls_number as string) || '', property: (l.property_address as string) || '', detail: '' });
    if (l.status === 'converted' && inPeriod(ymd(l.updated_at), periodStart, periodEnd)) events.push({ date: ymd(l.updated_at), ...base(l), type: 'Listing became a deal', fileNumber: (l.mls_number as string) || '', property: (l.property_address as string) || '', detail: '' });
  }

  const files: ReportFile[] = [];
  for (const d of deals) {
    const p = progress.get(d.id as string) || { done: 0, total: 0 };
    const open = (dates.get(d.id as string) || []).sort((a, b) => a.due.localeCompare(b.due));
    const next = open.find((x) => x.due && x.due >= today) || open[0];
    const closing = ymd(d.closing_date);
    files.push({
      agent: agentOf(d), member: memberOf(d), kind: 'Deal', fileNumber: (d.file_number as string) || '', property: (d.property_address as string) || '', stage: (d.status as string) || '',
      stepsDone: p.done, stepsTotal: p.total, acceptance: ymd(d.acceptance_date), closing, daysToClosing: closing && d.status !== CLOSED ? daysBetween(today, closing) : null,
      nextDeadline: d.status === CLOSED ? '' : next?.label || '', nextDeadlineDate: d.status === CLOSED ? '' : next?.due || '', overdueDeadlines: d.status === CLOSED ? 0 : open.filter((x) => x.due && x.due < today).length, updated: ymd(d.updated_at),
    });
  }
  for (const l of listings) {
    const p = listingProgress.get(l.id as string) || { done: 0, total: 0 };
    const end = ymd(l.expiration_date);
    files.push({
      agent: agentOf(l), member: memberOf(l), kind: 'Listing', fileNumber: (l.mls_number as string) || '', property: (l.property_address as string) || '', stage: ((l.status as string) || '').replace(/_/g, ' '),
      stepsDone: p.done, stepsTotal: p.total, acceptance: '', closing: end, daysToClosing: end && OPEN_LISTING.includes(l.status as string) ? daysBetween(today, end) : null,
      nextDeadline: '', nextDeadlineDate: '', overdueDeadlines: 0, updated: ymd(l.updated_at),
    });
  }
  files.sort((a, b) => a.agent.localeCompare(b.agent) || a.kind.localeCompare(b.kind) || (a.closing || '9999').localeCompare(b.closing || '9999'));
  events.sort((a, b) => a.agent.localeCompare(b.agent) || b.date.localeCompare(a.date) || a.type.localeCompare(b.type));
  return { teamName, periodStart, periodEnd, generatedOn: today, files, events, stepsTracked };
}

/** Per-agent numbers for the Summary sheet. */
export function summarizeByAgent(data: TeamReportData) {
  const agents = [...new Set([...data.files.map((f) => f.agent), ...data.events.map((e) => e.agent)])].sort((a, b) => a.localeCompare(b));
  return agents.map((agent) => {
    const files = data.files.filter((f) => f.agent === agent);
    const events = data.events.filter((e) => e.agent === agent);
    const open = files.filter((f) => f.kind === 'Deal' && f.stage !== CLOSED);
    const upcoming = open.filter((f) => f.closing).map((f) => f.closing).sort()[0] || '';
    return {
      agent,
      openDeals: open.length,
      openListings: files.filter((f) => f.kind === 'Listing' && OPEN_LISTING.includes(f.stage.replace(/ /g, '_'))).length,
      newDeals: events.filter((e) => e.type === 'New deal').length,
      newListings: events.filter((e) => e.type === 'New listing').length,
      closings: events.filter((e) => e.type === 'Closed').length,
      stepsCompleted: events.filter((e) => e.type === 'Step completed' || e.type === 'Listing step completed').length,
      overdueDeadlines: open.reduce((n, f) => n + f.overdueDeadlines, 0),
      nextClosing: upcoming,
    };
  });
}

const HEAD_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
const GROUP_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

function addTable<T>(ws: ExcelJS.Worksheet, columns: { header: string; width: number; value: (row: T) => string | number | null }[], rows: T[], agentOf: (row: T) => string) {
  ws.columns = columns.map((c) => ({ header: c.header, width: c.width }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = HEAD_FILL;
  head.alignment = { vertical: 'middle' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  let current: string | null = null;
  for (const row of rows) {
    const agent = agentOf(row);
    if (agent !== current) {
      current = agent;
      const g = ws.addRow([`Agent: ${agent}`]);
      g.font = { bold: true };
      g.fill = GROUP_FILL;
      ws.mergeCells(g.number, 1, g.number, columns.length);
    }
    ws.addRow(columns.map((c) => c.value(row)));
  }
  if (rows.length === 0) ws.addRow(['Nothing to report.']);
}

export async function teamReportWorkbook(data: TeamReportData, opts: { cadence: string; periodTitle: string; notes: string | null }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Relay';
  wb.created = new Date();

  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ width: 26 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 18 }, { width: 16 }];
  sum.addRow([`${data.teamName || 'Team'} activity report`]).font = { bold: true, size: 16 };
  sum.addRow([opts.periodTitle]).font = { bold: true };
  sum.addRow([`${data.periodStart} to ${data.periodEnd} · generated ${data.generatedOn}`]);
  sum.addRow([]);
  const per = summarizeByAgent(data);
  const total = (k: 'openDeals' | 'openListings' | 'newDeals' | 'newListings' | 'closings' | 'stepsCompleted' | 'overdueDeadlines') => per.reduce((n, r) => n + r[k], 0);
  const th = sum.addRow(['Agent', 'Open deals', 'Open listings', 'New deals', 'New listings', 'Closings', 'Steps completed', 'Overdue deadlines', 'Next closing']);
  th.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  th.fill = HEAD_FILL;
  for (const r of per) sum.addRow([r.agent, r.openDeals, r.openListings, r.newDeals, r.newListings, r.closings, r.stepsCompleted, r.overdueDeadlines, r.nextClosing]);
  const tr = sum.addRow(['All agents', total('openDeals'), total('openListings'), total('newDeals'), total('newListings'), total('closings'), total('stepsCompleted'), total('overdueDeadlines'), '']);
  tr.font = { bold: true };
  tr.fill = GROUP_FILL;
  if (!data.stepsTracked) {
    sum.addRow([]);
    sum.addRow(['Steps completed is not available yet: the database update that records when a step is ticked (add-team-reports.sql) has not been run.']).font = { italic: true, color: { argb: 'FFB45309' } };
  }
  sum.addRow([]);
  sum.addRow(['Status summary only: no prices, client names, document names, messages or contacts.']).font = { italic: true, color: { argb: 'FF64748B' } };

  addTable(
    wb.addWorksheet('Transactions'),
    [
      { header: 'Team member', width: 22, value: (f: ReportFile) => f.member },
      { header: 'File number', width: 14, value: (f) => f.fileNumber },
      { header: 'Property', width: 36, value: (f) => f.property },
      { header: 'Stage', width: 20, value: (f) => f.stage },
      { header: 'Steps done', width: 11, value: (f) => f.stepsDone },
      { header: 'Steps total', width: 11, value: (f) => f.stepsTotal },
      { header: 'Acceptance', width: 12, value: (f) => f.acceptance },
      { header: 'Closing', width: 12, value: (f) => f.closing },
      { header: 'Days to closing', width: 14, value: (f) => f.daysToClosing },
      { header: 'Next deadline', width: 24, value: (f) => f.nextDeadline },
      { header: 'Next deadline date', width: 16, value: (f) => f.nextDeadlineDate },
      { header: 'Overdue deadlines', width: 16, value: (f) => f.overdueDeadlines },
      { header: 'Last updated', width: 12, value: (f) => f.updated },
    ],
    data.files.filter((f) => f.kind === 'Deal'),
    (f) => f.agent
  );
  addTable(
    wb.addWorksheet('Listings'),
    [
      { header: 'Team member', width: 22, value: (f: ReportFile) => f.member },
      { header: 'MLS number', width: 14, value: (f) => f.fileNumber },
      { header: 'Property', width: 36, value: (f) => f.property },
      { header: 'Status', width: 16, value: (f) => f.stage },
      { header: 'Steps done', width: 11, value: (f) => f.stepsDone },
      { header: 'Steps total', width: 11, value: (f) => f.stepsTotal },
      { header: 'Agreement ends', width: 14, value: (f) => f.closing },
      { header: 'Days left', width: 11, value: (f) => f.daysToClosing },
      { header: 'Last updated', width: 12, value: (f) => f.updated },
    ],
    data.files.filter((f) => f.kind === 'Listing'),
    (f) => f.agent
  );
  addTable(
    wb.addWorksheet('Activity'),
    [
      { header: 'Date', width: 12, value: (e: ReportEvent) => e.date },
      { header: 'Team member', width: 22, value: (e) => e.member },
      { header: 'What happened', width: 22, value: (e) => e.type },
      { header: 'File number', width: 14, value: (e) => e.fileNumber },
      { header: 'Property', width: 36, value: (e) => e.property },
      { header: 'Detail', width: 44, value: (e) => e.detail },
    ],
    data.events,
    (e) => e.agent
  );

  const notes = wb.addWorksheet('Notes');
  notes.columns = [{ width: 110 }];
  notes.addRow([`Notes for ${opts.periodTitle}`]).font = { bold: true, size: 14 };
  notes.addRow([]);
  const lines = (opts.notes || '').split(/\r?\n/);
  if (!opts.notes || !opts.notes.trim()) notes.addRow(['No notes added. The team owner can add notes in Collaborate → Settings → Team compliance report.']).font = { italic: true, color: { argb: 'FF64748B' } };
  else for (const line of lines) notes.addRow([line]).alignment = { wrapText: true, vertical: 'top' };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
