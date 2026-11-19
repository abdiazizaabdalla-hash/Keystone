import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as getTrec } from '@/app/api/templates/trec/route';
import { DELETE as unpin, GET as listPins, POST as pin } from '@/app/api/templates/pins/route';
import { POST as createTemplate } from '@/app/api/templates/route';
import { admin, call, cleanup, createActor, createCollaborator, type Actor } from './helpers';

// The Texas folder (TREC's forms as links) and pins. The TREC list is seeded here so nothing reaches out to TREC.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let tc: Actor;
let other: Actor;
let free: Actor;
const SLUG = 'zz-test-form-one';
let originalStatus: Record<string, unknown> | null = null;

beforeAll(async () => {
  tc = await createActor('p-tc', { plan: 'pro' });
  other = await createActor('p-other', { plan: 'pro' });
  free = await createCollaborator('p-free');
  const { data } = await admin.from('trec_catalog_status').select('*').eq('id', 1).maybeSingle();
  originalStatus = data;
  // Looks freshly checked, so the route does not go to TREC.
  await admin.from('trec_catalog_status').upsert({ id: 1, last_checked_at: new Date().toISOString(), last_ok_at: new Date().toISOString(), last_error: null });
  await admin.from('trec_forms').upsert({ slug: SLUG, name: 'ZZ Test Form', form_id: '99-1', section: 'contracts', effective_date: '2026-07-01', previous_form_id: '99-0', changed_at: new Date().toISOString() });
});
afterAll(async () => {
  await admin.from('trec_forms').delete().eq('slug', SLUG);
  if (originalStatus) await admin.from('trec_catalog_status').upsert(originalStatus);
  else await admin.from('trec_catalog_status').delete().eq('id', 1);
  await cleanup();
});

const pinCall = (who: Actor, body: Record<string, unknown>) => call(h(pin), who, { method: 'POST', path: '/api/templates/pins', body });
const pins = async (who: Actor) => (await call(h(listPins), who, { method: 'GET', path: '/api/templates/pins' })).json as Array<{ kind: string; ref: string }>;

describe('the Texas list', () => {
  it('gives each form with a link to TREC’s own page and what changed', async () => {
    const res = await call(h(getTrec), tc, { method: 'GET', path: '/api/templates/trec' });
    expect(res.status).toBe(200);
    const body = res.json as { forms: Array<{ slug: string; url: string; formId: string; previousFormId: string | null; pinned: boolean }>; lastError: string | null };
    const form = body.forms.find((f) => f.slug === SLUG)!;
    expect(form.url).toBe(`https://www.trec.texas.gov/forms/${SLUG}`);
    expect(form.formId).toBe('99-1');
    expect(form.previousFormId).toBe('99-0');
    expect(form.pinned).toBe(false);
  });

  it('is for coordinators and workspace agents, not free invited agents or signed-out visitors', async () => {
    expect((await call(h(getTrec), free, { method: 'GET', path: '/api/templates/trec' })).status).toBe(403);
    expect((await call(h(getTrec), null, { method: 'GET', path: '/api/templates/trec' })).status).toBe(401);
  });
});

describe('pins', () => {
  it('pins a state folder, a template and a TREC form, privately', async () => {
    const tpl = ((await call(h(createTemplate), tc, { method: 'POST', path: '/api/templates', body: { kind: 'letter', name: 'Pinned letter', body: 'x' } })).json as { id: string }).id;
    expect((await pinCall(tc, { kind: 'folder', ref: 'TX' })).status).toBe(201);
    expect((await pinCall(tc, { kind: 'folder', ref: 'TX' })).status).toBe(201); // twice is fine
    expect((await pinCall(tc, { kind: 'folder', ref: 'CA' })).status).toBe(201);
    expect((await pinCall(tc, { kind: 'template', ref: tpl })).status).toBe(201);
    expect((await pinCall(tc, { kind: 'trec', ref: SLUG })).status).toBe(201);
    expect((await pins(tc)).map((p) => `${p.kind}:${p.ref}`).sort()).toEqual([`folder:CA`, `folder:TX`, `template:${tpl}`, `trec:${SLUG}`].sort());
    expect((await pins(other)).length).toBe(0);
    const trec = (await call(h(getTrec), tc, { method: 'GET', path: '/api/templates/trec' })).json as { forms: Array<{ slug: string; pinned: boolean }> };
    expect(trec.forms.find((f) => f.slug === SLUG)!.pinned).toBe(true);
    // someone else's template cannot be pinned
    expect((await pinCall(other, { kind: 'template', ref: tpl })).status).toBe(404);
  });

  it('refuses nonsense', async () => {
    expect((await pinCall(tc, { kind: 'folder', ref: 'ZZ' })).status).toBe(400);
    expect((await pinCall(tc, { kind: 'folder', ref: 'every' })).status).toBe(400);
    expect((await pinCall(tc, { kind: 'banana', ref: 'TX' })).status).toBe(400);
    expect((await pinCall(tc, { kind: 'trec', ref: 'no-such-form' })).status).toBe(404);
    expect((await pinCall(free, { kind: 'folder', ref: 'TX' })).status).toBe(403);
  });

  it('unpins', async () => {
    expect((await call(h(unpin), tc, { method: 'DELETE', path: '/api/templates/pins?kind=folder&ref=TX' })).status).toBe(200);
    expect((await pins(tc)).some((p) => p.kind === 'folder' && p.ref === 'TX')).toBe(false);
    expect((await call(h(unpin), tc, { method: 'DELETE', path: '/api/templates/pins?kind=folder' })).status).toBe(400);
  });
});
