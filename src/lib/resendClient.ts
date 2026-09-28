import { Resend } from 'resend';

// Lazily constructed so a missing RESEND_API_KEY during local dev doesn't
// crash anything at module-import time — only the /send route needs it,
// and it will surface a clear error if the key isn't set yet.
let client: Resend | null = null;

export function getResendClient(): Resend {
  if (!client) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error(
        'RESEND_API_KEY is not set. Add it to .env.local to enable emailing invoices.'
      );
    }
    client = new Resend(apiKey);
  }
  return client;
}

export const INVOICE_FROM_EMAIL =
  process.env.INVOICE_FROM_EMAIL || 'Relay TC <onboarding@resend.dev>';
