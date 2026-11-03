# Relay TC - Transaction Coordinator Business Model

## Overview

Relay TC is a **transaction coordination service** for real estate agents. The TC (Transaction Coordinator) charges **agents a flat fee per closing** to handle administrative coordination from contract to close.

---

## The Relationship

```
AGENT (Real Estate Professional)
  ↓ sends executed contract
RELAY TC (Administrative Coordinator)
  ↓ manages timelines, coordinates parties
AGENT receives payment from CLIENT
  ↓
AGENT pays TC fee to RELAY TC
```

**Important:** This is NOT a commission system. The TC does not take a percentage of the agent's commission. The TC charges the agent a separate, agreed-upon fee for administrative services.

---

## Pricing Model (2026 Market Standard)

Based on current Texas real estate TC pricing:

| Service | Price |
|---------|-------|
| Buyer Contract-to-Close | $400 |
| Listing Contract-to-Close | $450 |
| Dual-sided Transaction | $650 |
| Lease Coordination | $100 |
| Terminated File (admin fee) | $150 |
| Rush File (+48hr) | +$75 |

### Default Configuration

**Buyer-side:** $400 flat fee, 0% additional percentage
**Listing-side:** $450 flat fee, 0% additional percentage

Or, if desired:

**Per-agent custom pricing:** Each agent can have their own flat fee + optional percentage override.

---

## What the TC Does (Included in Flat Fee)

### File Setup
- Transaction intake form
- File creation and organization
- Document folder structure
- Contact sheet creation
- Transaction timeline

### Contract Administration
- Review for completeness
- Deadline tracking
- Signature tracking
- Amendment/addendum management

### Third-Party Coordination
- Title/escrow
- Lender/financing
- Inspector/appraisal
- HOA coordination

### Transaction Monitoring
- Earnest money tracking
- Option period
- Inspection completion
- Appraisal status
- Financing progress
- Repair coordination
- Closing preparation

### Closing & Post-Closing
- Closing date confirmation
- Final walkthrough coordination
- Closing appointment coordination
- Funding confirmation
- Final document collection
- Brokerage compliance upload
- File archival

---

## What the TC Does NOT Do

These activities are outside the TC's scope:

- Client representation or advice
- Contract negotiations
- Legal or tax advice
- Listing marketing
- Showing properties
- Making underwriting decisions
- Selecting vendors on behalf of clients

---

## How Relay TC Implements This

### Agents Management (`/agents`)

Each agent can be configured with:

- **Name:** Agent's name
- **Brokerage:** Company they work for
- **Email/Phone:** Contact info
- **Flat Fee:** $ per transaction (default: $400 for buyer-side, $450 for listing-side)
- **Percentage Fee:** % of purchase price (optional, typically 0%)

### Transaction Workflow

1. Agent sends executed contract
2. TC creates transaction record
3. TC auto-generates checklist with standard deadlines
4. TC tracks completion as parties deliver documents
5. Agent updates transaction status as it progresses
6. When status → **"Closed"** → **Invoice auto-generates**
7. Invoice is sent to agent with payment due at closing

### Invoice Structure

```
RELAY TC INVOICE
═════════════════════

Property: 123 Main Street, Austin, TX 78704
File Number: ABC-2026-0047
Purchase Price: $425,000

───────────────────────────────────────
Flat TC Fee per Closing:        $400.00
Percentage Fee (0%):               $0.00
───────────────────────────────────────
TOTAL TC COORDINATION FEE:       $400.00

Due: Upon closing and funding
```

If an agent had a custom percentage fee configured (e.g., 0.5%):

```
Flat TC Fee per Closing:        $400.00
Percentage Fee (0.5%):          $212.50
───────────────────────────────────────
TOTAL TC COORDINATION FEE:       $612.50
```

---

## Payment Terms (Recommended)

**Option A: Pay at Closing** (Agent-friendly)
- No upfront cost
- Agent only pays if deal closes
- Risk: TC performs work on deals that die

**Option B: Split Payment**
- 50% when file opens
- 50% at closing
- Middle ground

