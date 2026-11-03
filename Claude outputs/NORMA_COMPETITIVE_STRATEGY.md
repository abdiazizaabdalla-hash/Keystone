# Keystone vs. Norma — Competitive Positioning Notes

Captured verbatim from a strategy discussion on 2026-09-19. Paused mid-session
on the Pro/Team pass to save this for later product-direction work. Goal
next time: figure out how to fold this into the roadmap, starting with the
"foundation" additions (Deadlines, Waiting On, Next Action, Notes) since
they build directly on the checklist/document work already shipped.

---

Yes. I looked closely at Norma's current product positioning, and there is a useful distinction here: Keystone and Norma are currently converging on the same broad category, but you can differentiate Keystone substantially if you choose the right product strategy.

I could inspect Norma's public site, but I can't directly see your localhost:3000 instance from my environment. I can compare against the Keystone screens you've shown me so far.

## 1. What Norma actually does

Norma is positioning itself as a "daily closing desk" for transaction coordinators rather than simply a transaction database.

Its core idea is:

> Put the TC's tasks, deadlines, documents, email, follow-ups, and transaction context into one daily workspace. (Norma)

Their main areas are:

**Transactions** — Each transaction becomes a central workspace containing: dates, tasks, documents, people, notes, email actions, cover sheets, next steps. (Norma)

**Daily dashboard** — This is one of their biggest differentiators. Instead of opening "123 Main Street" and figuring out what to do, Norma wants the TC to open the app and see:

```
DO NOW
────────────────────
3 overdue follow-ups
2 tasks due today

COMING UP
────────────────────
Inspection tomorrow
Appraisal Friday
Closing in 8 days

WAITING ON
────────────────────
Lender → appraisal
Agent → repair amendment
Title → title commitment

RISK
────────────────────
2 files missing documents
```

That's explicitly how Norma describes its "Home desk." (Norma)

**Email** — This is another major piece. Norma wants email to become transaction work:

```
Email arrives
     ↓
Link to transaction
     ↓
Create task
     ↓
Add "Waiting On"
     ↓
Mark document received
     ↓
Reply using template
```

The email stays connected to the transaction. (Norma)

**Documents** — Norma tracks required documents, missing documents, transaction file status, cover sheets — rather than simply being a folder for PDFs. (Norma)

**AI** — Norma is using AI for: contract extraction, email signals, summaries, suggested next steps. Importantly, they emphasize reviewable AI, where the TC remains in control. (Norma)

**Intake** — They also have a separate product, Norma Intake, focused on contract-first transaction intake and AI-assisted review. (Norma) They also have UtilitySheet for collecting seller utility information. (Norma)

So their broader strategy is:

```
                    NORMA
                      │
       ┌──────────────┼──────────────┐
       ↓              ↓              ↓
     Intake       NormaTC       UtilitySheet
       │              │              │
  Start deal      Run deal      Utilities
                     │
              Daily closing desk
```

## 2. Where Keystone currently sits

From the Keystone UI shown so far, it's currently closer to:

```
TRANSACTION
    ↓
CHECKLIST
    ↓
DOCUMENTS
    ↓
PROGRESS
```

For example:

```
Contract Pending

Transaction Checklist

67%
4 of 6 completed

✓ Pre-Inspection
✓ Inspection
✓ Appraisal
✓ Underwriting
○ Funding
○ Closing

Other Documents
```

That's a good foundation, but if it stops there, it's essentially another transaction checklist application. There are already plenty of products in that category — tcDocs already offers customizable task lists, automatic due-date calculations, scheduled emails, status reporting and email templates. (tcDocs) Other newer products are also explicitly competing around AI intake, deadlines and automation. (tcTrack)

So the recommendation is not to try to beat Norma by simply adding more checklist features.

## 3. The real opportunity for Keystone

Position Keystone around:

> "The transaction operating system for the TC business."

Not just:

> "Where I track my transactions."

But:

> "Where I actually run my TC business."

That's a much bigger product.

