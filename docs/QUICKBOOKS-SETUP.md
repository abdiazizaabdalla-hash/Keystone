# QuickBooks Online connection: setup

The connection is built and switched off. Nothing changes for anyone until the keys below are set.

## What it does
When a coordinator connects QuickBooks Online (Settings → QuickBooks Online):
- an invoice created in Relay is created in QuickBooks, under the agent as a customer;
- when that invoice is paid in Relay (a Stripe payment, or marked paid), a payment is recorded on the QuickBooks invoice;
- an invoice whose number already exists in QuickBooks (for example, imported earlier from a file) is linked, never duplicated;
- invoices that came from QuickBooks (`QB-` numbers) and $0 invoices are not sent.

It never edits or deletes anything in QuickBooks. Refunds, edits to an invoice after it was sent, and Stripe fees/payouts are not synced.

## 1. Create the Intuit app (you do this, in your own Intuit account)
1. Sign in at https://developer.intuit.com and create an app: **QuickBooks Online and Payments**.
2. Scope: **Accounting** only (`com.intuit.quickbooks.accounting`).
3. Keys & credentials → **Development** keys first. Add this Redirect URI:
   - `https://www.relaytc.com/api/quickbooks/callback`
   - for local testing also `http://localhost:3000/api/quickbooks/callback` (development keys only)
4. Copy the Client ID and Client Secret. Do not paste the secret into chat or commit it.

## 2. Environment variables (Vercel → Settings → Environment Variables)
| Name | Value |
|---|---|
| `QUICKBOOKS_CLIENT_ID` | from Intuit (mark **Sensitive**) |
| `QUICKBOOKS_CLIENT_SECRET` | from Intuit (mark **Sensitive**) |
| `QUICKBOOKS_ENVIRONMENT` | `sandbox` while testing with development keys, `production` after approval |
| `QUICKBOOKS_BETA_EMAILS` | comma-separated Relay login emails allowed to see the Connect button |
| `QUICKBOOKS_PUBLIC` | set to `true` only after Intuit approves the app (everyone sees the button) |

`HELCIM_TOKEN_ENCRYPTION_KEY` (already set) is used to encrypt the QuickBooks tokens.

## 3. Database
Run `add-quickbooks-sync.sql` once in the Supabase SQL editor (safe to run twice).

## 4. Test in the sandbox
1. Deploy, then sign in as an email on `QUICKBOOKS_BETA_EMAILS`.
2. Settings → QuickBooks Online → Connect. Pick the sandbox company Intuit created for you.
3. Create an invoice in Relay: it should appear in the sandbox company with its number, then show "In QuickBooks" on the Invoices page.
4. Mark it paid (or pay it through Stripe test mode): the QuickBooks invoice balance should drop to $0 with a payment recorded.
5. Use "Send my invoices" to send older invoices. Failed ones show "QuickBooks: action needed" with the reason.

## 5. Go live
1. In the Intuit portal complete the app assessment (security questionnaire; they ask about token storage, data retention and SOC 2 status; typically 1–3 weeks). Answers that apply:
   - Tokens are encrypted at rest (AES-256-GCM) and never sent to the browser or logged.
   - Data kept: company ID/name, QuickBooks IDs of the customers/invoices/payments Relay created, and sync error notes. Deleted on disconnect.
   - Relay only creates customers, one product/service, invoices and payments; it never edits or deletes.
   - Privacy policy: https://www.relaytc.com/privacy ("QuickBooks data").
2. Switch to **Production** keys, set `QUICKBOOKS_ENVIRONMENT=production`, redeploy.
3. Set `QUICKBOOKS_PUBLIC=true` after approval.
4. Add the production Redirect URI (HTTPS) in the Intuit app settings.

## Notes
- Intuit rotates the refresh token every time it is used, and an unused one expires after 100 days; Relay saves the new one each time and shows "Reconnect" if Intuit ends the connection.
- If a QuickBooks company uses automated sales tax, or has no income account, the first send can fail with a clear message on the invoice.
