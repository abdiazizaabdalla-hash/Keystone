# Gate G1: click-through script (TC, agent, broker)

Run this on your own machine against the local app (relay-test database, `brokerage`, `agent_workspace` and `templates` flags on). The demo logins and their shared local password are in `.local-accounts.txt`; use a private window per role so sessions do not mix. Tick each box; write anything odd next to it. "Expect" is what should happen.

Roles: **TC** `tc@local.relay` · **Agent** `agent-workspace@local.relay` · **Broker** `broker@local.relay` (Team plan, owns "Demo Brokerage").

Before you start: the relay-test database needs `add-brokerage-oversight.sql`, `add-commission-estimates.sql` and `add-brokerage-file-review.sql` (all applied). Production needs those three too before any flag is turned on, and the flags stay off until you sign off here.

## A. TC (the existing product must be unchanged)

1. [ ] Sign in as the TC. Expect: Home, Transactions, Listings, Calendar, Messages, Invoices, Contacts, Templates, Search, Collaborate in the sidebar. No "Membership", no "File review".
2. [ ] Open a transaction. Expect: checklist, key dates, documents, messages, contacts all as before. Tick a checklist step, add a key date, upload a document.
3. [ ] Create a new deal (manual, then try the AI contract intake with a sample contract). Expect: checklist is built, deadlines computed.
4. [ ] Invite an agent to a deal (the free portal login). Expect: the invite email is in `email_outbox`; the agent sees the deal after accepting.
5. [ ] Settings. Expect: Agent Defaults, Invoicing and Due-date workflow blocks are all still visible to the TC.
6. [ ] Invoices: create an invoice for a closed deal. Expect: unchanged.
7. [ ] Collaborate as a TC with no brokerage: Expect the team Overview/Messages/Contacts/People/Settings tabs, not the Agents/File review tabs.
8. [ ] Phone width (about 390 px): sidebar, a transaction, and the checklist are usable with no sideways scroll.

## B. Agent (own workspace, then inside a brokerage)

1. [ ] Sign in as the agent. Expect: own Home and Transactions, Listings, Contacts, Templates; Collaborate in the sidebar.
2. [ ] Collaborate. Expect tabs: Messages, People, Contacts, Templates, Membership. Nothing about Agents, File review or Commissions.
3. [ ] Membership. Expect: the brokerage you are in, "What they can see and change" (read-only copy of your deals, they confirm commissions), Leave button. Do not leave yet.
4. [ ] Messages. Expect: Team board and a private thread with the broker. Send a private message. Expect: it appears; the broker gets a bell and an email in `email_outbox` (one email for a burst of messages, not one per message).
5. [ ] Create or open your own deal and edit it. Expect: you can edit; the broker's view of it updates.
6. [ ] Move a deal to Closed. Expect: the broker is notified; a commission estimate appears only after closing.
7. [ ] Commission: when the broker confirms a statement, accept it or ask for a change. Expect: you get a bell and an email for confirm and for paid.
8. [ ] If the broker flags a file (section C step 9), Expect: a bell and an email with the broker's note; your deal itself is unchanged.
9. [ ] Contacts tab in Collaborate. Expect: shared contacts only, no notes, no add or sync buttons.
10. [ ] Phone width: Messages inbox and Membership usable.

Invitation flow (use a second agent login or `agent-free@local.relay` upgraded by admin): the invite appears under Membership with Accept and Decline; accepting is blocked while you are already in a brokerage.

## C. Broker

1. [ ] Sign in as the broker. Expect: sidebar has no separate "Agents" item; Collaborate opens on the Agents tab.
2. [ ] Agents tab. Expect: totals (agents, open deals, late items, closing this week), search, one row per agent with open deals, late, closing this week, last activity. A row opens that agent's profile with their deals and listings.
3. [ ] Invite an agent by email. Expect: pending invitation listed. Click **Resend**. Expect: "Invitation sent again"; a fourth resend in one day is refused with a clear message; the emails are in `email_outbox`. Click **Cancel**. Expect: gone.
4. [ ] Open an agent's deal. Expect: a read-only copy: no edit, upload or checklist controls. (The server also refuses: try the deal page after hiding buttons only if you want to confirm.)
5. [ ] **Export production (CSV)** on the Agents tab. Expect: a CSV with Month, Agent, Email, Closed deals, Sales volume, one row per agent per month for this year. Open it in a spreadsheet.
6. [ ] **File review** tab. Click Choose documents, tick Purchase Contract and Survey, Save. Expect: files listed (closed in the last 180 days or closing within 30 days), each with "Missing: …" chips or "All required documents".
7. [ ] Mark one file reviewed. Expect: moves out of "To do"; All files shows "Reviewed <date>"; Undo returns it.
8. [ ] Flag another with a note. Expect: shows Flagged with your note; the agent gets bell + email.
9. [ ] Commissions tab. For a closed deal: confirm a statement, then (after the agent accepts) mark it paid. Expect: statuses move estimate, proposed, accepted, paid; emails go to the agent each time; CSV download of the ledger works.
10. [ ] Messages. Expect: team board plus a private thread per agent; unread counts clear when read.
11. [ ] Templates: share one with the brokerage. Expect: the agent sees it pinned.
12. [ ] Settings. Expect: no Agent Defaults, no Invoicing, no due-date workflow blocks; the brokerage-relevant settings remain.
13. [ ] Weekly digest: call `GET /api/cron/brokerage-digest` with the `CRON_SECRET` bearer. Expect: one email per broker with agents (in `email_outbox`), a line per agent; nothing without the secret (401).
14. [ ] Privacy check: the broker can never see an agent's client messages, fee terms or private contacts. Confirm none appear in the deal view or profile.
15. [ ] Phone width: Agents list, File review list and the Flag form are usable.

## D. Things this run cannot prove (decide before launch)

- Real email delivery: locally everything goes to `email_outbox`. Resend domain verification and a real inbox test are still open.
- Scale: the roster and review list read up to 2,000 deals; a brokerage with 100+ agents needs a look at paging.
- Production: all brokerage and agent flags are off in Vercel. Turning them on needs the three SQL files, `add-team-messaging.sql` and `add-contacts-team-sharing.sql` applied to production first.
- Lawyer review of Terms and Privacy, which now describe a read-only brokerage view.

## Sign-off

TC ☐ Agent ☐ Broker ☐ · Notes: ______ · Date: ______
