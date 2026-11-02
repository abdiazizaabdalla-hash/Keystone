import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as createAgentInvite } from '@/app/api/agent-invites/route';
import { POST as createTemplate } from '@/app/api/checklist-templates/route';
import { PATCH as patchTemplate, DELETE as deleteTemplate } from '@/app/api/checklist-templates/[id]/route';
import { POST as gcalStart } from '@/app/api/google-calendar/start/route';
import { POST as gcalSync } from '@/app/api/google-calendar/sync/route';
import { POST as gcalDisconnect } from '@/app/api/google-calendar/disconnect/route';
import { PATCH as patchSigning } from '@/app/api/signing-requests/[id]/route';
import { POST as teamPost, PATCH as teamPatch, DELETE as teamDelete } from '@/app/api/team/route';
import { POST as teamMessage } from '@/app/api/team/messages/route';
import { DELETE as teamMessageDelete } from '@/app/api/team/messages/[id]/route';
import { POST as teamMessagesRead } from '@/app/api/team/messages/read/route';
import { DELETE as inboundDelete } from '@/app/api/email/inbound/route';
import { POST as stripeCheckout } from '@/app/api/stripe/checkout/route';
import { POST as stripeConnectStart } from '@/app/api/stripe/connect/start/route';
import { POST as stripePortal } from '@/app/api/stripe/portal/route';
import { call, cleanup, createActor, createCollaborator, type Actor } from './helpers';

// Routes that create or change a coordinator's own work. A free agent portal login
// (an invited collaborator) must be refused on every one of them.

type Handler = Parameters<typeof call>[0];
const SOME_ID = '00000000-0000-0000-0000-000000000000';

const WORKSPACE_ROUTES: { name: string; handler: Handler; method: string; path: string; params?: Record<string, string>; body?: unknown }[] = [
  { name: 'invite an agent to a deal', handler: createAgentInvite as unknown as Handler, method: 'POST', path: '/api/agent-invites', body: {} },
  { name: 'create a checklist template', handler: createTemplate as unknown as Handler, method: 'POST', path: '/api/checklist-templates', body: { name: 'X', steps: [] } },
  { name: 'edit a checklist template', handler: patchTemplate as unknown as Handler, method: 'PATCH', path: `/api/checklist-templates/${SOME_ID}`, params: { id: SOME_ID }, body: { name: 'Y' } },
  { name: 'delete a checklist template', handler: deleteTemplate as unknown as Handler, method: 'DELETE', path: `/api/checklist-templates/${SOME_ID}`, params: { id: SOME_ID } },
  { name: 'start Google Calendar sync', handler: gcalStart as unknown as Handler, method: 'POST', path: '/api/google-calendar/start', body: {} },
  { name: 'run Google Calendar sync', handler: gcalSync as unknown as Handler, method: 'POST', path: '/api/google-calendar/sync', body: {} },
  { name: 'disconnect Google Calendar', handler: gcalDisconnect as unknown as Handler, method: 'POST', path: '/api/google-calendar/disconnect', body: {} },
  { name: 'void a signing request', handler: patchSigning as unknown as Handler, method: 'PATCH', path: `/api/signing-requests/${SOME_ID}`, params: { id: SOME_ID }, body: { action: 'void' } },
  { name: 'create or join a team', handler: teamPost as unknown as Handler, method: 'POST', path: '/api/team', body: {} },
  { name: 'change a team', handler: teamPatch as unknown as Handler, method: 'PATCH', path: '/api/team', body: {} },
  { name: 'delete from a team', handler: teamDelete as unknown as Handler, method: 'DELETE', path: '/api/team', body: {} },
  { name: 'post a team message', handler: teamMessage as unknown as Handler, method: 'POST', path: '/api/team/messages', body: { body: 'hi', thread: 'board' } },
  { name: 'delete a team message', handler: teamMessageDelete as unknown as Handler, method: 'DELETE', path: `/api/team/messages/${SOME_ID}`, params: { id: SOME_ID } },
  { name: 'mark team messages read', handler: teamMessagesRead as unknown as Handler, method: 'POST', path: '/api/team/messages/read', body: { thread: 'board' } },
  { name: 'delete incoming email', handler: inboundDelete as unknown as Handler, method: 'DELETE', path: '/api/email/inbound', body: {} },
  { name: 'start a Stripe checkout', handler: stripeCheckout as unknown as Handler, method: 'POST', path: '/api/stripe/checkout', body: { plan: 'starter' } },
  { name: 'start Stripe payout onboarding', handler: stripeConnectStart as unknown as Handler, method: 'POST', path: '/api/stripe/connect/start', body: {} },
  { name: 'open the Stripe billing portal', handler: stripePortal as unknown as Handler, method: 'POST', path: '/api/stripe/portal', body: {} },
];

let collaborator: Actor;
let tc: Actor;

beforeAll(async () => {
  collaborator = await createCollaborator('collab-routes');
  tc = await createActor('tc-routes', { plan: 'pro' });
});

afterAll(async () => {
  await cleanup();
});

describe('free collaborator is refused on coordinator-only routes', () => {
  it.each(WORKSPACE_ROUTES)('cannot $name', async ({ handler, method, path, params, body }) => {
    const res = await call(handler, collaborator, { method, path, params, body });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.json)).toContain('Agent portal accounts');
  });
});

describe('the same routes still reach a real coordinator (the guard is not a blanket block)', () => {
  it("a coordinator's template request is not refused as a collaborator", async () => {
    const res = await call(createTemplate as unknown as Handler, tc, { method: 'POST', path: '/api/checklist-templates', body: { name: 'Mine', steps: [] } });
    expect(JSON.stringify(res.json ?? '')).not.toContain('Agent portal accounts');
    expect([401, 403]).not.toContain(res.status);
  });

  it("a coordinator's team message request is not refused as a collaborator", async () => {
    const res = await call(teamMessage as unknown as Handler, tc, { method: 'POST', path: '/api/team/messages', body: { body: 'hi', thread: 'board' } });
    expect(JSON.stringify(res.json ?? '')).not.toContain('Agent portal accounts');
  });
});
