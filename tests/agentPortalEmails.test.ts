import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A fake Resend client and a fake database, so the checks below run without any network.
const send = vi.fn();
const getResendClient = vi.fn(() => ({ emails: { send } }));
vi.mock('@/lib/resendClient', () => ({ getResendClient: () => getResendClient(), INVOICE_FROM_EMAIL: 'Relay TC <test@relay.test>' }));

const insert = vi.fn();
const from = vi.fn((_table: string) => ({ insert }));
vi.mock('@/lib/supabase', () => ({ supabase: {}, supabaseServer: { from: (t: string) => from(t) } }));

import { deliverEmail, EmailDeliveryError, htmlToText, sendTcInviteEmail, sendAgentInviteEmail } from '@/lib/agentPortalEmails';

const msg = { source: 'test', from: 'Relay TC <test@relay.test>', to: 'a@example.com', subject: 'Hello', html: '<p>Hi</p>' };

beforeEach(() => {
  send.mockReset();
  insert.mockReset();
  from.mockClear();
  getResendClient.mockClear();
  getResendClient.mockImplementation(() => ({ emails: { send } }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('deliverEmail: a refused send is never reported as sent', () => {
  it('sends through Resend and resolves when Resend accepts it', async () => {
    send.mockResolvedValue({ data: { id: 'e1' }, error: null });
    await expect(deliverEmail({ ...msg, replyTo: 'r@example.com' })).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ from: msg.from, to: msg.to, subject: msg.subject, html: msg.html, replyTo: 'r@example.com' });
  });

  it('throws when Resend returns an error result (the bug: the SDK does not throw, it returns { error })', async () => {
    send.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'The domain is not verified' } });
    await expect(deliverEmail(msg)).rejects.toBeInstanceOf(EmailDeliveryError);
  });

  it('throws when the Resend call itself fails or the key is missing', async () => {
    send.mockRejectedValue(new Error('network down'));
    await expect(deliverEmail(msg)).rejects.toBeInstanceOf(EmailDeliveryError);
    getResendClient.mockImplementation(() => {
      throw new Error('RESEND_API_KEY is not set');
    });
    await expect(deliverEmail(msg)).rejects.toBeInstanceOf(EmailDeliveryError);
  });
});

describe('deliverEmail: RELAY_OUTBOX_ONLY=1 never sends', () => {
  beforeEach(() => vi.stubEnv('RELAY_OUTBOX_ONLY', '1'));

  it('records the email in email_outbox under the sender and does not call Resend', async () => {
    insert.mockResolvedValue({ error: null });
    await deliverEmail({ ...msg, ownerUserId: 'owner-1' });
    expect(send).not.toHaveBeenCalled();
    expect(getResendClient).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith('email_outbox');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ owner_user_id: 'owner-1', source: 'test', to_emails: ['a@example.com'], subject: 'Hello', body: 'Hi' })
    );
  });

  it('only logs (no database row, no send) when nobody owns the outbox entry', async () => {
    await deliverEmail(msg);
    expect(send).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('throws when the outbox row cannot be written', async () => {
    insert.mockResolvedValue({ error: { message: 'relation "email_outbox" does not exist' } });
    await expect(deliverEmail({ ...msg, ownerUserId: 'owner-1' })).rejects.toBeInstanceOf(EmailDeliveryError);
  });
});

describe('htmlToText', () => {
  it('keeps the link address and drops the markup', () => {
    const text = htmlToText('<h2>Title</h2><p>Click <a href="https://app.test/auth" style="x">Sign in</a> now &amp; go</p><p>Bye</p>');
    expect(text).toContain('Sign in (https://app.test/auth)');
    expect(text).toContain('now & go');
    expect(text).not.toMatch(/<|>/);
  });
});

describe('the invitation emails use the checked path', () => {
  it('the coordinator invitation reaches the sender’s test outbox with the sign-in link readable', async () => {
    vi.stubEnv('RELAY_OUTBOX_ONLY', '1');
    insert.mockResolvedValue({ error: null });
    await sendTcInviteEmail({ toEmail: 'tc@example.com', agentLabel: 'Pat Agent', propertyAddress: '12 Oak St', appUrl: 'http://localhost:3000', ownerUserId: 'agent-1' });
    const row = insert.mock.calls[0][0];
    expect(row).toMatchObject({ owner_user_id: 'agent-1', source: 'sendTcInviteEmail', to_emails: ['tc@example.com'] });
    expect(row.subject).toContain('Pat Agent');
    expect(row.body).toContain('http://localhost:3000/auth');
  });

  it('a rejected invitation email makes the sender throw, so the invite flow can say it was not sent', async () => {
    send.mockResolvedValue({ data: null, error: { name: 'x', message: 'rejected' } });
    await expect(sendTcInviteEmail({ toEmail: 'tc@example.com', agentLabel: 'Pat', propertyAddress: null, appUrl: 'https://app.test' })).rejects.toBeInstanceOf(EmailDeliveryError);
    await expect(
      sendAgentInviteEmail({ toEmail: 'ag@example.com', tcLabel: 'Sam TC', propertyAddress: null, loginUrl: 'https://app.test/agent/login' })
    ).rejects.toBeInstanceOf(EmailDeliveryError);
  });
});
