// Thin client for the QuickBooks Online API (Intuit). Pure network code: no database, so it is easy to test.
// Relay only ever (a) finds the customer / product / invoice it needs by name or number, and
// (b) creates the customer, product, invoice and payment records it is responsible for.

const AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const SCOPE = 'com.intuit.quickbooks.accounting';
const MINOR_VERSION = '75';

export type QbEnvironment = 'production' | 'sandbox';

export const qbEnvironment = (): QbEnvironment => ((process.env.QUICKBOOKS_ENVIRONMENT || '').trim().toLowerCase() === 'sandbox' ? 'sandbox' : 'production');

const apiBase = (env: QbEnvironment) => (env === 'sandbox' ? 'https://sandbox-quickbooks.api.intuit.com' : 'https://quickbooks.api.intuit.com');

export function qbConfigured(): boolean {
  return Boolean(process.env.QUICKBOOKS_CLIENT_ID && process.env.QUICKBOOKS_CLIENT_SECRET);
}

function credentials() {
  const id = process.env.QUICKBOOKS_CLIENT_ID;
  const secret = process.env.QUICKBOOKS_CLIENT_SECRET;
  if (!id || !secret) throw new Error('QuickBooks is not set up on this server yet');
  return { id, secret, basic: Buffer.from(`${id}:${secret}`).toString('base64') };
}

/** Everyone, or only the people on a short list while the app is being reviewed by Intuit. */
export function quickbooksAvailableFor(email: string | null | undefined): boolean {
  if (!qbConfigured()) return false;
  if ((process.env.QUICKBOOKS_PUBLIC || '').trim().toLowerCase() === 'true') return true;
  const e = (email || '').trim().toLowerCase();
  if (!e) return false;
  return (process.env.QUICKBOOKS_BETA_EMAILS || '')
    .split(/[,\s;]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .includes(e);
}

export function getQbAuthUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({ client_id: credentials().id, response_type: 'code', scope: SCOPE, redirect_uri: redirectUri, state });
  return `${AUTH_URL}?${p.toString()}`;
}

export interface QbTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in?: number;
}

async function tokenRequest(body: Record<string, string>): Promise<QbTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials().basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body),
  });
  const text = await res.text();
  if (!res.ok) {
    // Intuit answers {"error":"invalid_grant"} for a revoked / expired / already-rotated token.
    throw new QbAuthError(`QuickBooks token request failed (${res.status}) ${text.slice(0, 200)}`, text.includes('invalid_grant'));
  }
  return JSON.parse(text) as QbTokens;
}

export class QbAuthError extends Error {
  constructor(message: string, public readonly invalidGrant = false) {
    super(message);
  }
}

export const exchangeQbCode = (code: string, redirectUri: string) => tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
export const refreshQbTokens = (refreshToken: string) => tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });

/** Best effort: tells Intuit to forget the grant. */
export async function revokeQbToken(token: string): Promise<void> {
  try {
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${credentials().basic}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token }),
    });
  } catch (e) {
    console.error('QuickBooks revoke failed (ignored):', e instanceof Error ? e.message : e);
  }
}

// ---------------------------------------------------------------------------

export class QbApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
  }
}

export interface QbClient {
  realmId: string;
  environment: QbEnvironment;
  accessToken: string;
}

