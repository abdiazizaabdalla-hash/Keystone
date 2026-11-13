import { afterEach, describe, expect, it } from 'vitest';
import { assertInvoiceSender } from '@/lib/workspaceInvoices';

// Who may write invoices to anyone: a coordinator only while `other_invoices` (or the agent workspace) is on.
const original = process.env.RELAY_FEATURES;
afterEach(() => {
  if (original === undefined) delete process.env.RELAY_FEATURES;
  else process.env.RELAY_FEATURES = original;
});
const coordinator = { app_metadata: { plan: 'pro' } };

describe('invoices to anyone: who may send', () => {
  it('a coordinator is refused while the feature is off', () => {
    process.env.RELAY_FEATURES = '';
    expect(() => assertInvoiceSender(coordinator)).toThrow();
  });
  it('a coordinator is allowed once other_invoices is on', () => {
    process.env.RELAY_FEATURES = 'other_invoices';
    expect(() => assertInvoiceSender(coordinator)).not.toThrow();
  });
  it('the other flags alone (templates, automation) do not open it', () => {
    process.env.RELAY_FEATURES = 'templates,automation';
    expect(() => assertInvoiceSender(coordinator)).toThrow();
  });
});
