import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as listFolders, POST as createFolder } from '@/app/api/templates/folders/route';
import { DELETE as deleteFolder, PATCH as renameFolder } from '@/app/api/templates/folders/[id]/route';
import { DELETE as removeItem, POST as addItem } from '@/app/api/templates/folders/[id]/items/route';
import { GET as listPins, POST as pin } from '@/app/api/templates/pins/route';
import { POST as createTemplate } from '@/app/api/templates/route';
import { admin, call, cleanup, createActor, createCollaborator, type Actor } from './helpers';

// Custom folders: make, rename, fill with documents / TREC forms / state sources, delete. Private to the owner.

type Handler = Parameters<typeof call>[0];
const h = (fn: unknown) => fn as Handler;

let tc: Actor;
let other: Actor;
let free: Actor;
const SLUG = 'zz-folder-form';

beforeAll(async () => {
  tc = await createActor('f-tc', { plan: 'pro' });
  other = await createActor('f-other', { plan: 'pro' });
  free = await createCollaborator('f-free');
  await admin.from('trec_forms').upsert({ slug: SLUG, name: 'ZZ Folder Form', form_id: '98-1', section: 'contracts', effective_date: '2026-07-01' });
});
afterAll(async () => {
  await admin.from('trec_forms').delete().eq('slug', SLUG);
  await cleanup();
});

const make = (who: Actor, name: unknown) => call(h(createFolder), who, { method: 'POST', path: '/api/templates/folders', body: { name } });
const list = async (who: Actor) => (await call(h(listFolders), who, { method: 'GET', path: '/api/templates/folders' })).json as Array<{ id: string; name: string; items: Array<{ kind: string; ref: string }> }>;
const add = (who: Actor, id: string, body: Record<string, unknown>) => call(h(addItem), who, { method: 'POST', path: `/api/templates/folders/${id}/items`, body, params: { id } });

describe('custom folders', () => {
  it('makes, lists, renames and deletes a folder, and refuses a duplicate or empty name', async () => {
    const res = await make(tc, '  Listing   day ');
    expect(res.status).toBe(201);
    const id = (res.json as { id: string; name: string }).id;
    expect((res.json as { name: string }).name).toBe('Listing day');
    expect((await make(tc, 'listing DAY')).status).toBe(409);
    expect((await make(tc, '   ')).status).toBe(400);
    expect((await make(other, 'Listing day')).status).toBe(201); // someone else may use the same name
    expect((await list(tc)).map((f) => f.name)).toEqual(['Listing day']);

    const rename = await call(h(renameFolder), tc, { method: 'PATCH', path: `/api/templates/folders/${id}`, body: { name: 'Listing packet' }, params: { id } });
    expect(rename.status).toBe(200);
    expect((await list(tc))[0].name).toBe('Listing packet');
    expect((await call(h(renameFolder), other, { method: 'PATCH', path: `/api/templates/folders/${id}`, body: { name: 'x' }, params: { id } })).status).toBe(404);

    expect((await call(h(deleteFolder), other, { method: 'DELETE', path: `/api/templates/folders/${id}`, params: { id } })).status).toBe(404);
    expect((await call(h(deleteFolder), tc, { method: 'DELETE', path: `/api/templates/folders/${id}`, params: { id } })).status).toBe(200);
    expect(await list(tc)).toHaveLength(0);
  });

  it('holds your documents, TREC forms and state sources, and only those', async () => {
    const id = ((await make(tc, 'Everyday')).json as { id: string }).id;
    const tpl = ((await call(h(createTemplate), tc, { method: 'POST', path: '/api/templates', body: { kind: 'letter', name: 'Folder letter', body: 'x' } })).json as { id: string }).id;
    expect((await add(tc, id, { kind: 'template', ref: tpl })).status).toBe(201);
    expect((await add(tc, id, { kind: 'template', ref: tpl })).status).toBe(201); // twice is fine
    expect((await add(tc, id, { kind: 'trec', ref: SLUG })).status).toBe(201);
    expect((await add(tc, id, { kind: 'source', ref: 'co-dre' })).status).toBe(201);
    const items = (await list(tc)).find((f) => f.id === id)!.items.map((i) => `${i.kind}:${i.ref}`).sort();
    expect(items).toEqual([`source:co-dre`, `template:${tpl}`, `trec:${SLUG}`].sort());

    expect((await add(tc, id, { kind: 'source', ref: 'no-such-source' })).status).toBe(404);
    expect((await add(tc, id, { kind: 'trec', ref: 'no-such-form' })).status).toBe(404);
    expect((await add(tc, id, { kind: 'banana', ref: 'x' })).status).toBe(400);
    expect((await add(other, id, { kind: 'source', ref: 'co-dre' })).status).toBe(404); // not their folder
    const otherFolder = ((await make(other, 'Theirs')).json as { id: string }).id;
    expect((await add(other, otherFolder, { kind: 'template', ref: tpl })).status).toBe(404); // not their template

    const rm = await call(h(removeItem), tc, { method: 'DELETE', path: `/api/templates/folders/${id}/items?kind=source&ref=co-dre`, params: { id } });
    expect(rm.status).toBe(200);
    expect((await list(tc)).find((f) => f.id === id)!.items).toHaveLength(2);
  });

  it('is for coordinators and workspace agents, and a folder can be pinned and goes when deleted', async () => {
    expect((await make(free, 'No')).status).toBe(403);
    expect((await call(h(listFolders), null, { method: 'GET', path: '/api/templates/folders' })).status).toBe(401);
    const id = ((await make(tc, 'Pin me')).json as { id: string }).id;
    const p = (who: Actor, body: Record<string, unknown>) => call(h(pin), who, { method: 'POST', path: '/api/templates/pins', body });
    expect((await p(tc, { kind: 'custom', ref: id })).status).toBe(201);
    expect((await p(other, { kind: 'custom', ref: id })).status).toBe(404);
    expect((await p(tc, { kind: 'source', ref: 'la-forms' })).status).toBe(201);
    expect((await p(tc, { kind: 'source', ref: 'nope' })).status).toBe(404);
    await call(h(deleteFolder), tc, { method: 'DELETE', path: `/api/templates/folders/${id}`, params: { id } });
    const pins = (await call(h(listPins), tc, { method: 'GET', path: '/api/templates/pins' })).json as Array<{ kind: string; ref: string }>;
    expect(pins.find((x) => x.kind === 'custom' && x.ref === id)).toBeUndefined();
  });
});