```
NORMA
"Run today's closing desk."

KEYSTONE
"Run the entire transaction coordination business."
```

## 4. The biggest difference to build: Agent → TC → Transaction

A TC isn't just coordinating documents. They're managing relationships with multiple agents and dozens of transactions.

```
              KEYSTONE
                  │
       ┌──────────┼──────────┐
       ↓          ↓          ↓
    Agent A     Agent B    Agent C
       │          │          │
     12 deals    8 deals    15 deals
```

The TC should be able to see:

```
AGENTS

Sarah Johnson
15 active transactions
3 closing this week
2 waiting on agent
1 at risk

Mike Williams
8 active transactions
1 closing this week
0 at risk
```

Then click Sarah:

```
Sarah Johnson
────────────────────────────

Active Transactions       15

123 Main St               Underwriting
456 Oak Ave               Inspection
789 Pine Rd               Contract
...
```

That's business management, not just transaction management.

## 5. Agent portal as a major differentiator

Imagine the TC sends an agent "Your Keystone transaction portal." The agent doesn't have to email the TC "What's the status of 123 Main?" — they see:

```
123 Main Street
────────────────────────────

CLOSING
October 15

Progress
████████████░░ 85%

✓ Contract
✓ Earnest Money
✓ Inspection
✓ Repairs
✓ Appraisal
✓ Underwriting

WAITING ON
────────────────
Lender: Final loan approval

UPCOMING
────────────────
Final walkthrough
Oct 14

DOCUMENTS
────────────────
23 documents
```

That could be powerful — fewer "Any update?" emails for the TC.

## 6. Make "Waiting On" a first-class object

This is one thing Norma is doing that's worth copying conceptually. A checklist says "☐ Get appraisal" — but that's not really how a TC thinks. They think "I'm waiting on the lender for the appraisal." Those are different.

```
WAITING ON

123 Main Street

Person:
John Smith - Lender

Waiting for:
Appraisal

Requested:
Sept 17

Expected:
Sept 22

Status:
Waiting

[Send Follow-Up]
```

```
456 Oak Avenue

Waiting on:
Seller

Item:
Signed repair amendment

Requested:
Sept 18

Days waiting:
2

[Follow Up]
```

That turns Keystone into an actual work management system.

## 7. Another big opportunity: "Next Action"

Every transaction should answer one question: what does the TC need to do next?

```
123 Main Street

NEXT ACTION
────────────────────
Follow up with lender
for appraisal status

Due:
Today

[Email Lender]
```

Instead of making the TC scan 30 checklist items, the dashboard could literally be:

```
GOOD MORNING, ABDI

23 Active Transactions

━━━━━━━━━━━━━━━━━━━━━━━━━━

🔴 NEEDS ATTENTION
3 transactions

🟡 WAITING ON SOMEONE
8 transactions

🔵 DUE TODAY
6 tasks

📅 COMING UP
11 deadlines

✅ ON TRACK
15 transactions
```

That is much more valuable than "67% of checklist completed."

## 8. The document system should also become smarter

Don't make "Inspection + Upload" the entire document experience. Make documents structured:

```
DOCUMENTS
────────────────────

Contract & Disclosures
  ✓ Purchase Agreement
  ✓ Seller Disclosure
  ✓ Agency Disclosure

Earnest Money
  ✓ Earnest Money Receipt

Inspection & Repairs
  ✓ Inspection Report
  ✓ Repair Amendment

Title
  ✓ Title Commitment
  ⭕ Survey

Financing
  ✓ Pre-Approval
  ✓ Appraisal
  ⭕ Clear to Close

Closing
  ⭕ Closing Disclosure
  ⭕ Settlement Statement
```

Then Keystone can eventually tell the TC: "2 documents are still missing before this file is complete." That's much more valuable than simply allowing uploads.

(Note: the document-category redesign already shipped this session — categorized folders, optional checklist-stage link, search — lines up well with this section and is a solid base to build the "missing documents" logic on top of.)

## 9. AI is NOT where to differentiate first

