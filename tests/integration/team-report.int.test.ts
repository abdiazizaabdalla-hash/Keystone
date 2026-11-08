import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildTeamReportData, teamReportWorkbook } from '@/lib/teamReport';
import { admin, createActor, cleanup, seedDeal, type Actor } from './helpers';

// The team owner's activity report: grouped by agent, activity within the period only, and no money / client names.
let broker: Actor;
let agentA: Actor;
let agentB: Actor;
const today = new Date().toISOString().slice(0, 10);
const start = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);

beforeAll(async () => {
  broker = await createActor('tr-broker', { plan: 'team' });
  agentA = await createActor('tr-a', { role: 'agent', agent_workspace: true });
  agentB = await createActor('tr-b', { role: 'agent', agent_workspace: true });
  const dealA = await seedDeal(agentA, 'TRA');
  await seedDeal(agentB, 'TRB');
  await admin.from('brokerage_links').insert([
    { owner_user_id: broker.id, agent_user_id: agentA.id, invited_email: agentA.email, status: 'active' },
    { owner_user_id: broker.id, agent_user_id: agentB.id, invited_email: agentB.email, status: 'active' },
  ]);
  await admin.from('tasks').insert([
    { transaction_id: dealA.transactionId, name: 'Step ticked this week', completed: true, completed_at: new Date().toISOString(), sort_order: 90 },
    { transaction_id: dealA.transactionId, name: 'Not done', completed: false, sort_order: 91 },
  ]);
}, 90_000);
afterAll(cleanup);

describe('team report', () => {
  it('groups files and activity by agent and leaves out money and client names', async () => {
    const { data: team } = await admin.from('team_members').select('team_id').eq('user_id', broker.id).maybeSingle();
    const data = await buildTeamReportData({ ownerId: broker.id, teamId: (team?.team_id as string) || '00000000-0000-0000-0000-000000000000', teamName: 'Test', periodStart: start, periodEnd: today, today });
    const owners = new Set(data.files.map((f) => f.member));
    expect(owners.size).toBe(2);
    expect(data.events.some((e) => e.type === 'New deal')).toBe(true);
    if (data.stepsTracked) expect(data.events.some((e) => e.type === 'Step completed' && e.detail === 'Step ticked this week')).toBe(true);
    const buf = await teamReportWorkbook(data, { cadence: 'manual', periodTitle: 'Test period', notes: 'Remember the broker note' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Transactions', 'Listings', 'Activity', 'Notes']);
    const text = JSON.stringify(wb.worksheets.map((w) => w.getSheetValues()));
    expect(text).toContain('Remember the broker note');
    expect(text).not.toMatch(/sale_price|purchase_price|commission/i);
  });
});