**Option C: With Termination Fee**
- $400 if closed
- $150 if terminated during option period
- Protects TC from unpaid work

---

## Terminology Clarification

### What Relay TC IS
- "TC Fee" = the amount the TC charges
- "Flat Fee" = $ per transaction (not based on sale price)
- "Percentage Fee" = % of purchase price (optional)

### What Relay TC IS NOT
- "Commission" = this is what agents earn from clients; TC doesn't take this
- "Percentage of commission" = TC doesn't charge based on agent's commission

---

## Technical Implementation

### Database Schema
- **agents.flat_fee** = flat fee per closing
- **agents.commission_percent** = additional % fee on purchase price (typically 0)
- **invoices.amount_owed** = flat_fee + (purchase_price × commission_percent / 100)

### Invoice Numbering
Format: `RELAY-YYYYMMDD-XXXXX`

Example: `RELAY-20261030-00047`

### Invoice Due Date
Automatically set to **30 days from closing date**

### PDF Export
Click "Download PDF" on any invoice to get a printable/shareable version.

---

## How to Set Up

### 1. Navigate to Agents (`/agents`)

### 2. Click "Add Agent"

Fill in:
- Agent Name (required)
- Brokerage
- Email
- Phone
- **Flat Fee per Closing** (e.g., 400 for buyer-side)
- **Percentage Fee %** (usually 0; leave as default unless needed)

### 3. Create a Transaction

Go to `/transactions` → Create New Deal

- Select agent
- Enter file number, property, purchase price
- Checklist auto-generates

### 4. Close the Transaction

On transaction detail page:
- Update status dropdown to "Closed"
- Invoice **automatically generates**
- Invoice shows up in `/invoices`

### 5. Track Payment

On invoice detail page:
- View fee breakdown
- Download PDF
- Record payment when received
- Mark as Paid

---

## Real-World Scenario

**Sarah (Agent):** Needs transaction coordination

**Relay TC:** Sets Sarah's fees to $400/buyer, $450/listing

**Sarah sends contract:** 123 Main Street, $425k purchase price

**Relay TC:**
- Creates file
- Starts timeline
- Coordinates title, lender, inspector
- Tracks deadlines

**Sarah:** Updates transaction status as it progresses
- Contract Pending → Pre-Approval → In Progress → Final Review → **Closed**

**Relay TC:** When "Closed" is selected
- **Invoice auto-generates**
- Invoice #: RELAY-20261030-00047
- Amount: $400.00
- Due: 30 days

**Sarah's experience:**
> "I sent the contract. Relay handled everything administratively. When it closed, I saw a $400 invoice. I approved payment. Done."

---

## Why This Matters

### For the Agent
- ✅ Clear, fixed cost (no surprises)
- ✅ Professional administrative support
- ✅ Reduced risk of missed deadlines
- ✅ Better client experience

### For the TC
- ✅ Predictable revenue per transaction
- ✅ Scalable (same checklist, every time)
- ✅ Professional, organized workflow
- ✅ Clear scope (no scope creep)

---

## Common Questions

**Q: Does the TC take money from the agent's commission?**
A: No. The TC fee is separate and fixed. The agent keeps their full commission from the client.

**Q: What if the deal dies?**
A: If using "Pay at Closing" model, no payment is due. If using "Termination Fee" model, agent pays $150 admin fee.

**Q: Can I change the TC fee per agent?**
A: Yes! Each agent can have custom flat fee and percentage settings.

**Q: What if an agent's deals are more complex?**
A: Use the "Percentage Fee" field to add a % of purchase price (e.g., 0.5%) on top of flat fee.

**Q: Can I charge different prices for buyer vs. listing?**
A: Yes! Create separate "Buyer Coordinator" and "Listing Coordinator" profiles, each with their own pricing.

---

## Next Steps

1. ✅ Core system built and working
2. ⏳ Set up your agents with proper pricing
3. ⏳ Test with a sample transaction
4. ⏳ Customize invoice PDF template if needed
5. ⏳ Deploy to production
6. ⏳ Start coordinating transactions!