Norma already markets AI contract scanning, AI-assisted review, email signals, summaries, suggested next steps. (Norma) Other competitors are also marketing AI contract extraction and automated document classification. (Transaction Sidekick) So don't pitch "Keystone uses AI" — that's becoming table stakes.

Instead, AI should power the workflow underneath:

```
Contract uploaded
       ↓
AI extracts information
       ↓
Keystone creates transaction
       ↓
Calculates deadlines
       ↓
Creates required documents
       ↓
Creates tasks
       ↓
Creates Waiting On items
       ↓
Creates email drafts
       ↓
TC reviews
       ↓
SEND
```

The customer doesn't care that GPT extracted the date. They care that "I uploaded the contract and my file was basically ready." That's the value.

## 10. Strongest potential differentiator: automation

Agent sends contract via email ("NEW DEAL - 123 Main Street", attachment: Executed Contract.pdf). Keystone detects it and automatically:

- Creates transaction
- Identifies property
- Identifies buyer/seller
- Identifies purchase price
- Identifies closing date
- Calculates deadlines
- Creates checklist
- Creates document requirements
- Creates agent record
- Sends confirmation

TC opens Keystone:

```
NEW TRANSACTION READY FOR REVIEW

123 Main Street
$500,000
Closing: Oct 15

AI extracted:
✓ 18 fields

Deadlines:
✓ 9 created

Documents:
✓ Contract received
⚠ 7 required documents outstanding

[Review & Activate]
```

That's a very compelling workflow.

## 11. Make Keystone more "operations" oriented than Norma

```
Norma
What do I need to do today?

Keystone
What is happening across my entire business,
what needs attention, and what can I automate?
```

The Keystone dashboard could eventually be:

```
KEYSTONE

Good morning.

────────────────────────────────────────

ACTIVE TRANSACTIONS
42

CLOSING THIS WEEK
6

NEEDS ATTENTION
4

WAITING ON
13

OVERDUE
2

────────────────────────────────────────

TODAY

🔴 123 Main
    Follow up with lender

🟡 456 Oak
    Waiting for repair amendment

🟡 789 Pine
    Appraisal overdue

────────────────────────────────────────

UPCOMING CLOSINGS

Sep 20    123 Main
Sep 21    456 Oak
Sep 23    789 Pine
Sep 24    321 Elm
```

Then below:

```
AGENT ACTIVITY

Sarah      15 active
Mike        8 active
John       12 active
Lisa        7 active
```

That's something a TC business owner would actually use every morning.

## 12. Broader market lesson

The market is already moving toward: TC software = workflow + documents + deadlines + email + automation. That's evident across current products: TC Track emphasizes automated deadlines, workflows and team collaboration; TC Desk emphasizes workflows, compliance, documents, deadline control and team management; and Norma explicitly positions itself around daily work, email, waiting-on items and risk. (tcTrack)

So don't build "a nicer checklist." Build "the system that runs the TC."

## Roadmap sketch

**NOW — foundation** (current: Transactions, Checklist, Documents, Agents, Invoices)
Add: Deadlines → Document categories (done) → Tasks → Waiting On → Notes → Next Action

**NEXT — actual TC operating system**
Daily dashboard → Agent portal → Email integration → Email → transaction → Email → task → Email → waiting-on → Automated reminders → Transaction health

**THEN — automation**
Contract upload → AI extraction → Transaction creation → Deadline calculation → Checklist creation → Document requirements → Email drafts → TC review

**LATER — business platform**
Agent management → TC team management → Revenue → Invoices → Payments → Performance analytics → Agent reporting → Brokerage reporting

## Positioning

Not "Keystone is better than Norma" — there's too much overlap, and Norma is currently in private beta for its main TC product. (Norma)

Instead, make the product concept distinct:

> Keystone is the operating system for transaction coordinators — managing every transaction, agent, deadline, document, follow-up, and payment from one place.

The key conceptual difference: Norma's public positioning is centered on the TC's daily closing desk. Keystone can be centered on the entire TC operation — the files + agents + workflow + documents + communication + business.
