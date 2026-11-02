# Production schema reconciliation

Source: structure-only query run in the production Supabase SQL editor on 2026-11-02 (columns, constraints, indexes, row-level-security flags). No customer data. The raw output is not stored in the repo; the findings below are what matter for the expansion.

## Summary

- 55 public tables exist in production. Row-level security is **on for every one** (matches `lock-down-database-access.sql`), so all access is through server code with the service-role key.
- Five production tables have no `create table` anywhere in the repo: `documents`, `stripe_customers`, `teams`, `team_members`, `team_invites`. Their real structure is now known (below).
- Two tables are defined in the repo but **do not exist in production**: `audit_log` and `statements`.

## Findings that change the plan

1. **`audit_log` does not exist in production.** `src/lib/audit.ts` writes to it, but a failed write is only logged to the console, so production currently has **no audit trail**. The implementation plan relies on it for transaction events. Action: run `add-audit-log.sql` (additive, creates one table) before Phase 3. This is a production step for you; I have not run anything.
2. **`statements` is not in production** and nothing in `src/` reads it. Treat as dead; no action.
3. **`transactions` has no foreign keys at all.** `agent_id` is NOT NULL but not constrained to `agents`, and `tc_user_id` is nullable and not tied to `auth.users`. New participant tables should reference `transactions(id)`; I will not add foreign keys to the existing table (backfill risk).
4. **`invoices` cannot hold an agent-style invoice.** `invoices.agent_id` and `invoices.transaction_id` are both NOT NULL, there is one `amount_owed` number and no line items, and no owner column (ownership is derived through the transaction). Agent invoices that bill anyone, with custom line items and sometimes no deal, need a new table (recommended: `workspace_invoices` plus `workspace_invoice_lines`), not a change to `invoices`. The TC invoice path stays untouched.
5. **`stripe_customers` is one row per user** (primary key `user_id`, unique `stripe_customer_id`, one `plan` and one `stripe_subscription_id`). A person cannot hold two subscriptions today, which confirms "one independent workspace per login" for v1. It is also where agent billing will have to land.
6. **`team_members.user_id` is unique**, so a user can be in only one team. `teams` has no plan column; the plan comes from the owner's account.
7. **`messages.sender_role` is limited to `tc` or `agent`.** Deal messaging between a paying agent (owner) and a TC participant fits, but any third role (assistant, viewer) needs a constraint change, so those roles stay out of v1.
8. **`agent_invites.status` allows only `pending` and `accepted`**, and `transaction_agents` is unique on (transaction, user). Both match the plan's dual-write approach.
9. **`users` is a legacy table** with a `password_hash` column and a `TC`/`Agent` role check. Nothing in `src/` reads it (all logins are Supabase Auth). Action later, with your approval: check it is empty and retire it. Not touched.
10. **`documents` has no foreign key to `transactions` and no owner column**; access is decided in code through the transaction. Same for `tasks` (it has the FK) and `transaction_emails`. This is why authorization has to be central.
11. **Invoice payments have two providers:** `invoices.helcim_*` columns and `payment_accounts.provider = 'stripe_connect'` (also `helcim`). The plan's "pay through Stripe Connect" should read "through the same payment-account setup the TC invoices use".
12. **Third-party credentials** (`quickbooks_connections.access_token/refresh_token`, `calendar_connections.refresh_token`) are plain `text` columns. `src/lib/encryption.ts` exists for Helcim tokens; whether the QuickBooks and Google tokens are encrypted before storage is not verified. Flagged for a security review; not part of this expansion.

## Table-by-table notes for the new work

| Existing table | Relevant structure | Used by the plan for |
|---|---|---|
| `transactions` | `tc_user_id` nullable uuid, no FKs; unique `inbound_token` | Owner stays `tc_user_id` (the workspace owner id) |
| `transaction_agents` | unique (transaction_id, agent_user_id), `notice_seen`, FK to `auth.users` | Free collaborator link; kept authoritative until participants are proven |
| `agent_invites` | unique (transaction_id, email), status pending/accepted | Existing TC-to-agent invites, unchanged |
| `agents` | `tc_user_id` FK to `auth.users`, `flat_fee` default 400 | The self row for an agent workspace; counts toward the Starter cap |
| `stripe_customers` | one row per user | Agent billing record (Phase 4) |
| `external_access_links` | scope document/dates/progress | Client portals (also for agents) |
| `signing_requests` | `fields jsonb` | Template signing; new field types fit the JSON |
| `audit_log` | missing in production | Must be created before relying on it |

## Production steps this implies (yours to run, none run by me)

1. Run `add-audit-log.sql` in the Supabase SQL editor (creates `audit_log`; safe to repeat).
2. Later, when Phase 3 starts: run the new migration for `transaction_participants` and `transaction_invites`.
