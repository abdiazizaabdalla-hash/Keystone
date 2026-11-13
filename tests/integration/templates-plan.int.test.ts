import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as createAgent } from '@/app/api/agents/route';
import { POST as createTransaction } from '@/app/api/transactions/route';
import { GET as listTemplates, POST as createTemplate } from '@/app/api/templates/route';
import { POST as createRule } from '@/app/api/templates/[id]/rules/route';
import { GET as authMe } from '@/app/api/auth/me/route';
import { evaluateTemplateRules } from '@/lib/templateRules';
import { TEMPLATES_PLAN_MESSAGE } from '@/lib/automation/plan';
import { admin, call, cleanup, createActor, type Actor } from './helpers';

// Templates are a Pro and Team feature (the same rule as automation). Starter is refused by every templates route,
// the account info tells the screens to hide them, and a downgrade stops rule drafts at once.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let starter: Actor;
let pro: Actor;

beforeAll(async () => {
  starter = await createActor('tp-starter', { plan: 'starter' });
  pro = await createActor('tp-pro', { plan: 'pro' });
});
afterAll(cleanup);

describe('templates plan gate', () => {
  it('refuses a Starter account on the list and on save, with the upgrade message', async () => {
    const list = await call(h(listTemplates), starter, { method: 'GET', path: '/api/templates' });
    expect(list.status).toBe(403);
    expect((list.json as { error: string }).error).toBe(TEMPLATES_PLAN_MESSAGE);
    const save = await call(h(createTemplate), starter, { method: 'POST', path: '/api/templates', body: { kind: 'email', name: 'Nope', subject: 's', body: 'b' } });
    expect(save.status).toBe(403);
  });

  it('lets a Pro account use them', async () => {
    const save = await call(h(createTemplate), pro, { method: 'POST', path: '/api/templates', body: { kind: 'email', name: 'Yes', subject: 's', body: 'b' } });
    expect(save.status, JSON.stringify(save.json)).toBeLessThan(300);
    expect((await call(h(listTemplates), pro, { method: 'GET', path: '/api/templates' })).status).toBe(200);
  });

  it('tells the screens: allowed for Pro, hidden for Starter', async () => {
    expect(((await call(h(authMe), pro, { method: 'GET', path: '/api/auth/me' })).json as { templatesAllowed: boolean }).templatesAllowed).toBe(true);
    expect(((await call(h(authMe), starter, { method: 'GET', path: '/api/auth/me' })).json as { templatesAllowed: boolean }).templatesAllowed).toBe(false);
  });

  it('stops rule drafts the moment a plan is downgraded', async () => {
    const a = await call(h(createAgent), pro, { method: 'POST', path: '/api/agents', body: { name: 'Plan Agent', email: 'planagent@example.test', flatFee: 0, percentFee: 0 } });
    const t = await call(h(createTemplate), pro, { method: 'POST', path: '/api/templates', body: { kind: 'email', name: 'Closing note', subject: 'Congrats on {{property_address}}', body: 'Hi {{client_first_name}}' } });
    const templateId = (t.json as { id: string }).id;
    expect((await call(h(createRule), pro, { method: 'POST', path: `/api/templates/${templateId}/rules`, params: { id: templateId }, body: { trigger_event: 'deal_closed', recipient_roles: ['Buyer'] } })).status).toBe(201);
    const deal = await call(h(createTransaction), pro, { method: 'POST', path: '/api/transactions', body: { agentId: (a.json as { id: string }).id, propertyAddress: '9 Plan St, Austin, TX 78701', purchasePrice: 300000, fileNumber: 'TP-1' } });
    const dealId = ((deal.json as { transaction?: { id: string } }).transaction?.id ?? (deal.json as { id: string }).id) as string;
    await admin.from('transaction_contacts').insert({ transaction_id: dealId, role: 'Buyer', name: 'Pat Buyer', email: 'patbuyer@example.test', position: 0 });
    await admin.from('transactions').update({ status: 'Closed' }).eq('id', dealId);

    await admin.auth.admin.updateUserById(pro.id, { app_metadata: { plan: 'starter' } });
    expect(await evaluateTemplateRules(pro.id)).toBe(0);
    const { data: none } = await admin.from('template_runs').select('id').eq('transaction_id', dealId);
    expect(none ?? []).toHaveLength(0);

    await admin.auth.admin.updateUserById(pro.id, { app_metadata: { plan: 'pro' } });
    expect(await evaluateTemplateRules(pro.id)).toBeGreaterThanOrEqual(1);
  });
});