async function call<T>(c: QbClient, method: 'GET' | 'POST', path: string, body?: unknown, query?: string): Promise<T> {
  const url = `${apiBase(c.environment)}/v3/company/${encodeURIComponent(c.realmId)}/${path}?${query ? `${query}&` : ''}minorversion=${MINOR_VERSION}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${c.accessToken}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (res.status === 401) throw new QbAuthError('QuickBooks rejected the access token');
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const fault = (json.Fault as { Error?: { Message?: string; Detail?: string; code?: string }[] } | undefined)?.Error?.[0];
    const msg = [fault?.Message, fault?.Detail].filter(Boolean).join(': ') || `QuickBooks returned ${res.status}`;
    throw new QbApiError(msg.slice(0, 300), res.status, fault?.code);
  }
  return json as T;
}

/** Escapes a value for a QuickBooks query string literal. */
export const qbQuote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

async function query<T>(c: QbClient, entity: string, sql: string): Promise<T[]> {
  const r = await call<{ QueryResponse?: Record<string, T[]> }>(c, 'GET', 'query', undefined, `query=${encodeURIComponent(sql)}`);
  return r.QueryResponse?.[entity] || [];
}

export async function getCompanyName(c: QbClient): Promise<string | null> {
  try {
    const r = await call<{ CompanyInfo?: { CompanyName?: string } }>(c, 'GET', `companyinfo/${encodeURIComponent(c.realmId)}`);
    return r.CompanyInfo?.CompanyName || null;
  } catch {
    return null;
  }
}

// ---- customers ----

export async function findOrCreateCustomer(c: QbClient, a: { name: string; email?: string | null; company?: string | null }): Promise<string> {
  const name = a.name.trim().slice(0, 100) || 'Unknown agent';
  const found = await query<{ Id: string }>(c, 'Customer', `select Id from Customer where DisplayName = ${qbQuote(name)}`);
  if (found[0]) return found[0].Id;
  const create = async (display: string) =>
    (
      await call<{ Customer: { Id: string } }>(c, 'POST', 'customer', {
        DisplayName: display,
        ...(a.company ? { CompanyName: a.company.slice(0, 100) } : {}),
        ...(a.email ? { PrimaryEmailAddr: { Address: a.email.slice(0, 100) } } : {}),
      })
    ).Customer.Id;
  try {
    return await create(name);
  } catch (e) {
    // 6240: the name is already used by a vendor or employee. Use a variant instead of failing.
    if (e instanceof QbApiError && e.code === '6240') return create(`${name} (agent)`.slice(0, 100));
    throw e;
  }
}

// ---- the product/service every invoice line uses ----

export async function ensureServiceItem(c: QbClient): Promise<string> {
  for (const name of ['Services', 'Transaction coordination fee']) {
    const items = await query<{ Id: string; Type?: string }>(c, 'Item', `select Id, Type from Item where Name = ${qbQuote(name)}`);
    const svc = items.find((i) => i.Type === 'Service') || items[0];
    if (svc) return svc.Id;
  }
  const accounts = await query<{ Id: string }>(c, 'Account', "select Id from Account where AccountType = 'Income' MAXRESULTS 1");
  if (!accounts[0]) throw new QbApiError('Your QuickBooks has no income account to file the fee under. Add one, then try again.', 400);
  const r = await call<{ Item: { Id: string } }>(c, 'POST', 'item', {
    Name: 'Transaction coordination fee',
    Type: 'Service',
    IncomeAccountRef: { value: accounts[0].Id },
  });
  return r.Item.Id;
}

// ---- invoices and payments ----

export interface QbInvoiceInput {
  docNumber: string;
  customerId: string;
  itemId: string;
  amount: number;
  date: string; // YYYY-MM-DD
  dueDate: string;
  description: string;
  note?: string;
}

const money = (n: number) => Math.round(n * 100) / 100;

/** The QuickBooks invoice with this number, if there is one (used so we never create a second copy of an invoice that is already there). */
export async function findInvoiceByNumber(c: QbClient, docNumber: string): Promise<{ id: string; balance: number; total: number } | null> {
  const r = await query<{ Id: string; Balance: number; TotalAmt: number }>(c, 'Invoice', `select Id, Balance, TotalAmt from Invoice where DocNumber = ${qbQuote(docNumber)}`);
  return r[0] ? { id: r[0].Id, balance: Number(r[0].Balance), total: Number(r[0].TotalAmt) } : null;
}

export async function createInvoice(c: QbClient, i: QbInvoiceInput): Promise<string> {
  const amount = money(i.amount);
  const r = await call<{ Invoice: { Id: string } }>(c, 'POST', 'invoice', {
    DocNumber: i.docNumber.slice(0, 21),
    TxnDate: i.date,
    DueDate: i.dueDate,
    CustomerRef: { value: i.customerId },
    PrivateNote: i.note || 'Created by Relay TC',
    Line: [
      {
        Amount: amount,
        Description: i.description.slice(0, 4000),
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: { ItemRef: { value: i.itemId }, Qty: 1, UnitPrice: amount },
      },
    ],
  });
  return r.Invoice.Id;
}

export async function getInvoiceBalance(c: QbClient, id: string): Promise<{ balance: number; total: number }> {
  const r = await call<{ Invoice: { Balance: number; TotalAmt: number } }>(c, 'GET', `invoice/${encodeURIComponent(id)}`);
  return { balance: Number(r.Invoice.Balance), total: Number(r.Invoice.TotalAmt) };
}

export async function createPayment(c: QbClient, p: { customerId: string; invoiceId: string; amount: number; date: string; ref?: string; note?: string }): Promise<string> {
  const amount = money(p.amount);
  const r = await call<{ Payment: { Id: string } }>(c, 'POST', 'payment', {
    CustomerRef: { value: p.customerId },
    TotalAmt: amount,
    TxnDate: p.date,
    ...(p.ref ? { PaymentRefNum: p.ref.slice(0, 21) } : {}),
    PrivateNote: p.note || 'Recorded by Relay TC',
    Line: [{ Amount: amount, LinkedTxn: [{ TxnId: p.invoiceId, TxnType: 'Invoice' }] }],
  });
  return r.Payment.Id;
}
