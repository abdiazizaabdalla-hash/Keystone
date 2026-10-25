# Relay TC: Contacts / relationship layer roadmap

Relay is **not** a sales CRM. No leads, pipelines, or marketing automation. The goal is for
Relay to be the TC's database of the people they work with, with the history of each relationship.

Contacts is the general directory of people and organizations. Agents holds agent-specific
settings (fees, portal access). An agent has **one** underlying Contacts record
(`contacts.agent_id`), so there are never two disconnected records for the same person.

## Built (layers 1 and 2)

Migration: `add-contacts-relationships.sql` (run after `add-contacts-crm.sql`).

**Layer 1: contact management**
- Profiles: name, email, phone, company, role, tags, preferences/context notes.
- Person or organization type, and "works at" links from a person to an organization.
- Tags, search, filters (tag, type, newsletter), bulk actions, CSV import and export.
- Import from deals (people on deals are added automatically).
- Duplicate detection (same name or phone) and merge. Merging moves notes, history and reminders.
- Relationships: each profile lists the transactions and listings the person is on
  (as the agent, or by email as a party or seller).

**Layer 2: relationship management**
- Dedicated profile page at `/dashboard/contacts/[id]`; agents open it from Agents -> "Profile & history".
- Summary line: "12 transactions together, 2 active, last communicated 3 days ago".
- Notes and activity timeline (note, call, email, text, meeting).
- Follow-up reminders per contact, plus a Follow-ups panel at the top of Contacts.
- "Last communicated" counts only recorded interactions, never notes.

## Later (layer 3: insight)
- Agent activity dashboard: transactions per agent over time, closed volume, active now.
- Simple, transparent follow-up suggestions (rule-based, always showing the rule), for example
  "no transaction together in 60 days". No scoring and no black-box ranking.
- Referral source tracking ("who sent me this agent").
- Reminders surfaced on the main dashboard and in the daily attention summary email.
- Log an interaction automatically when a message or signature request is sent from Relay.

## Later (layer 4: engagement, only if customers ask)
- Groups and segmentation beyond tags.
- Email templates.
- Birthday and home-anniversary reminders.
- Newsletter management and campaign integration. Do **not** build an email-marketing platform;
  integrate with an established one (Mailchimp, Constant Contact) instead. The newsletter flag
  and export already cover the basic hand-off.
- Automated follow-ups.
- Import from Google Contacts or Outlook, and calendar integrations (needs Google approval first).

## Customer-discovery question
Would transaction history, notes and reminders per agent be valuable enough that a TC would
replace their current system (spreadsheet, phone contacts, another CRM) with Relay?
