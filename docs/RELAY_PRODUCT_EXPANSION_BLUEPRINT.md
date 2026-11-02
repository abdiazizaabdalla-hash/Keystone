# Relay product expansion blueprint

Audit date: 2026-11-02. Scope: audit and plan only. No production behaviour, pricing or Stripe configuration was changed for this document.

How to read statuses: **EXISTING** (works today), **PARTIAL**, **EXTENSION REQUIRED**, **NEW DEVELOPMENT**, **BLOCKED** (external API, licence or access), **NEEDS VERIFICATION** (cannot be established from code alone).

Everything below was checked against the repository. Where something could not be confirmed from code (for example live Stripe prices, or the Supabase project's actual tables and policies) it is marked NEEDS VERIFICATION rather than assumed.

---

## 1. Executive summary

Relay is a single Next.js application on Supabase and Stripe that does one job well: take a coordinator from contract to closing. The core transaction engine (AI contract intake, checklists with due dates, key dates, documents, e-signature, per-deal email address, client progress links, listings and offers, CRM, invoicing) already exists and is reusable for agents with little change.

What does **not** exist, and is the real work of the expansion:

1. **A second way to own a transaction.** Every transaction hangs off an `agents` row that belongs to a coordinator (`agents.tc_user_id`), plus `transactions.tc_user_id`. Agents, the free portal accounts, are guests on someone else's deal. There is no table for "two parties collaborate on one transaction". This single gap blocks "agent invites their TC onto the same deal" and "brokerage assigns a TC".
2. **An organization layer.** Teams exist (`teams`, `team_members`, `team_invites`), but they are deliberately a roster, billing unit and message board. Shared pipelines, shared agent directory, unassigned queue and reassignment were **removed** and now return 410 (`src/app/api/team/agents`, `.../unassigned`, `.../[userId]/transactions`). A brokerage is therefore close to new development, not a re-enablement.
3. **An automation layer.** AI is used for document reading only. There is no email classification, no amendment comparison, no automatic follow-ups, no rule engine, and no confidence scores in contract extraction.
4. **A test harness.** The repository has no automated tests of any kind. This is the biggest risk to a permission-heavy expansion.

Two structural facts shape every recommendation:

- **Authorization lives entirely in application code.** `lock-down-database-access.sql` enables RLS on every public table and revokes all access for `anon` and `authenticated`. The server uses the service-role key everywhere, so the RLS policies in older migrations (for example `add-agent-portal.sql`) are inert backstops. Adding roles means auditing and testing roughly 170 API route files, not writing policies.
- **There is no middleware.** Each route calls `getUserFromRequest` itself. That is workable, but it means a missed check is a data leak. A central authorization helper is the first thing to build.

Already done in the first expansion pass (commit `ec55cb8`, not yet deployed or tested in production): agent signup with account type, a short agent onboarding, role-aware navigation and home screen, an agent profile row for the account owner, and new marketing pages (`/for-agents`, `/for-tcs`, `/for-teams`, `/for-brokerages`). Details are in section 10 and `docs/EXPANSION_PLAN.md`.

**Recommended first milestone:** a shared-transaction model (`transaction_participants`) with a central authorization function and an automated test suite around it, then agent-invites-TC on top of it. Do this before any brokerage work.

---

## 2. Current architecture overview

| Layer | What is there | Where |
|---|---|---|
| Framework | Next.js 16.3 (Turbopack), React 19, Tailwind 4 | `package.json`, `AGENTS.md` (this version has breaking changes; read `node_modules/next/dist/docs/` before changing routing) |
| Auth | Supabase Auth, email and password, optional TOTP two-step. Each API route validates a Bearer token with the anon client | `src/lib/auth.ts`, `src/lib/authClient.ts`, `src/app/api/auth/*` |
| Data | Supabase Postgres via the **service-role** client for all app queries | `src/lib/supabase.ts` |
| Storage | Private bucket `transaction-documents` | `src/lib/storage.ts` |
| Billing | Stripe Checkout, Billing Portal, webhooks, separate Connect webhook | `src/lib/stripe.ts`, `src/app/api/stripe/*` |
| Email | Resend send; Resend inbound webhook for per-deal addresses | `src/lib/resendClient.ts`, `src/app/api/email/inbound` |
| AI | Anthropic SDK, model from `ANTHROPIC_EXTRACTION_MODEL` (default `claude-sonnet-5-5`) | `src/lib/anthropic.ts`, `src/lib/contractExtraction.ts`, `src/lib/aiUsage.ts` |
| PDFs | PDFKit (invoices, compliance export), pdf-lib (signing), pdfjs-dist (viewer) | `src/lib/invoicePdf.ts`, `src/lib/signing.ts` |
| Calendar | Google OAuth sync plus tokenised ICS feeds | `src/lib/googleCalendar.ts`, `src/lib/calendarSync.ts`, `src/app/api/calendar/*` |
| Accounting | QuickBooks OAuth, import, export, sync | `src/lib/quickbooks*.ts`, `src/app/api/quickbooks/*` |
| Jobs | Vercel Cron: due-date reminders daily 13:00 UTC, cleanup daily 04:30 UTC | `vercel.json`, `src/app/api/cron/*` |
| Observability | Sentry, Vercel Analytics, `audit_log`, `rate_limits` | `instrumentation*.ts`, `src/lib/audit.ts`, `src/lib/rateLimit.ts` |
| Hosting | Vercel, region `pdx1` | `vercel.json` |

**Account model.**

- Plan, admin flag and agent-portal role live in `auth.users.app_metadata` (server-only): `plan`, `is_admin`, `role: 'agent'` (`src/lib/privileged.ts`).
- Presentation settings live in `user_metadata` (editable by the user): `full_name`, fees, onboarding flags, and since the first pass `account_type` (`tc` default or `agent`) and `coordination_mode` (`src/lib/accountType.ts`). These never grant access.
- There is no `profiles` or `users` table in use for roles. A `users` table appears in `database-schema.sql` but account state is in Supabase Auth metadata. NEEDS VERIFICATION: whether `public.users` exists and is used in production.

**Core data model.**

- `agents`: a coordinator's CRM record for an agent (name, brokerage, email, fee settings). Owned by `tc_user_id`. Not a login.
- `transactions`: `agent_id NOT NULL` references `agents`; `tc_user_id` (added by `add-brokerage-org.sql`, backfilled) is the explicit owner. Children: `tasks` (checklist), `transaction_key_dates`, `documents`, `signing_requests`, `transaction_emails`, `transaction_contacts`, `client_messages`, `messages`, `invoices`.
- Visibility rule: `getVisibleTcUserIds(userId)` returns only `[userId]` (`src/lib/team.ts`). Even team owners do not see members' pipelines.
- Agent portal: `agent_invites` (per transaction and email) and `transaction_agents` (accepted access). `assertAgentOnTransaction` is the real check (`src/lib/agentPortal.ts`).
- Teams: `teams`, `team_members`, `team_invites`, `team_messages`, `team_message_reads`, `direct_messages`, shared `contacts`. NEEDS VERIFICATION: the `CREATE TABLE` statements for `teams`, `team_members` and `team_invites` are **not in the repository** (they were applied in the Supabase SQL editor; `add-brokerage-org.sql` says so). Schema drift risk: a fresh environment cannot be built from the repo alone.
- Brokerage remnants: `brokerage_agents` table, `agents.brokerage_agent_id`, `teams.default_*` fee columns, hidden `brokerage` plan ($15 per seat, 10-seat minimum), and `scripts/set-brokerage-admin.cjs` (a dev helper). The reassign, unassigned-queue and shared-agent-directory endpoints are gone (410).

**Integration dependencies.** Supabase (Auth, Postgres, Storage), Stripe (+Connect), Resend (send and inbound), Anthropic, Google Calendar, QuickBooks Online, Sentry, Vercel.

---

## 3. Existing feature inventory

Role key: TC = coordinator account; Agent-portal = free `role:'agent'` login; Client = bearer-link visitor; Self-agent = new agent workspace account (account_type agent).

### 3.1 Transaction management

| Feature | Status | Pages / components | API | Tables | Roles | Reuse |
|---|---|---|---|---|---|---|
| Contract upload and AI extraction | EXISTING | `dashboard/transactions/new`, `GlobalFileDrop` | `transactions/extract-contract`, `listings/[id]/extract-deal` | `ai_usage` | TC, Self-agent | Reuse as-is. Gaps: no confidence scores, no missing-field list beyond empty fields |
| Parties, property, dates capture | EXISTING | same | `transactions`, `transactions/[id]/key-dates`, `contacts` | `transactions`, `transaction_key_dates`, `transaction_contacts` | TC, Self-agent | Reuse as-is |
| Transaction creation | EXISTING | `dashboard/transactions/new` | `transactions` POST | `transactions` | TC, Self-agent | Reuse. Requires an `agents` row (Self-agent has one) |
| Checklists and due dates | EXISTING | `dashboard/transactions/[id]`, `DueDateControl` | `tasks`, `checklist-templates`, `transactions/[id]/checklist-template` | `tasks`, `checklist_templates` | TC, Self-agent | Reuse. Custom templates gated to Pro and up (`customChecklists`) |
| Deadline tracking and reminders | EXISTING | `CriticalDatesCard`, `AttentionPanel` | `key-dates/upcoming`, `dashboard/attention`, `cron/due-date-reminders` | `transaction_key_dates`, `tasks`, `attention_dismissals` | TC, Agent-portal (agent reminder) | Reuse. Email digest is to the account owner; Self-agent gets it as the owner |
| Status tracking | EXISTING | stage list in `src/lib/transactionStages.ts` | `transactions/[id]` | `transactions.status` | all | Reuse |
| Transaction history | PARTIAL | `audit_log` (account-level), `transaction_closing_events` | `lib/audit.ts` | `audit_log`, `transaction_closing_events` | TC | No per-transaction event timeline UI. EXTENSION REQUIRED |
| Assignments | PARTIAL | `transactions.tc_user_id` | none to change it (removed) | `transactions` | none | Column exists, no way to assign or reassign today |

### 3.2 Documents and signatures

| Feature | Status | Where | Notes |
|---|---|---|---|
| Uploads and categories | EXISTING | `documents` API, `lib/documentTaxonomy.ts` | per-step uploads; storage in private bucket |
| Client visibility flag | EXISTING | `documents.client_visible` (`add-client-visible-documents.sql`) | binary per document; no per-role matrix |
| E-signature | EXISTING | `signing-requests`, `sign/[token]`, `SignatureFieldPlacer`, `lib/signing.ts`, `signingEmails.ts` | signature, initial, date fields; ordered signers (`add-multiple-signers.sql`); 14-day expiry, void and decline; signed copies emailed. Not DocuSign-grade identity or audit certificates. NEEDS VERIFICATION of legal-completeness claims before marketing as such |
| Document access logs | PARTIAL | `external_access_links.access_count`, `last_accessed_at`; `audit_log` | no per-view document log |
| Document permissions by role | PARTIAL | `client_visible`; agent portal doc access in `agent/transactions/[id]/documents/[docId]` | no participant-role permission model |

### 3.3 Communication

| Feature | Status | Where | Notes |
|---|---|---|---|
| Per-deal email address | EXISTING | `api/email/inbound`, `transactions.inbound_token`, `transaction_emails` (`add-email-ingestion.sql`) | address `deal-<token>@<inbound domain>`; stores sender, subject, preview, attachments. **No classification, no AI** |
| Forward and CC workflows | EXISTING | same | threads onto the deal |
| Prefilled step emails | EXISTING | `StepEmailModal`, `step_email_templates`, `transactions/[id]/send-step-email` | rate-limited 40/hour |
| Notifications | EXISTING | `NotificationBell`, `notifications` table, `lib/notifications.ts` | in-app plus email |
| Client messaging | EXISTING | `ClientMessagesPanel`, `external/[token]/messages`, `client_messages` (board and private channels) | |
| Agent-TC messaging | EXISTING | `messages`, `agent/messages`, `DirectMessages` | |
| Email intelligence | NEW DEVELOPMENT | none | see section 16 |

### 3.4 Agent functionality

| Feature | Status | Notes |
|---|---|---|
| Agent profiles (`agents`) | EXISTING | coordinator-owned CRM record; capped at 3 on Starter |
| Invitations | EXISTING | `agent-invites`, `agent-invites/accept`, `lib/agentInvite.ts`, `agentLoginToken.ts`; invite is per transaction or listing |
| Free agent portal | EXISTING | `src/app/agent/*`, `api/agent/*`; sees only deals and listings they were added to |
| Agent calendar | EXISTING | `listing_agent_calendar_events`, `AgentCalendarPrompt` |
| Agent dashboard | EXISTING (portal) / EXTENSION REQUIRED (self-serve) | portal home is `agent/page.tsx`; self-serve agents reuse `dashboard/page.tsx` with different copy |
| Agent-owned transactions | **PARTIAL** (first pass) | a self-serve agent is a normal workspace account with an `agents` row for themselves. Works with the existing engine. They cannot yet bring in a TC |
| Agent collaborates with TC on one deal | NEW DEVELOPMENT | no shared-transaction model |
| Agent permissions | EXISTING (portal) | code check only, `assertAgentOnTransaction` |

### 3.5 Listings

EXISTING: `listings` and ~15 child tables (`listing_documents`, `listing_offers`, `listing_offer_versions`, `listing_inbound_offers`, `listing_showings`, `listing_tasks`, `listing_comments`, `listing_activity`, `listing_price_changes`, `listing_dates`, `listing_contacts`, `listing_template_steps`). PDF intake (`listings/extract-agreement`), offer intake (`listings/[id]/offers/extract`, `offers/intake`), expiry reminders (`lib/listingReminders.ts`), listing-to-transaction conversion (`transactions` POST with `fromListingId`), agent portal listings. Reusable by agents unchanged.

### 3.6 CRM

EXISTING: `contacts`, `contact_activity`, `contact_reminders`, `transaction_contacts`; import and export CSV with undo, duplicates and merge, tags and categories, sync from deals (`api/contacts/*`, `lib/contactsCrm.ts`). Team-shared contacts (`add-contacts-team-sharing.sql`). Reusable by agents.

### 3.7 Client portal

| Capability | Status | Detail |
|---|---|---|
| Access method | EXISTING | bearer-token links, table `external_access_links`, scopes `document`, `dates`, `progress` (`add-external-access-links.sql` and later). Page `src/app/external/[token]`. No client accounts or passwords |
| Expiry and revoke | EXISTING | 14 days for document and dates links, 120 days for progress; revocable; `access_count` tracked (`lib/externalAccess.ts`) |
| Progress, dates, shared documents | EXISTING | per-step "client can see this" flags |
| Messaging | EXISTING | board and private threads |
| Authenticated client access | NEW DEVELOPMENT | the brief asks for optional authenticated access for sensitive documents; nothing exists |
| Branding | NEW DEVELOPMENT | no logo or colour settings anywhere in the schema |
| Per-role visibility | PARTIAL | a client link sees client-visible items only; no buyer/seller/other-party distinction |
| Client invitations and notifications by email | EXISTING (links emailed) / PARTIAL (updates) | portal does not email on every milestone |

### 3.8 Financial

EXISTING: invoices (`invoices`, `lib/invoiceData.ts`, `invoicePdf.ts`, `invoiceMath.ts`), send and PDF routes, Stripe pay link, Stripe Connect payouts (`payment_accounts`, `lib/stripeConnect.ts`), manual and Zelle recording, refunds (`add-invoice-refunds.sql`), QuickBooks import, export and sync. These are coordinator-to-agent billing; hidden from Self-agent navigation. There is no general financial reporting module (NEW DEVELOPMENT).

### 3.9 Teams

EXISTING: team creation on purchase, invites by email (`lib/teamInvites.ts`, `teamEmails.ts`), roster with owner and member roles, team board and direct messages, shared contacts, owner status CSV (`api/team/compliance-export`), seat billing add and remove (`lib/team.ts`). Pipelines are private by design (`getVisibleTcUserIds`). Brokerage-style oversight: REMOVED.

### 3.10 Subscription and billing

| Item | Status | Detail |
|---|---|---|
| Plans | EXISTING | `src/lib/plans.ts`: Starter $19, Pro $39, Team $89 (3 seats, +$30), hidden Brokerage ($15/seat, 10 minimum). Live Stripe prices: NEEDS VERIFICATION (env `STRIPE_PRICE_STARTER/PRO/TEAM/BROKERAGE`) |
| Trial | EXISTING | 30 days, Starter only, `src/lib/trial.ts`; accounts before the cutoff are grandfathered; admin override `app_metadata.trial_ends_at` added in this project |
| Entitlements | EXISTING | `PlanLimits` (max active transactions: unlimited everywhere; max agent profiles: 3 on Starter; admin dashboard; custom checklists). Enforced per route |
| Webhook | EXISTING | `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded` (`api/stripe/webhook`) |
| Free agent portal | EXISTING | no plan, no billing |
| Seat limits | EXISTING | `lib/team.ts` (Team and Brokerage only) |

---

## 4. Existing route inventory

**Public pages:** `/`, `/pricing`, `/faq`, `/for-agents`, `/for-agents/portal`, `/for-tcs`, `/for-teams`, `/for-brokerages`, `/terms`, `/privacy`, `/auth` (+`confirm`, `forgot-password`, `reset-password`), `/onboarding`, `/onboarding/agent`, `/agent/login`, `/agent/accept`, `/sign/[token]`, `/external/[token]`, `/invoices/[id]`, `/pay/success`, `/pay/cancelled`.

**Coordinator and self-serve workspace (`/dashboard`):** Home, `transactions` (+`new`, `import`, `[id]`, `[id]/messages`), `listings` (+`template`, `[id]`), `calendar`, `messages`, `invoices` (+`quickbooks`, `[id]`), `contacts` (+`[id]`), `agents` (+`[id]`), `search`, `collaborate` (+`[userId]`), `settings`, `account`, `admin`.

**Agent portal (`/agent`):** home, `transactions`, `listings`, `messages`, `invoices`, `settings`, `welcome`, `accept`.

**Legacy redirects:** `/agents` redirects to `/dashboard/agents`; `/transactions`, `/transactions/new`, `/transactions/[id]`, `/invoices` redirect into `/dashboard/*`.

**API groups (about 170 route files):** `auth/*` (signin, signup, me, MFA, forgot-password), `agent-onboarding`, `account/*`, `admin/users`, `agents`, `agent-invites`, `agent/*` (portal), `transactions/*`, `listings/*`, `contacts/*`, `calendar/*`, `google-calendar/*`, `checklist-templates`, `step-email-templates`, `key-dates`, `tasks`, `documents`, `signing-requests/*`, `external/[token]/*`, `client-messages`, `messages`, `direct-messages`, `email/inbound`, `invoices/*`, `stripe/*`, `quickbooks/*`, `team/*`, `notifications`, `search`, `dashboard/attention*`, `demo-request`, `cron/*`.

**Conflict with the proposed website routes:** the brief proposes `/agents`, `/transaction-coordinators`, `/brokerages`, `/how-it-works`, `/contact`. Only `/agents` collides (it is a logged-in redirect used by old links). See section 10.

---

## 5. Database schema overview

Tables found in repository migrations (grouped):

- **Core:** `transactions`, `agents`, `tasks`, `documents`, `invoices`, `transaction_key_dates`, `transaction_contacts`, `transaction_emails`, `transaction_closing_events`, `users`
- **Agent portal:** `agent_invites`, `transaction_agents`, `messages`, `client_messages`, `direct_messages`
- **Client access:** `external_access_links`
- **Signing:** `signing_requests`
- **Listings:** `listings`, `listing_documents`, `listing_offers`, `listing_offer_versions`, `listing_offer_documents`, `listing_inbound_offers`, `listing_showings`, `listing_tasks`, `listing_comments`, `listing_activity`, `listing_price_changes`, `listing_dates`, `listing_contacts`, `listing_template_steps`, `listing_agent_calendar_events`
- **CRM:** `contacts`, `contact_activity`, `contact_reminders`
- **Teams and brokerage remnants:** `teams`, `team_members`, `team_invites` (definitions NOT in repo), `team_messages`, `team_message_reads`, `brokerage_agents`
- **Billing and platform:** `payment_accounts`, `quickbooks_connections`, `quickbooks_customers`, `ai_usage`, `audit_log`, `rate_limits`, `notifications`, `attention_dismissals`, `checklist_templates`, `step_email_templates`
- **Calendar:** `calendar_connections`, `calendar_feed_tokens`, `calendar_preferences`, `key_date_calendar_events`

Notable schema facts: `transactions.agent_id` is `NOT NULL`; ownership is split between `agents.tc_user_id` and `transactions.tc_user_id`; there are no foreign keys from many tables to `auth.users` in the older schema (`database-schema.sql` notes there are no FK constraints on several children, and deletes are done manually in `api/transactions` DELETE). **There are no organizations, offices, participants, workflow templates (beyond checklist templates), automation rules, or integration-connection tables.**

---

## 6. Existing permission model

1. **Authentication:** Bearer token validated by `getUserFromRequest`; banned (suspended) accounts rejected; MFA enforced when enabled.
2. **Platform admin:** only applies on `/api/admin/*`; elsewhere the admin is a normal account.
3. **Workspace ownership:** every list and detail route filters on `tc_user_id` in `getVisibleTcUserIds(user.id)`, which is always `[user.id]`. Detail routes re-check ownership by joining to `agents.tc_user_id` or `transactions.tc_user_id` (see `DELETE` in `api/transactions`).
4. **Agent portal:** `role:'agent'` accounts are rejected by workspace routes (`isAgentUser` in `auth/me` returns early) and workspace accounts are not given portal data; portal routes call `assertAgentOnTransaction`.
5. **Clients:** possession of an unguessable token is the only credential; scope, expiry, revoke checked in `api/external/[token]`.
6. **Teams:** owner-only actions in `api/team` (invite, remove, rename); owner-only compliance export.
7. **Plan limits:** `getPlanLimits(getUserPlan(user))` per route.
8. **Presentation flags** (`account_type`, `coordination_mode`) are not used for authorization (by design).

Weaknesses to be aware of: no central authorization helper; checks repeated per route; no tests; RLS provides no second line of defence. Both `agents.tc_user_id` and `transactions.tc_user_id` can in principle disagree for a given deal; routes use different ones.

---

## 7. TC product mapping

The TC product is complete for contract-to-close and invoicing. It should not be re-platformed. Mapping of the requested TC expansion items:

| Requested | Today | Gap |
|---|---|---|
| AI-assisted coordination, document collection, follow-ups | none beyond per-step prefilled emails and a daily digest | automation layer (section 16) |
| Email intelligence, amendment comparison | none | NEW DEVELOPMENT |
| Deadline monitoring | daily digest + attention panel | change detection and escalation are new |
| Exception management | `AttentionPanel` / `attentionSummary.ts` (overdue, due today, waiting-on, closing soon) | extend with missing documents, unanswered email, discrepancies |
| Agent collaboration | free portal per deal | invite-by-TC works; agent-to-TC invites need `transaction_participants` |
| Multi-transaction oversight | dashboard, calendar, search | reports are new |
| TC business financials | invoices, QuickBooks | reporting is new |
| "Invite agents without a paid workspace" | EXISTING (portal) | keep unchanged |

Preserve: route names under `/dashboard`, the Agents page, invoices, Collaborate, and every API contract used by these. Do not touch `getVisibleTcUserIds` semantics without a migration plan.

---

## 8. Agent product mapping

Principle: an agent is not a restricted TC. Built so far (first pass): account type chosen at signup, a three-question onboarding, an agent profile row, navigation without invoices and the Agents page, agent-worded empty state. The engine underneath is the TC engine, which is the right trade-off for speed, but it leaves gaps:

| Requested item | Status | Note |
|---|---|---|
| Agent-owned transactions | PARTIAL | works through the agent's own `agents` row. Naming leaks ("Agents" tables, "agent fee" settings exist in settings/onboarding for TCs) |
| Contract intake, extraction, checklist, deadlines, calendar, documents, e-sign, listings, offers, contacts, reminders | EXISTING | reuse |
| Client portal and progress | EXISTING | link-based; no branding |
| Email-based intake (forward a contract to create a transaction) | NEW DEVELOPMENT | the inbound address belongs to an **existing** deal; there is no account-level intake address that creates deals |
| Automated document requests, reminders by email | PARTIAL | step emails and digests exist; automatic requests do not |
| Invite TC, assign TC, TC and agent on the same deal | NEW DEVELOPMENT | needs `transaction_participants` |
| Agent teams | PARTIAL | the Team plan could serve; not designed for agents |
| Tasks view across deals | NEW DEVELOPMENT | `tasks` exist per deal; no cross-deal agent task list (`attentionSummary` is the nearest) |
| Transaction reporting | NEW DEVELOPMENT | |
| AI assistant | NEW DEVELOPMENT, defer | |

Dedicated agent UI (recommended, not built): "My Transactions", a cross-deal task list, "My TC" collaboration card, client list. Use the shared engine and components; replace TC vocabulary in the UI layer, not in the data layer.

Portal compatibility: keep the free agent portal unchanged. A person with an existing portal login cannot also sign up with the same email as a workspace account (Supabase email uniqueness). Conversion path needed (section 20).

---

## 9. Brokerage product mapping

The honest starting point: **almost none of this exists**, and the previous brokerage visibility features were deliberately removed.

| Requested | Today | Required |
|---|---|---|
| Brokerage organization, offices, memberships, roles | none (`teams` is a billing roster) | new `organizations`, `organization_members`, `offices` |
| Brokerage-wide transaction dashboard | removed (410) | org-scoped read model with explicit access grants |
| Assign TC, reassign | `transactions.tc_user_id` column only | assignment API, audit, notification, access transfer |
| Standard checklists, required document templates | team default checklist column (`teams.default_checklist_template_id`) and `checklist_templates.team_id` | org-level template library and enforcement |
| Compliance review queue | team CSV only | review records, reviewer roles, reviewable decisions. No automated compliance claims |
| Exception monitoring | `attentionSummary` per account | org rollup |
| Closing and agent reports | none | reporting queries and views |
| Audit logs | `audit_log` (actions, not transaction events) | per-org filter and viewer |
| Branding and portal customization | none | org settings and portal rendering |
| Organization billing | team seat billing only | org-level subscription; per-agent or minimum pricing |

Isolation requirements: an organization admin sees what the organization **owns or has been granted**, not everything by being an admin of a similarly named team. Never infer organization from `tc_user_id` membership. Required design in section 14.

---

## 10. Website and landing page architecture

**Currently built (first pass):** `/` (new hero, audience cards), `/for-agents` (self-serve), `/for-agents/portal` (the old free-portal explanation, kept because invite flows and outreach point to it), `/for-tcs`, `/for-teams`, `/for-brokerages` (honest "in development"), shared `PublicHeader`, `PublicFooter`, updated `PublicMobileMenu`, `sitemap.ts`, `SiteAnalytics` tracked paths.

**Proposed in the brief:** `/transaction-coordinators`, `/agents`, `/brokerages`, `/how-it-works`, `/contact`.

Assessment:

- `/agents` **conflicts**: `src/app/agents/page.tsx` redirects logged-in users to `/dashboard/agents`. Reusing it for marketing requires moving or removing that redirect, and old bookmarks would land on marketing.
- `/transaction-coordinators` and `/brokerages` are simple to add.
- Existing `/for-*` paths are already built, linked and in the sitemap.

**Recommendation:** keep `/for-agents`, `/for-tcs`, `/for-brokerages` (plus `/for-teams`). Add permanent redirects from the longer names (`/transaction-coordinators` to `/for-tcs`, `/brokerages` to `/for-brokerages`, `/agents` stays an app redirect). Add `/how-it-works` (one shared explanation page) and `/contact` (demo requests; the existing `DemoRequestButton` and `/api/demo-request` already send to the configured address). Do not rename the pages that already exist; renaming costs SEO and link continuity for no customer benefit.

**Pricing page:** use one `/pricing` route with a three-way selector (Agents, Coordinators, Brokerages) that shows only that audience's plans and keeps the URL shareable with an anchor (`/pricing#agents`). Separate routes would split search traffic and duplicate the comparison table. Do not show agent plans to coordinators and vice versa.

**Messaging safeguards:** TC pages keep the TC voice. Agent pages never say a TC is needed, and never imply human coordination services are provided. Brokerage pages avoid compliance guarantees.

---

## 11. Onboarding flows

| Audience | Flow | Status |
|---|---|---|
| TC | `/onboarding`: plan, name, fees, checklist, payments, launchpad (6 steps) | EXISTING, unchanged |
| Agent (self-serve) | signup with "I am a" choice, then `/onboarding/agent`: how you work, name, brokerage, phone, then contract upload | BUILT in first pass; needs production test |
| Agent (invited by a TC) | email invite, `/agent/accept`, `/agent/welcome` | EXISTING |
| Brokerage | create organization, settings, invite agents and TCs, workflows, permissions, dashboard | NEW DEVELOPMENT |

Open item for agents: "invite your TC" is the end of the agent onboarding in the brief; it depends on the shared-transaction model.

---

## 12. Role-specific navigation

| Role | Proposed items | Today | Conflicts |
|---|---|---|---|
| TC | Transactions, Listings, Contacts, Communications, Team, Invoices, Reports, Settings | Home, Transactions, Listings, Calendar, Messages, Invoices, Contacts, Agents, Search, Collaborate (Team plan), Settings, Account | no "Reports" or "Communications" pages yet |
| Agent | My Transactions, Listings, Tasks, Clients, Calendar, Documents, TC collaboration, Settings | Home, Transactions, Listings, Calendar, Messages, Contacts, Search, Settings, Account (Invoices and Agents hidden) | "Tasks", "Clients", "Documents", "TC" do not exist as pages |
| Brokerage | Overview, All Transactions, Agents, Teams and Offices, Compliance, Reports, Workflow Settings, Billing | none | all new; also `/dashboard/agents` name collides with the TC "Agents" meaning |

The nav is driven by `PRIMARY_NAV` and `moreItems` in `src/app/dashboard/layout.tsx` and the persona flag. Add a third persona value only when brokerage exists. Keep a single layout component; do not fork the dashboard.

---

## 13. Feature feasibility matrix

**Effort assumptions.** Realistic engineering days for one experienced full-stack engineer working in this codebase, including their own tests and review fixes, excluding design iteration and customer feedback cycles. Format: total days (FE frontend / BE backend / DB database and migration / SEC security review / INT external integration / TST testing). Because the repository has no test infrastructure, every row's TST figure assumes row 1 is done first. Treat ranges as +/-30 percent.

**Reuse key:** A = immediately reusable, B = reusable with minor changes, C = reusable with substantial changes, D = requires new infrastructure, E = not feasible without external access.

| # | Feature | Existing implementation | Current code | DB dependencies | Required changes | Difficulty | Dependencies | Effort (days) | Priority |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Automated test harness and CI | None (no test files or runner). **D** | `package.json` | none | Add runner (Vitest or Jest), seed-able test Supabase project, route test helpers, CI | Medium | none | 6 (BE 2, TST 4) | P0 |
| 2 | Central authorization module | Per-route checks. **C** | `src/lib/auth.ts`, `agentPortal.ts`, every `api/*` route | none | `authorize(user, resource, action)`, migrate high-risk routes, ban direct `supabaseServer` reads of tenant data in new code | Medium | 1 | 6 (BE 3, SEC 1.5, TST 1.5) | P0 |
| 3 | Shared transaction model (`transaction_participants`) | Portal guest access only (`transaction_agents`). **D** | `lib/agentPortal.ts`, `api/transactions`, `api/agent/*` | new table; backfill from `transaction_agents` | Role per participant (owner, tc, agent, collaborator, client-contact), invite lifecycle, visibility rules | High | 1, 2 | 14 (FE 3, BE 5, DB 2, SEC 2, TST 2) | P0 |
| 4 | Agent invites their TC to a deal | None. **D** | new | `transaction_participants` | invite email, accept page, TC sees deal without duplication, notification | Medium | 3 | 6 (FE 2, BE 2, SEC 1, TST 1) | P0 |
| 5 | TC invites agent (free portal) | EXISTING. **A** | `lib/agentInvite.ts`, `agent/*` | `agent_invites`, `transaction_agents` | none now; migrate onto participants later | Low | 3 later | 0 now, 3 later | P2 |
| 6 | Self-serve agent signup, onboarding, nav | BUILT (first pass), untested in production. **B** | `auth/page.tsx`, `onboarding/agent`, `api/agent-onboarding`, `dashboard/layout.tsx` | `agents`, user metadata | production test, analytics events, duplicate-email handling | Low | deploy | 3 (FE 1, BE 0.5, TST 1.5) | P0 |
| 7 | Portal-to-workspace conversion | None. **D** | `agent/*` | auth users, `transaction_agents` | let a portal login upgrade to a workspace account keeping access; email-collision handling | Medium | 3 | 5 (BE 3, SEC 1, TST 1) | P1 |
| 8 | Agent cross-deal task list | Per-deal tasks, attention rollup. **C** | `lib/attentionSummary.ts`, `AttentionPanel` | `tasks` | agent-specific "My tasks" page | Low | none | 4 (FE 2, BE 1, TST 1) | P1 |
| 9 | Agent vocabulary and settings cleanup | TC wording in shared screens. **B** | `dashboard/settings`, transaction forms | none | hide fee/invoice settings, rename labels by persona | Low | 6 | 3 (FE 2.5, TST 0.5) | P1 |
| 10 | Account-level intake email (forward a contract, a deal is created) | Per-deal inbound only. **C** | `api/email/inbound`, `lib/listingInbound.ts`, `lib/contractExtraction.ts` | `transaction_emails`, new per-user intake token | route by user token, extract, create **draft** deal needing confirmation | High | Resend inbound domain config, 11 | 10 (FE 2, BE 5, DB 1, SEC 1, TST 1) | P1 |
| 11 | Extraction confidence and missing-field list | Extraction returns fields, no confidence. **C** | `lib/contractExtraction.ts`, `transactions/new` UI | optional `ai_extractions` | prompt and schema change, per-field confidence, UI flags, store raw result | Medium | none | 5 (FE 2, BE 2, TST 1) | P1 |
| 12 | Amendment comparison | None. **D** | new | `ai_extractions`, `transaction_key_dates`, `tasks` | extract amendment, diff vs original, propose changes, confirm, log | High | 11, 16 | 12 (FE 4, BE 5, SEC 1, TST 2) | P2 |
| 13 | Email classification and deal matching | Emails stored, not understood. **D** | `api/email/inbound` | `transaction_emails` + category columns | classifier, attachment typing, suggested actions | High | 14 | 15 (BE 8, FE 3, SEC 1, TST 3) | P2 |
| 14 | Rules engine for follow-ups and document requests | Step emails and daily digest only. **D** | `lib/dueDateReminders.ts`, `StepEmailModal` | `automation_rules`, `automation_runs` | trigger, condition, action, approve/pause/disable, rate limits, audit | High | 1, 16 | 18 (FE 5, BE 8, DB 1, SEC 1, TST 3) | P2 |
| 15 | Exception dashboard (missing docs, unanswered email, discrepancies) | Overdue, due-today, waiting-on, closing-soon. **C** | `lib/attentionSummary.ts`, `api/dashboard/attention` | `tasks`, `documents` | required-document model, more categories | Medium | 14 for some | 7 (FE 3, BE 3, TST 1) | P1 |
| 16 | Per-transaction event timeline | Account-level `audit_log` only. **D** | `lib/audit.ts` | new `transaction_events` | write events from mutation routes, timeline UI | Medium | 2 | 6 (FE 2, BE 3, DB 0.5, TST 0.5) | P1 |
| 17 | Client portal branding | None. **D** | `external/[token]` | settings columns | logo and colour, safe rendering | Medium | org for brokerage branding | 5 (FE 3, BE 1, TST 1) | P2 |
| 18 | Authenticated client access | Token links only. **D** | `external/[token]` | client accounts or magic links | decision first: magic-link session on top of the existing token is far cheaper than accounts | High | 3 | 12 (FE 3, BE 5, SEC 2, TST 2) | P3 |
| 19 | Role-based document visibility | Single `client_visible` flag. **C** | `documents`, `api/documents` | `documents` columns or participants | per-role visibility, internal-only default | Medium | 3 | 6 (FE 2, BE 2, SEC 1, TST 1) | P1 |
| 20 | Organizations, memberships, roles | `teams` roster only. **D** | `lib/team.ts`, `api/team` | new `organizations`, `organization_members` | model, invites, role checks, migrate existing Brokerage account | High | 1, 2 | 12 (FE 3, BE 4, DB 2, SEC 2, TST 1) | P1 |
| 21 | Offices and sub-teams | None. **D** | new | `offices` | optional second level | Medium | 20 | 5 | P3 |
| 22 | Brokerage dashboard (oversight) | Removed (410). **D** | `api/team/*` stubs | org-scoped views | org-scoped queries over explicitly shared deals, filters | High | 3, 20 | 14 (FE 6, BE 5, SEC 2, TST 1) | P1 |
| 23 | TC assignment and reassignment | Column only. **C** | `transactions.tc_user_id` | `transaction_participants` | assignment API, access transfer, notification, audit | Medium | 3, 20 | 6 (FE 2, BE 2, SEC 1, TST 1) | P2 |
| 24 | Org checklist library and required documents | Per-team default template. **C** | `checklist_templates.team_id`, `lib/checklistTemplates.ts` | `organization_id` columns, required-docs table | org templates, enforcement on new deals | Medium | 20 | 8 (FE 3, BE 3, DB 1, TST 1) | P2 |
| 25 | Compliance review queue | Owner CSV only. **D** | `api/team/compliance-export` | `compliance_reviews` | reviewer assignment, status, human decision, audit | High | 20, 22 | 14 (FE 6, BE 5, SEC 1, TST 2) | P3 |
| 26 | Reports (closings, activity) | None. **D** | new | views | 3 to 5 queries and export | Medium | 20 for org reports | 8 (FE 4, BE 3, TST 1) | P2 |
| 27 | Organization billing | Per-seat for teams. **C** | `lib/team.ts`, `lib/stripe.ts` | org-to-customer link | org as billing owner, per-agent quantity | High | 20 | 10 (BE 5, FE 2, SEC 1, TST 2) | P2 |
| 28 | Agent plans in Stripe | Starter/Pro/Team/Brokerage price env vars. **B** | `lib/plans.ts`, `lib/stripe.ts`, `api/stripe/webhook` | none | new price ids, plan entries, webhook mapping, trial rules (trial is Starter-specific in `lib/trial.ts`) | Medium | pricing decision | 6 (BE 3, FE 1.5, TST 1.5) | P1 |
| 29 | Annual pricing | None. **B** | same | none | extra Stripe prices, interval toggle | Low | 28 | 2 | P3 |
| 30 | AI usage metering and caps | `ai_usage` logged, 20/hour rate limits. **C** | `lib/aiUsage.ts`, `lib/rateLimit.ts` | `ai_usage` | monthly counters, plan caps, UI, upgrade prompt | Medium | 28 | 5 (FE 1.5, BE 2.5, TST 1) | P1 |
| 31 | Gmail integration | None. **D**, partly E | new | `integration_connections` | OAuth; reading mail needs Google restricted-scope verification and security assessment | Very High | Google review | 20+ (INT 12, BE 4, SEC 2, TST 2) | P3 |
| 32 | Outlook mail | None. **D** | new | same | Microsoft Graph OAuth | High | Azure app registration | 15 | P3 |
| 33 | Microsoft calendar | None (Outlook via ICS link works). **D** | `lib/googleCalendar.ts` as pattern | `calendar_connections` | Graph calendar sync | Medium | 31/32 patterns | 8 | P2 |
| 34 | Google Calendar | EXISTING. **A** | `lib/googleCalendar.ts`, `calendarSync.ts` | `calendar_connections` | none | n/a | none | 0 | n/a |
| 35 | DocuSign | None (own e-sign exists). **E** partly | new | `integration_connections` | developer account, per-envelope cost, templates | High | account, cost | 12 | P3 |
| 36 | Follow Up Boss | None. NEEDS VERIFICATION | new | | API key or partner access, contact sync | Medium | partner terms | 8 | P3 |
| 37 | dotloop, SkySlope, Lone Wolf | None. NEEDS VERIFICATION, likely **E** | new | | partner programs and approvals | High | approvals | unknown | Defer |
| 38 | MLS or RESO data | None. **E** | new | | licence per MLS | n/a | licensing | n/a | Defer |
| 39 | QuickBooks | EXISTING. **A** | `lib/quickbooks*.ts` | `quickbooks_*` | none | n/a | none | 0 | n/a |
| 40 | AI transaction assistant | None. **D** | new | | needs 11, 16 and trusted tools | High | 2, 11, 16 | 15 | Defer |

**Totals by category (rough, sums of the rows above):**

| Category | Examples | Days |
|---|---|---|
| Already built | contract intake, e-sign, client progress, listings, CRM, invoices, Google Calendar, QuickBooks | 0 |
| Minor expansion | rows 6, 8, 9, 28, 29 | ~18 |
| Foundations | rows 1, 2, 3, 4, 16, 19 | ~44 |
| Moderate | rows 7, 10, 11, 15, 17, 30 | ~37 |
| Major | rows 12, 13, 14, 20 to 27 | ~122 |
| External dependency | rows 31 to 38 | 60+ plus approvals |

---

## 14. Proposed database changes

Principles: additive, nullable, backfilled, no drops. Every new table is created with RLS enabled and **no grants** to `anon`/`authenticated`, matching `lock-down-database-access.sql`. Add the `CREATE TABLE` for `teams`, `team_members`, `team_invites` to the repository first (they are missing).

| Table | Purpose | Key columns | Constraints and indexes |
|---|---|---|---|
| `transaction_participants` | who can access a transaction and as what | `transaction_id`, `user_id` (nullable until accepted), `email`, `role` (`owner`,`tc`,`agent`,`collaborator`), `status` (`invited`,`active`,`removed`), `invited_by`, `permissions` jsonb, timestamps | unique (`transaction_id`,`lower(email)`); index `user_id`; exactly one `owner` per transaction (partial unique index); backfill owners from `transactions.tc_user_id`, agents from `transaction_agents` |
| `organizations` | brokerage or large team | `name`, `type`, `owner_user_id`, `settings` jsonb, `branding` jsonb, `stripe_customer_id`, `plan` | |
| `organization_members` | membership and role | `organization_id`, `user_id`, `role` (`owner`,`admin`,`broker`,`office_admin`,`agent`,`tc_internal`,`tc_external`), `office_id` nullable | unique (`organization_id`,`user_id`) |
| `offices` | optional subdivision | `organization_id`, `name` | |
| `organization_transactions` | explicit grant that a transaction is visible to an organization | `organization_id`, `transaction_id`, `granted_by`, `visibility` (`status_only`,`full`) | unique pair; **this is what prevents "admin sees everything"** |
| `transaction_events` | per-deal timeline and audit | `transaction_id`, `actor_user_id`, `type`, `payload` jsonb, `created_at` | index (`transaction_id`,`created_at`) |
| `ai_extractions` | store AI output for review | `transaction_id` nullable, `source` (`contract`,`amendment`,`email`), `raw` jsonb, `fields` jsonb with confidence, `status` (`proposed`,`confirmed`,`rejected`), `model`, `reviewed_by` | |
| `automation_rules` | user-defined automation | `owner_user_id` or `organization_id`, `trigger`, `conditions` jsonb, `action`, `mode` (`ask`,`auto`,`paused`) | |
| `automation_runs` | execution log and approvals | `rule_id`, `transaction_id`, `status` (`proposed`,`approved`,`sent`,`failed`,`skipped`), `payload`, `error` | |
| `integration_connections` | OAuth to third parties | `owner_user_id`, `provider`, encrypted tokens (reuse `lib/encryption.ts`), `scopes`, `status` | unique (`owner`,`provider`) |
| `compliance_reviews` | human review records | `transaction_id`, `document_id`, `reviewer_user_id`, `status`, `note` | |
| `notification_preferences` | per-user delivery settings | | |

Column additions (all nullable): `checklist_templates.organization_id`, `contacts.organization_id` (optional), `documents.visibility` (`internal`,`client`,`participants`).

Do **not** repurpose `agents` for logins, and do not make `transactions.agent_id` nullable in the first milestone; instead keep the self-agent profile pattern. A later migration can introduce `transactions.owner_user_id` and phase out the coupling, once participants exist.

---

## 15. RLS and security requirements

**What RLS does today:** nothing for the app. All access is through the service role with checks in code. Older policies (`add-agent-portal.sql`, others) reference `agents.tc_user_id` and are inactive because grants are revoked.

**Recommendation:** keep the "deny all to client keys" posture. Do not mix a second model (user-JWT queries with policies) into a codebase where every route uses service role. Instead:

1. One `authorize()` function that resolves a user's relationship to a transaction (owner, participant role, organization grant) and returns allowed actions. Every new route calls it. Existing routes migrate in priority order: documents, signing, client links, messages, then lists.
2. List queries always start from a visibility query (`transactions visible to user`) rather than `tc_user_id IN (...)`.
3. Automated cross-tenant tests (see section 20) that create two accounts and verify every route denies the other.
4. Keep storage private; add path-prefix checks (`transaction-documents/<transaction_id>/...`) against `authorize()`.

**Permission matrix (proposed):**

| Role | Own transactions | Shared via participant | Org grant | Internal notes | Documents | Invoices | Org reports |
|---|---|---|---|---|---|---|---|
| TC account owner | full | per role | n/a | yes | all | yes | n/a |
| TC team member | own only (pipelines stay private) | per role | n/a | own | own | own | none |
| Agent workspace owner | full | per role | n/a | own | all on own | none | none |
| Agent collaborator (invited) | n/a | per `permissions` | n/a | no (unless granted) | participant-visible | none | none |
| Brokerage admin / managing broker | n/a | n/a | `status_only` or `full` per grant | no | per grant | none | yes |
| Office admin | n/a | n/a | their office only | no | per grant | none | office only |
| Internal TC | assigned | per role | per grant | assigned | assigned | n/a | none |
| External TC | assigned only | per role | none | assigned | assigned | n/a | none |
| Buyer / seller | none | none | none | **never** | `client_visible` only via link | none | none |
| Other participant (lender, title) | none | none | none | never | specific shared items only | none | none |

Hard rules: an organization admin sees nothing outside `organization_transactions`. Clients never see internal notes, private agent-TC threads or brokerage-only items. An external TC loses access when unassigned.

**Specific risks to retire before shipping collaboration:** (a) `agents.tc_user_id` and `transactions.tc_user_id` can disagree; (b) several tables have no FK or cascade so deletions are manual (`api/transactions` DELETE) and a participant model adds more rows to clean; (c) token links live in URLs and are logged by proxies; do not extend them to sensitive documents without a second factor; (d) `user_metadata` is user-editable; never read roles from it.

---

## 16. Automation roadmap

Design rules: AI **proposes**, a person **confirms** anything material (contract dates, obligations, status, sending email to a third party). Every proposal and decision is stored (`ai_extractions`, `automation_runs`, `transaction_events`). Deterministic rules do the cheap work (date arithmetic, overdue detection); AI is only for reading unstructured text.

| Automation | Trigger | Input | AI needed | Deterministic part | Output | Human approval | Audit | Failure handling | Cost note |
|---|---|---|---|---|---|---|---|---|---|
| Contract extraction (EXISTING) | file upload | PDF | yes (exists) | form validation | draft deal fields | user reviews before save (exists) | `ai_usage` only | rate-limited, error shown | tokens per contract; measurable from `ai_usage` |
| Confidence and missing fields | extraction | PDF | yes (prompt change) | required-field list | flagged fields | user confirms flagged | `ai_extractions` | fall back to blank field | no extra call |
| Deadline calculation (PARTIAL) | contract dates | dates | no | `lib/dueDates.ts`, `keyDates.ts` | due dates | user can edit | event log | invalid date warnings | none |
| Account-level intake email | inbound mail to user token | email + attachment | yes | sender allow-list, attachment types | **draft** deal in a review queue | required before it becomes a deal | event + run | quarantine unknown senders | extraction cost per email |
| Email-to-deal matching | inbound mail | headers, subject, tokens | no for token match; optional for fuzzy | token and address match | email filed on deal | none for exact token; confirm for fuzzy | event | unmatched inbox | none or small |
| Email categorization and extraction | filed email | body, attachments | yes | none | category, suggested task or date | required for any date or status change | `ai_extractions` | skip on failure | per-email tokens: set a cap |
| Document classification | upload | PDF | yes (small model) | taxonomy in `lib/documentTaxonomy.ts` | suggested category | one-click confirm | event | default "Other" | small |
| Missing-document detection | schedule | required-doc list per transaction type | no | compare required list to uploads | exception item | none to flag | event | none | none |
| Automated follow-up email | rule: document missing after N days | template, recipient | optional draft polish | rule evaluation, rate limits, quiet hours | email draft or sent | default **ask**; `auto` only when owner enables per rule | `automation_runs` | retry with backoff, mark failed, never loop | Resend send cost |
| Amendment comparison | upload tagged "amendment" | original and amendment extractions | yes | field diff | before/after table, affected checklist items | **required** to apply | `ai_extractions` + event | on low confidence show source text, do not auto-apply | two extractions |
| Deadline change detection | extraction or email mentions date change | text | yes | compare with `transaction_key_dates` | proposed change | **required** | event | do nothing on ambiguity | per use |
| Calendar updates | confirmed date change | key dates | no | existing `calendarSync.ts` | updated events | n/a (follows approval) | event | queued sync (exists) | none |
| Escalations and notifications | overdue, unanswered | tasks | no | thresholds | in-app and email | none | notifications | digest batching (exists) | email cost |
| Client and agent updates | milestone completed | task state | optional | templates | email to client contact | owner setting per deal | event | skip if no email | email cost |
| Exception monitor | nightly cron | all open deals | no | rules | ranked list | none | n/a | cron failure alert in Sentry | DB cost only |

Prerequisites before any `auto` mode: an approval queue UI, per-user and per-organization send limits, unsubscribe and reply-to handling, and an emergency kill switch on `automation_rules`. Do not ship an `auto` follow-up before the `ask` mode has been used in production for a few weeks.

Effort for the whole automation layer: roughly 55 to 65 engineering days across rows 10 to 16 of the matrix.

---

## 17. Integration feasibility

Search-based verification was done on 2026-11-02 for the existence of official documentation only. Commercial terms, partner approvals and pricing could not be confirmed from public pages and are marked NEEDS VERIFICATION. Do not market any of these before the owner of the account has confirmed access.

| Integration | Official API | OAuth | Commercial access | Realistic sync | Direction | Licensing and notes | Difficulty |
|---|---|---|---|---|---|---|---|
| Gmail | Yes (Gmail API) | Yes | Google OAuth app verification; reading mail uses restricted scopes, which per Google's guidance and third-party guides involve a security assessment. NEEDS VERIFICATION of current requirements | read labeled mail, send as user | bi | Heavy compliance cost. The existing forward-to-deal-address flow avoids this entirely | Very High |
| Outlook mail | Yes (Microsoft Graph) | Yes (Entra ID) | app registration; tenant admin consent may be needed for some organizations. NEEDS VERIFICATION | same | bi | | High |
| Google Calendar | Yes | Yes | already integrated | events from deals | one-way out | EXISTING (`lib/googleCalendar.ts`) | done |
| Microsoft Calendar | Yes (Graph) | Yes | as above | events | one-way out | Outlook users can already subscribe via ICS link | Medium |
| DocuSign | Yes (eSignature REST API) with a developer sandbox and a go-live review; plans and API limits apply. NEEDS VERIFICATION of cost | Yes | paid account required | send envelopes, receive status and signed PDF | bi | Relay already has its own e-sign; DocuSign matters only if brokerages require it | High |
| Follow Up Boss | Yes, public REST API documented; API key and OAuth app registration appear in its docs. NEEDS VERIFICATION of partner approval | key or OAuth | customer's own key may suffice for contact sync | contacts and notes | likely bi | | Medium |
| dotloop | Yes, public API documented, under an API licence agreement. NEEDS VERIFICATION of approval and terms | Yes | licence terms | loops, documents | read/write per scope | Owned by Zillow Group | Medium to High |
| SkySlope | Yes, vendor publishes API documentation and a transaction-management API article. NEEDS VERIFICATION of partner access | likely | partner approval likely | transactions and documents | uncertain | | Medium to High |
| Lone Wolf | NEEDS VERIFICATION (not checked) | | | | | Treat as BLOCKED until proven | Unknown |
| QuickBooks | Yes | Yes | already integrated | invoices, customers | bi | EXISTING | done |
| MLS / RESO | RESO Web API is a standard, but data access is granted by each MLS under vendor licences | typically token | **per-MLS licence and fees; many MLS restrict use** | listings data | read | BLOCKED until a licence is signed | N/A |

Sources consulted (documentation existence only):
- Follow Up Boss developer docs: https://docs.followupboss.com/
- dotloop public API: https://dotloop.github.io/public-api and https://dotloop.com/api-license-agreement
- SkySlope API documentation: https://api.skyslope.com/api/docs/openid/SkySlopeApi.html
- Gmail API scopes: https://developers.google.com/workspace/gmail/api/auth/scopes
- Google verification and security assessment guide (third party): https://developer.nylas.com/docs/dev-guide/provider-guides/google/google-verification-security-assessment-guide
- DocuSign developer plans: https://ecom.docusign.com/plans/developer
- MLS data licensing examples: https://help.repliers.com/en/article/mls-data-access-requirements-who-can-use-mls-apis-wyl8lw

Recommendation: build a small provider interface and `integration_connections` table only when the first integration is actually started. Start with Microsoft calendar (small, completes calendar coverage). Treat email as **forwarding plus the per-user intake address** until agents ask for inbox connection loudly enough to justify Google verification.

---

## 18. Pricing and billing implications

Hypotheses from the brief: Agent Collaborator $0, Agent Solo $29, Agent Pro $49; Brokerage Essentials $199, Growth $349, Enterprise custom (about $599+).

**What exists:** Stripe price ids come from environment variables; the plan id is written to `app_metadata.plan` by the webhook; entitlements are `PlanLimits` in `src/lib/plans.ts`; Team and Brokerage have seat quantity logic in `src/lib/team.ts`; the trial (`src/lib/trial.ts`) is Starter-only and uses the account creation date.

**Free Agent Collaborator ($0):** already exists as the free portal. Keep it. Nothing to build.

**Agent Solo / Agent Pro:** today an agent can run on Starter or Pro with identical engine access, so a separate plan is a **pricing and packaging** decision, not a capability one. To justify two agent tiers there must be something an agent actually values beyond Starter: the TC-collaboration feature (matrix 3, 4), the cross-deal task list (8), confidence-flagged intake (11) and AI usage with a cap (30). Without those, Agent Pro is a rename of Pro.

**Required work to sell agent plans:** new Stripe prices and env vars (28), plan entries, webhook mapping, trial rule (agents get a 30-day trial like Starter; trial code must treat the new plan ids), plan limits for AI reads per month (30), pricing page segmentation (section 10). About 12 days for 28 plus 30.

**Brokerage tiers:** cannot be sold honestly until organizations (20), the oversight dashboard (22) and TC assignment (23) exist. Today the closest offer is Team seats plus the owner status report. A per-agent price with a monthly minimum is easier to explain than three tiers with unclear limits; decide tiers only after one or two pilot brokerages. Note that the existing hidden Brokerage plan is $15 per seat with a 10-seat minimum ($150), which is **lower** than the proposed $199 Essentials; reconcile before launch and decide what happens to the one existing Brokerage customer (keep grandfathered).

**Cost factors to measure before setting caps:**
- AI: tokens per contract from `ai_usage` (not summarized in code; write a query first).
- Email: Resend per message; automation multiplies sends.
- Storage: documents in Supabase Storage per account.
- Stripe fees on small subscriptions.
- Inbound email processing.

**Seat and volume limits:** transactions are unlimited on every plan today. If agent plans are priced by volume, add an active-transaction cap (the `maxActiveTransactions` limit already exists and is enforced in `api/transactions`, currently `null`).

**Entitlement and billing safety:** do not change live prices or the webhook during the audit. When changing, preserve grandfathered Starter accounts and the admin override; test checkout for each new plan in Stripe test mode; verify webhook handling of upgrades, downgrades, cancellations and refunds (`charge.refunded` suspends accounts, `lib/refundSuspend.ts`).

**Annual discounts:** extra Stripe prices and a toggle (matrix 29); low risk, defer until monthly plans are proven.

**Upgrade paths:** Collaborator to Agent Solo (portal conversion, matrix 7), Agent to Team (agents with an assistant), Team to Organization.

---

## 19. UX and UI recommendations

Shared design system, three experiences: keep the existing dark navy palette, Inter, and components (`PublicHeader`, `PublicFooter`, cards, pills). Differences come from navigation, default home content and vocabulary, not from different themes.

**Wireframe descriptions**

- **Homepage:** hero "Transaction coordination, without the coordination headache", two buttons, an "Have a TC? Work together. No TC? Let Relay handle the coordination" band with four audience cards (agents, TCs, teams, brokerages), the existing demo video, how-it-works steps, plan teaser, final CTA. Keep one short TC line in the hero area so TCs do not feel displaced.
- **TC landing page (`/for-tcs`):** hero, eight feature cards, "your agents can use Relay too" band, CTA with demo request.
- **Agent landing page (`/for-agents`):** hero with two-path promise, three ways to work, four-step upload flow, feature grid, "already work with a TC?" panel linking to the free portal, honest roadmap block, price strip.
- **Brokerage landing page (`/for-brokerages`):** hero, "in development" planned-feature grid, "available today" paragraph, **Talk to us** only.
- **Agent dashboard:** header "Your transactions", a "needs you today" panel first, closing timeline, upcoming dates, then deal cards. Right rail: "My TC" status (none, invited, active). No invoices or fee settings.
- **TC dashboard:** current dashboard, plus (later) a workload and exceptions strip.
- **Brokerage command center (not built):** top row of counts (active, closing this month, overdue, awaiting review), filter bar (office, agent, TC, status), table with milestone and exception columns, side drawer with deal status. Read-only by default. A clear "shared with brokerage" badge per deal.
- **Agent onboarding:** one page with three radio cards and three fields, then contract upload (built).
- **Brokerage onboarding:** four short steps (organization, invite people, template choice, review permissions), with a visible preview of what admins can and cannot see.
- **Client portal:** branded header, progress ring, next three dates, shared documents, "what happens next" text, message box. Keep link access; add magic-link sign-in only when sensitive documents are shared.

**Trust and positioning rules:** never imply Relay provides licensed human coordination; never promise compliance outcomes; mark unbuilt capabilities "in development" or "on the roadmap" in marketing; keep screenshots truthful to the shipped UI.

---

## 20. Testing and migration strategy

Current state: **no automated tests** in the repository. Manual verification is the only safety net, and the expansion mostly changes authorization.

**Build first (matrix 1):** Vitest or Jest; a dedicated Supabase test project or local Supabase with seed users; helpers that create users (TC, Self-agent, portal agent, second TC, org admin) and call route handlers.

**Required test suites before each launch stage**

| Area | Tests |
|---|---|
| Authentication | signup with `account_type`, MFA path, suspended account, portal vs workspace account redirects |
| Permissions | every route in a table-driven test: cross-account access returns 403/404; participant roles; unassigned TC loses access |
| Transaction ownership | creation, deletion cleanup, reassignment |
| TC-agent collaboration | invite, accept, shared edits, no duplicate deal, removal |
| Brokerage isolation | org admin sees only granted deals; two organizations cannot see each other; admin of a team is not an org admin |
| Client privacy | internal notes and private threads never in client payloads; revoked and expired links |
| Document permissions | visibility flags, storage path checks |
| Stripe | checkout per plan (test mode), webhook idempotency, upgrade, downgrade, cancel, refund-suspend, seat add and remove |
| Trial and legacy | grandfathered accounts untouched; trial banner; admin trial override |
| Email | send templates, inbound matching, attachment limits, spoofed sender handling |
| Calendar | Google sync create, update, delete |
| AI extraction | golden-file contracts for expected fields, failure behaviour, cap enforcement |
| Automation | rule trigger, approval, pause, duplicate-send prevention, kill switch |
| Mobile | agent and client views at 390 px width |
| Regression | smoke script that signs in as a TC fixture and walks new deal, checklist, e-sign, invoice |

**Migration rules:** additive SQL only, one file per change in the repo root (existing convention), applied in the SQL editor, with a verification query at the end of each file. Add the missing `teams` definitions to the repo first. Backfill `transaction_participants` from `transactions.tc_user_id` and `transaction_agents` in a transaction, with counts compared before and after. Keep reading `transaction_agents` until all portal routes are moved. No change to portal URLs, invite emails, or the `role:'agent'` model without a migration note. Keep grandfathered accounts and legacy trial logic exactly as is.

**Self-serve agent specifics to test in production:** signup with and without `plan` parameter, `/onboarding` redirect to `/onboarding/agent`, agent profile creation idempotency, transaction creation with a single agent, no portal invite to self, dashboard persona cache (`lib/persona.ts`).

---

## 21. Dependencies

Technical: central authorization (2) before any sharing; participants (3) before TC invites (4) and TC assignment (23); organizations (20) before the oversight dashboard (22), org templates (24), org billing (27); extraction confidence (11) before amendment comparison (12); events timeline (16) before automation (14); test harness (1) before everything.

External: Google verification for Gmail; Microsoft app registration; DocuSign account; Resend inbound domain configuration for account-level intake (10); MLS licences; partner terms for dotloop, SkySlope, Lone Wolf, Follow Up Boss.

Business: pricing decision before row 28; a pilot brokerage before row 22; a decision on who may see what for compliance workflows before row 25.

---

## 22. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Data leak from a missed authorization check (no tests, no RLS backstop) | Medium | Severe | rows 1, 2 first; table-driven tests of every route; code review checklist |
| Schema drift (`teams` DDL not in repo) | Present | Medium | export and commit the DDL |
| Two ownership columns disagree | Medium | Medium | consolidate behind `authorize()`; add `owner_user_id` later |
| Portal vs workspace email collision | Medium | Medium | conversion flow (7); clear error copy |
| AI misreads a date and a person trusts it | Medium | High | confidence, confirmation, source display; never auto-apply |
| Automation spams third parties | Medium | High | default `ask`, rate limits, kill switch |
| Marketing outruns product | High | Reputation | roadmap labels; only claim shipped items |
| TCs feel abandoned | Medium | Churn | keep TC pages and nav, keep pricing and trial promises |
| Over-building brokerage before demand | High | Time | pilot first |
| Gmail verification cost | High if pursued | Time | prefer forwarding |
| Billing regressions | Low-Medium | High | test-mode matrix, no change to live ids until tested |
| Existing environment unverified (live Stripe prices, tables in production) | Unknown | Medium | NEEDS VERIFICATION items checked before launch |

---

## 23. Implementation phases

### Phase 1: Foundations and role separation (about 40 days)
- **Features:** test harness (1), authorization module (2), participants (3), event timeline (16), document visibility (19), commit missing `teams` DDL.
- **Files affected:** `src/lib/auth.ts`, new `src/lib/authorize.ts`, `src/lib/agentPortal.ts`, `src/app/api/transactions/*`, `api/documents`, `api/external/[token]`, `api/signing-requests`, `api/client-messages`, `api/agent/*`.
- **Database:** `transaction_participants`, `transaction_events`, `documents.visibility`, backfills.
- **API:** participant invite, accept, remove; events read.
- **Dependencies:** none external.
- **Security:** full route sweep, deny-by-default tests.
- **Testing:** permissions suite, backfill count checks.
- **Launch criteria:** every existing route passes cross-account tests; backfill counts match; no change visible to current TCs and portal agents.

### Phase 2: Complete agent experience (about 30 days)
- **Features:** agent invites TC (4), portal conversion (7), task list (8), vocabulary cleanup (9), production hardening of signup and onboarding (6), account-level intake as a **draft** queue (10), confidence flags (11), agent plans packaging (28, 30).
- **Files:** `src/app/dashboard/layout.tsx`, `dashboard/page.tsx`, new `dashboard/tasks`, `dashboard/settings`, `onboarding/agent`, `api/agent-onboarding`, `lib/plans.ts`, `lib/stripe.ts`, `api/stripe/*`, `lib/trial.ts`.
- **Database:** none beyond phase 1, optional `ai_extractions`, new env price ids.
- **Security:** participant role checks; TC sees only the shared deal.
- **Testing:** TC-agent collaboration suite, Stripe test-mode matrix, mobile.
- **Launch criteria:** a new agent can upload a contract, review, invite a client and a TC, and a TC can work the same deal without duplication; agent pricing decided and tested.

### Phase 3: Automated coordination (about 55 days)
- **Features:** exceptions (15), rules engine with approvals (14), email matching and classification (13), amendment comparison (12), required-document model.
- **Files:** `lib/attentionSummary.ts`, `api/email/inbound`, new `lib/automation/*`, `api/cron/*`.
- **Database:** `automation_rules`, `automation_runs`, `ai_extractions`, email categories.
- **Security:** send limits, approval queue, audit.
- **Testing:** automation suite, golden contracts.
- **Launch criteria:** ask-mode follow-ups used by real accounts for several weeks with zero unapproved sends; amendment diff never applies without confirmation.

### Phase 4: Brokerage (about 70 days)
- **Features:** organizations (20), grants (`organization_transactions`), oversight dashboard (22), TC assignment (23), org templates (24), reports (26), org billing (27), later compliance queue (25), branding (17).
- **Database:** `organizations`, `organization_members`, `offices`, `organization_transactions`, `compliance_reviews`.
- **Security:** isolation tests between organizations; admin sees only grants.
- **Launch criteria:** at least one pilot brokerage; written permission model signed off; no org-wide visibility without per-deal grant.

### Phase 5: Integrations and intelligence (open-ended, 60+ days)
- Microsoft calendar, then optional email connections, then DocuSign or CRM connectors by customer demand; AI assistant last.

**Total (Phases 1 to 4):** roughly 195 engineering days, about 9 to 10 months for one engineer, or 4 to 5 months for two. Phase 5 is demand-driven.

---

## 24. Estimated engineering effort summary

| Phase | Days | Cumulative |
|---|---|---|
| 1 Foundations | 40 | 40 |
| 2 Agent experience | 30 | 70 |
| 3 Automation | 55 | 125 |
| 4 Brokerage | 70 | 195 |
| 5 Integrations | 60+ | 255+ |

Already spent in the first pass: about 5 days equivalent (agent signup, onboarding, nav, marketing pages). Estimates carry +/-30 percent error and exclude pilot support, legal review of terms, and marketing content.

---

## 25. Features that should NOT be built yet

- **Auto-sent follow-ups** (rules engine `auto` mode): build ask-mode first.
- **Gmail inbox connection:** forwarding already covers the use case without Google's restricted-scope process.
- **MLS/RESO data:** blocked on licences and low value for coordination.
- **dotloop, SkySlope, Lone Wolf, DocuSign connectors:** only after a customer who pays for them asks and partner terms are confirmed.
- **Compliance review queue:** needs a real brokerage workflow and legal input; high risk of implied guarantees.
- **Authenticated client accounts:** a magic-link on top of the existing link is cheaper and safer.
- **Branded client portals for every plan:** only when a brokerage or team asks.
- **AI transaction assistant:** wait until extraction confidence, events and rules exist.
- **Three brokerage tiers:** start with per-agent plus a monthly minimum from pilot data.
- **Offices and sub-teams:** add only if a pilot needs them.
- **Per-role document matrices beyond internal / participants / client.**

---

## Conclusions

1. **Implementable immediately with existing functionality:** agent signup and onboarding (built, needs production test), agent use of the full engine for solo deals, free agent portal, client progress links, e-sign, listings, CRM, calendar, QuickBooks, per-deal email, marketing pages for agents and TCs and an honest brokerage page, the daily digest as a basic exception signal.
2. **Moderate development:** cross-deal agent task list, vocabulary and settings cleanup, extraction confidence, account-level intake as a draft queue, agent plans and AI caps, Microsoft calendar, event timeline.
3. **Major architectural work:** shared-transaction participants with central authorization and a test harness; organizations with explicit grants; rules engine and email intelligence; amendment comparison; organization billing.
4. **Blocked by external APIs or licensing:** MLS/RESO data (per-MLS licences); Lone Wolf (unverified); partner-gated connectors (dotloop, SkySlope, DocuSign production, Follow Up Boss) until terms are confirmed; Gmail inbox access until Google verification is accepted as a cost.
5. **Defer:** everything in section 25.
6. **Recommended first implementation milestone:** Phase 1 with one visible outcome: **an agent invites their TC to a deal, and both work the same transaction without duplication**, protected by a new authorization module and an automated cross-account test suite. It is the smallest change that makes the agent side genuinely complete, and it is the foundation the brokerage layer needs.

An honest caveat on the whole plan: the TC engine is strong, but permission-heavy expansion on a codebase with no tests and no database-level backstop is where mistakes become data leaks. Spend the first two weeks on tests and authorization, even though they show nothing to customers.
