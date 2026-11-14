import { describe, expect, it } from 'vitest';
import { FakeBuilderClient, draftAutomation, parseDraft, type BuilderDeps } from '@/lib/automation/builderCore';

const deps = (client: FakeBuilderClient, over: Partial<BuilderDeps> = {}): BuilderDeps & { used: number[] } => {
  const used: number[] = [];
  return { client, model: 'm', featureOn: true, tokensUsedThisMonth: async () => 0, monthlyTokenCap: 1000, logUsage: async (_o, _m, u) => void used.push((u?.input_tokens ?? 0) + (u?.output_tokens ?? 0)), used, ...over };
};
const good = {
  name: 'Appraisal nudge', description: 'd', category: 'transaction', triggerType: 'closing_date',
  steps: [{ id: 's1', type: 'notify_me', when: { days: 5, direction: 'before' }, title: 'Appraisal?', condition: { type: 'key_date_open', kind: 'appraisal' } }],
  questions: [], unsupported: [],
};

describe('draftAutomation', () => {
  it('returns a validated draft, logs usage, and fences the request as data', async () => {
    const client = new FakeBuilderClient(good);
    const d = deps(client);
    const out = await draftAutomation({ ownerUserId: 'u', request: 'Notify me 5 days before closing if the appraisal is not done' }, d);
    expect(out.ok && out.draft?.steps[0].condition).toEqual({ type: 'key_date_open', kind: 'appraisal' });
    expect(d.used).toEqual([280]);
    expect(client.calls[0].prompt).toMatch(/<untrusted/i);
    expect(client.calls[0].system).toMatch(/Never invent a recipient/);
  });

  it('refuses a draft that uses anything outside the catalog, instead of repairing it', () => {
    const bad = (patch: Record<string, unknown>) => parseDraft({ ...good, steps: [{ ...good.steps[0], ...patch }] });
    expect(bad({ type: 'update_deal_status' }).draft).toBeNull();
    expect(bad({ type: 'send_email', to: ['someone@evil.test'], subject: 's', message: 'm' }).draft).toBeNull();
    expect(bad({ condition: { type: 'run_sql', text: 'drop table' } }).draft).toBeNull();
    expect(bad({ when: { days: 5, direction: 'before' } }).draft).not.toBeNull();
    expect(parseDraft({ ...good, triggerType: 'made_up_trigger' }).draft).toBeNull();
    expect(parseDraft({ ...good, triggerType: 'listing_created' }).problem).toMatch(/not usable/);
    expect(parseDraft(null).problem).toMatch(/could not draft/);
  });

  it('passes questions and unsupported parts through when there is nothing to draft', () => {
    const r = parseDraft({ steps: [], questions: ['Which date should this count from?'], unsupported: ['Texting the seller'] });
    expect(r).toMatchObject({ draft: null, problem: null, questions: ['Which date should this count from?'], unsupported: ['Texting the seller'] });
  });

  it('respects the feature flag and the monthly allowance, and survives a model failure', async () => {
    const client = new FakeBuilderClient(good);
    expect(await draftAutomation({ ownerUserId: 'u', request: 'x' }, deps(client, { featureOn: false }))).toEqual({ ok: false, reason: 'feature_off' });
    expect(await draftAutomation({ ownerUserId: 'u', request: 'x' }, deps(client, { tokensUsedThisMonth: async () => 1000 }))).toEqual({ ok: false, reason: 'monthly_cap_reached' });
    expect(client.calls).toHaveLength(0);
    const broken = new FakeBuilderClient(() => { throw new Error('down'); });
    expect(await draftAutomation({ ownerUserId: 'u', request: 'x' }, deps(broken))).toEqual({ ok: false, reason: 'model_error' });
  });
});
