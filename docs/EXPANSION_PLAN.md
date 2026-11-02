# Relay: expansion plan (agents, coordinators, brokerages)

Status: Stage 1 (audit) done. Stage 2/3 foundations and Stage 6 (website) are being built first. This file is the source of truth for what is done and what remains.

## 1. Audit summary (what exists today)

**Accounts.** Two kinds of Supabase Auth user:
- A normal account (coordinator today). Owns `agents` rows (a coordinator's CRM contact for an agent, with fee settings), `transactions.tc_user_id`, plan (Starter/Pro/Team, hidden Brokerage), trial (30 days), Stripe billing, optional Team workspace (`teams`, `team_members`; shared contacts + board only, pipelines stay private).
- A free agent-portal account (`app_metadata.role = 'agent'`). Limited to deals a coordinator added them to (`transaction_agents`), shown at `/agent/*`. No plan, no onboarding, no own transactions.

**Authorization.** The app always queries with the service-role client; every route checks ownership in code (`getVisibleTcUserIds`, `assertAgentOnTransaction`). RLS is a backstop only. Any change must keep checks in code.

**Reusable as-is for agents (no rebuild):** contract AI intake (`/api/transactions/extract-contract`), checklists and due dates, key dates, per-deal inbound email address, documents, e-sign, listings/offers/showings, client portal + messages, contacts CRM, calendar sync, search, Starter/Pro limits and Stripe flow.

**Gaps:** (1) no way to sign up as an agent or run your own deals; (2) onboarding, nav and home screen assume a coordinator (invoicing, "Agents" page); (3) `needsOnboarding` assumes "zero agent profiles = new"; (4) no agent-owned deal that a TC joins; (5) brokerage is only a hidden plan plus `brokerage_agents`/`teams.default_*` (assign/reassign TCs); no oversight dashboard; (6) email intelligence, amendment diff, auto follow-ups and exception dashboard are not built (partial pieces: attention panel, due-date reminders, inbound email ingestion).

## 2. Design decision: self-serve agent = normal account + persona

An agent who signs up is a **normal account** (same plans, trial, Stripe, full site). We add `user_metadata.account_type` (`tc` default, `agent`) and `user_metadata.coordination_mode` (`own_tc`, `self`, `automate`). These only change presentation (nav, onboarding, home copy). They never grant access; all authorization stays in code, so a user editing their own metadata gains nothing.

The agent's own profile is stored as one row in `agents` (fee 0, email = their login email). That lets every existing transaction, listing, checklist, invoice and contract-matching path work unchanged. The per-deal portal invite is skipped when the deal's agent is the account owner. No schema change is required, so existing accounts and data are untouched.

Existing accounts have no `account_type` and keep today's experience exactly.

## 3. Staged plan

| Stage | Scope | Status |
|---|---|---|
| 1 | Audit and plan | Done |
| 2 | Agent signup with persona, 3-question onboarding (mode, name/brokerage, first contract), role-aware nav, agent home | Built in this pass |
| 3 | Agent-owned deals using the existing full toolset; defaults agent on new deal; skip self-invite | Built in this pass |
| 3b | Agent invites their TC onto a deal (new `transaction_collaborators` table, RLS-backed, email invite) | Remaining |
| 4 | Automation: email intelligence, auto follow-ups (approve/pause), amendment diff with confirmation, exceptions dashboard (extends `attentionSummary`) | Remaining; design below |
| 5 | Brokerage orgs: `organizations`, `organization_members` (roles), offices, brokerage dashboard, standard checklists, reporting | Remaining; design below |
| 6 | Website repositioning: home, For Agents, For TCs, For Teams, For Brokerages | Built in this pass |
| 7 | Integrations layer (Gmail/Outlook, Google/Microsoft calendar first) | Remaining |

## 4. Remaining-stage designs (not built, not marketed as built)

**Automation (stage 4).** Rules table `automation_rules(owner, transaction scope, trigger, action, mode: ask | auto | paused)` and `automation_events` audit log. Every AI result is stored with the source text, a confidence value and a status (`proposed`, `confirmed`, `rejected`); important dates and terms are never changed without a confirm click. Follow-up emails default to `ask` (a draft the user approves). Amendment diff compares extracted fields of the original and the amendment and proposes changes to key dates and checklist items.

**Brokerage (stage 5).** `organizations`, `organization_members(role: owner|admin|broker|agent|tc)`, `offices`. Transactions gain a nullable `organization_id`. Membership never implies access to every deal: visibility is explicit (agent sees own, TC sees assigned, broker/admin see org-wide status and documents flagged for compliance review). Existing hidden Brokerage plan accounts migrate by creating an organization from their team.

**Integrations (stage 7).** One `integration_connections` table (provider, owner, encrypted tokens, scopes, status) behind a small provider interface. Official OAuth only. Start with Gmail/Outlook mail and Google/Microsoft calendar. DocuSign, Follow Up Boss, dotloop, SkySlope and MLS/RESO are not assumed available; each needs a partner/API check first.

## 5. Pricing recommendation (nothing changed in code)

Keep Starter $19, Pro $39, Team $89 (3 seats, +$30). Agents fit Starter/Pro today; the agent page says so. Proposed later, after usage data: an **Agent** plan at about $29 (includes automation usage cap), TC plans stay seat-based, **Brokerage** as per-active-agent pricing with a monthly minimum plus metered automation (AI actions). Never bill clients or invited participants. Do not ship billing changes without a separate decision.

## 6. Risks and mitigations

- A persona flag mistaken for authorization: it is presentation only; all checks stay server-side.
- Existing accounts affected: none; no migrations, `account_type` absent means current behaviour.
- AI claims: the site only describes what ships (contract intake, checklist, deadlines, reminders, deal email). Automation is labelled "coming".
- Agent portal accounts and self-serve accounts both exist; an email cannot be both. Signup with an email that already has a portal login will fail; a conversion flow is future work.
