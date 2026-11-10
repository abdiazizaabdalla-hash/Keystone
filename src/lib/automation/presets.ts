import type { Category, Step, StepType } from './library';

// Ready-made automations. Each is a plain definition that goes through the same validation as one a person builds, so a preset
// can never do more than a hand-made automation can. "Use this" copies it into the person's own library to customize.
// Email wording is deliberately plain and generic; people edit it before or after saving.

export interface Preset {
  id: string;
  category: Category;
  tier: 'essential' | 'advanced';
  name: string;
  summary: string;
  triggerType: string;
  steps: Step[];
  /** Plain-language limits worth knowing before using it. */
  notes?: string[];
}
export interface ComingSoon {
  name: string;
  category: Category | 'both';
  summary: string;
  needs: string;
}

let n = 0;
const step = (type: StepType, days: number, direction: 'after' | 'before', fields: Partial<Step>): Step => ({ id: `s${++n}`, type, when: { days, direction }, ...fields });
const email = (days: number, direction: 'after' | 'before', to: string[], subject: string, message: string) => step('send_email', days, direction, { to, subject, message });
const task = (days: number, direction: 'after' | 'before', name: string, dueInDays?: number) => step('create_task', days, direction, { name, dueInDays: dueInDays ?? null });
const notify = (days: number, direction: 'after' | 'before', title: string, body = '') => step('notify_me', days, direction, { title, body });
const note = (days: number, direction: 'after' | 'before', text: string) => step('add_note', days, direction, { text });
const make = (p: Omit<Preset, 'steps'>, build: () => Step[]): Preset => {
  n = 0;
  return { ...p, steps: build() };
};

const CLIENTS = ['buyer', 'seller'];
const NEVER_COMPLETES = 'Sends reminders only. It never marks anything received or complete; you do that on the deal.';

export const PRESETS: Preset[] = [
  // ---- Transactions: contract and onboarding ----
  make({ id: 'tx-welcome', category: 'transaction', tier: 'essential', name: 'New Transaction Welcome', summary: 'Introduces you to the client the moment a transaction is created and sets up your first tasks.', triggerType: 'transaction_created', notes: ['Client portal access is a task for you; Relay does not send portal invites by itself yet.'] }, () => [
    email(0, 'after', CLIENTS, 'Welcome: {{address}}', 'Hello,\n\nThank you for choosing us. I will be coordinating the transaction for {{address}} (file {{file_number}}) from contract to closing.\n\nOver the coming weeks I will send you reminders, ask for any documents we need, and keep you posted on key dates. If you have a question at any point, just reply to this email.\n\nThank you,'),
    task(0, 'after', 'Send client portal access and contact details', 1),
    task(0, 'after', 'Verify earnest money delivery', 3),
    notify(0, 'after', 'New transaction set up: {{address}}', 'Welcome email prepared. Review the first tasks.'),
  ]),
  make({ id: 'tx-contract-review', category: 'transaction', tier: 'essential', name: 'Contract Review and Verification', summary: 'When a contract is uploaded: review tasks, a deadline check and a heads-up to the agent.', triggerType: 'contract_uploaded' }, () => [
    task(0, 'after', 'Review the contract and verify all dates', 1),
    task(0, 'after', 'Check for blank fields and missing signatures', 1),
    notify(0, 'after', 'Contract uploaded for {{address}}', 'Verify the deadlines before you rely on them.'),
    email(0, 'after', ['agent'], 'Contract received: {{address}}', 'Hello,\n\nThe contract for {{address}} (file {{file_number}}) has been uploaded and I am reviewing it now. I will let you know if anything is missing or unclear.\n\nThank you,'),
  ]),
  make({ id: 'tx-doc-collection', category: 'transaction', tier: 'essential', name: 'Transaction Document Collection', summary: 'Asks the client for what is still needed, then reminds them and you.', triggerType: 'transaction_created', notes: ['Relay does not yet know which documents are still missing, so the reminders are the same for every deal.'] }, () => [
    task(0, 'after', 'Collect required documents from all parties', 3),
    email(2, 'after', CLIENTS, 'Documents we still need for {{address}}', 'Hello,\n\nTo keep {{address}} on track, please send over any documents you have not yet shared, such as signed disclosures, pre-approval or proof of funds, and ID if requested. Reply to this email with the files or let me know if you need help finding them.\n\nThank you,'),
    email(5, 'after', CLIENTS, 'Reminder: documents for {{address}}', 'Hello,\n\nA quick reminder that we are still waiting on a few items for {{address}}. Sending them soon helps us avoid delays before closing on {{closing_date}}.\n\nThank you,'),
    notify(7, 'after', 'One week in: check outstanding documents for {{address}}'),
  ]),
  make({ id: 'tx-onboarding-sequence', category: 'transaction', tier: 'advanced', name: 'Buyer/Seller Onboarding Sequence', summary: 'A three-email sequence over the first four days: welcome, how the process works, outstanding items.', triggerType: 'transaction_created', notes: ['The sequence runs on its schedule. It does not stop on its own when onboarding is finished; switch it off or remove it from the deal.'] }, () => [
    email(0, 'after', CLIENTS, 'Welcome: {{address}}', 'Hello,\n\nWelcome, and thank you for trusting us with {{address}}. I will be your point of contact through closing.\n\nThank you,'),
    email(2, 'after', CLIENTS, 'How the process works for {{address}}', 'Hello,\n\nHere is what to expect: we confirm the contract dates, collect the documents each party owes, track inspection, appraisal and financing deadlines, and prepare for closing on {{closing_date}}. You will hear from me whenever something needs your attention.\n\nThank you,'),
    email(4, 'after', CLIENTS, 'Anything outstanding for {{address}}?', 'Hello,\n\nChecking in: please send anything you still owe on {{address}}, and tell me if any of the dates or details above look wrong.\n\nThank you,'),
  ]),
  // ---- Transactions: deadlines ----
  make({ id: 'tx-earnest-money', category: 'transaction', tier: 'essential', name: 'Earnest Money Reminder', summary: 'Reminds the buyer and agent two days before earnest money is due, and flags you on the day.', triggerType: 'earnest_money_due', notes: ['Needs an Earnest money date in the deal Critical dates.', NEVER_COMPLETES, 'Stops once you mark that date done.'] }, () => [
    email(2, 'before', ['buyer', 'agent'], 'Earnest money due soon: {{address}}', 'Hello,\n\nA reminder that earnest money for {{address}} is due in two days. Please deliver it as the contract requires and send me the receipt so I can confirm it.\n\nThank you,'),
    notify(2, 'before', 'Earnest money due in 2 days: {{address}}'),
    notify(0, 'before', 'Earnest money is due today: {{address}}', 'Confirm receipt, then mark it done in Critical dates.'),
  ]),
  make({ id: 'tx-inspection', category: 'transaction', tier: 'essential', name: 'Inspection / Option Period Reminder', summary: 'Warns you and the agent three days and one day before the inspection or option period ends.', triggerType: 'inspection_deadline', notes: ['Needs an Inspection date in the deal Critical dates.', NEVER_COMPLETES] }, () => [
    notify(3, 'before', 'Inspection / option period ends in 3 days: {{address}}'),
    email(3, 'before', ['agent'], 'Inspection deadline in 3 days: {{address}}', 'Hello,\n\nThe inspection / option period for {{address}} ends in three days. Please let me know if the inspection is done or if anything needs to be extended or negotiated.\n\nThank you,'),
    notify(1, 'before', 'Inspection / option period ends tomorrow: {{address}}'),
    email(1, 'before', ['agent'], 'Inspection deadline tomorrow: {{address}}', 'Hello,\n\nThe inspection / option period for {{address}} ends tomorrow. Please confirm where things stand today.\n\nThank you,'),
  ]),
  make({ id: 'tx-financing', category: 'transaction', tier: 'essential', name: 'Financing Deadline Reminder', summary: 'Three days before the financing contingency: notifies you and emails the agent and buyer.', triggerType: 'financing_deadline', notes: ['Needs a Financing date in the deal Critical dates.', NEVER_COMPLETES] }, () => [
    notify(3, 'before', 'Financing deadline in 3 days: {{address}}'),
    email(3, 'before', ['agent', 'buyer'], 'Financing deadline approaching: {{address}}', 'Hello,\n\nThe financing contingency deadline for {{address}} is three days away. Please confirm with the lender that loan approval is on track, and tell me right away if an extension may be needed.\n\nThank you,'),
  ]),
  make({ id: 'tx-appraisal', category: 'transaction', tier: 'essential', name: 'Appraisal Follow-up', summary: 'Two days before the appraisal deadline: a follow-up task, a notification and a nudge to the agent.', triggerType: 'appraisal_deadline', notes: ['Needs an Appraisal date in the deal Critical dates.', 'Stops once you mark the appraisal date done, so nothing is sent if it is already confirmed.'] }, () => [
    task(2, 'before', 'Follow up on appraisal status', 1),
    notify(2, 'before', 'Appraisal deadline in 2 days: {{address}}', 'Confirm the appraisal is ordered and scheduled.'),
    email(2, 'before', ['agent'], 'Appraisal status: {{address}}', 'Hello,\n\nThe appraisal deadline for {{address}} is two days away. Do you have the appraisal date or result? Please send it to me so I can update the file.\n\nThank you,'),
  ]),
  make({ id: 'tx-title', category: 'transaction', tier: 'advanced', name: 'Title Commitment Follow-up', summary: 'Asks the title contact for the commitment three days before it is due, and tells you.', triggerType: 'title_commitment_due', notes: ['Needs a Title commitment date in the deal Critical dates and a title contact with an email on the deal.'] }, () => [
    email(3, 'before', ['title'], 'Title commitment for {{address}}', 'Hello,\n\nCould you confirm when we can expect the title commitment for {{address}} (file {{file_number}})? It is due in three days.\n\nThank you,'),
    notify(3, 'before', 'Title commitment due in 3 days: {{address}}'),
  ]),
  // ---- Transactions: closing ----
  make({ id: 'tx-closing-countdown', category: 'transaction', tier: 'essential', name: 'Closing Countdown', summary: 'Closing prep a week out and a reminder two days out, with final document tasks.', triggerType: 'closing_date' }, () => [
    email(7, 'before', CLIENTS, 'Getting ready to close: {{address}}', 'Hello,\n\nClosing for {{address}} is scheduled for {{closing_date}}, one week from now. Please plan to bring a government-issued photo ID, confirm how you will deliver any closing funds, and tell me if anything has changed.\n\nThank you,'),
    task(7, 'before', 'Final document verification', 3),
    notify(7, 'before', 'Closing in 7 days: {{address}}'),
    email(2, 'before', CLIENTS, 'Closing in 2 days: {{address}}', 'Hello,\n\nClosing for {{address}} is in two days, on {{closing_date}}. Please let me know right away if you have any questions or if anything has changed.\n\nThank you,'),
    notify(2, 'before', 'Closing in 2 days: {{address}}'),
  ]),
  make({ id: 'tx-walkthrough', category: 'transaction', tier: 'essential', name: 'Final Walkthrough Reminder', summary: 'Two days before closing: asks the agent to arrange the walkthrough and adds a completion task.', triggerType: 'closing_date' }, () => [
    email(2, 'before', ['agent'], 'Final walkthrough: {{address}}', 'Hello,\n\nClosing for {{address}} is in two days. Please coordinate the final walkthrough with your client and let me know when it is done.\n\nThank you,'),
    task(2, 'before', 'Confirm final walkthrough was completed', 1),
    notify(2, 'before', 'Final walkthrough due: {{address}}'),
  ]),
  make({ id: 'tx-closing-day', category: 'transaction', tier: 'essential', name: 'Closing Day Workflow', summary: 'On closing day: a message to the client, a confirmation task and a prompt to update the status.', triggerType: 'closing_date', notes: ['It does not change the transaction status; it reminds you to.'] }, () => [
    email(0, 'before', CLIENTS, 'Closing day: {{address}}', 'Hello,\n\nToday is closing day for {{address}}. Please let me know right away if anything comes up. Congratulations on reaching this milestone.\n\nThank you,'),
    task(0, 'before', 'Confirm closing happened and funds recorded', 0),
    notify(0, 'before', 'Closing day: update the status of {{address}}', 'Mark the transaction Closed once it has recorded.'),
  ]),
  make({ id: 'tx-post-closing', category: 'transaction', tier: 'advanced', name: 'Post-Closing Follow-up', summary: 'After a deal is marked closed: congratulations, then a review request, then a referral request.', triggerType: 'deal_closed', notes: ['Sends from the day you mark the transaction Closed. Archiving tasks is not automated.'] }, () => [
    email(0, 'after', CLIENTS, 'Congratulations: {{address}}', 'Hello,\n\nCongratulations, and thank you for letting us help with {{address}}. It was a pleasure working with you.\n\nThank you,'),
    email(3, 'after', CLIENTS, 'Would you share a quick review?', 'Hello,\n\nNow that things have settled, would you take a minute to share a review of your experience? It makes a real difference to us.\n\nThank you,'),
    email(14, 'after', CLIENTS, 'Know someone buying or selling?', 'Hello,\n\nIf you have friends or family who are buying or selling, we would be glad to help them the way we helped you. Feel free to pass along my contact details.\n\nThank you,'),
  ]),
  // ---- Listings ----
  make({ id: 'li-prep', category: 'listing', tier: 'essential', name: 'Listing Preparation Reminders', summary: 'When a listing is created: a prep note, then check-ins at three and seven days.', triggerType: 'listing_created' }, () => [
    notify(0, 'after', 'New listing: {{address}}', 'Start preparation: photography, staging, signage, disclosures and marketing materials.'),
    task(0, 'after', 'Book listing photography', 5),
    task(0, 'after', 'Order yard sign and lockbox', 5),
    task(0, 'after', 'Collect seller disclosures', 7),
    notify(3, 'after', 'Listing preparation check-in: {{address}}'),
    notify(7, 'after', 'One week since {{address}} was created: is preparation done?'),
  ]),
  make({ id: 'li-live', category: 'listing', tier: 'essential', name: 'Listing Goes Live: Tell the Seller', summary: 'On the planned list date: emails the seller that the listing is live and adds a marketing follow-up.', triggerType: 'listing_planned_list_date', notes: ['Needs a planned list date and a seller contact with an email on the listing. Drafts wait for your approval unless the listing is on Auto.'] }, () => [
    email(0, 'after', ['seller'], '{{address}} is going live', 'Hello,\n\nGood news: {{address}} is going live today. I will keep you posted on showings and feedback as they come in.\n\nThank you,'),
    task(1, 'after', 'Check online listing syndication for {{address}}', 2),
  ]),
  make({ id: 'li-offer', category: 'listing', tier: 'essential', name: 'New Offer Received', summary: 'When an offer is added: notifies you, adds a review task and drafts a note to the seller. It never accepts or rejects.', triggerType: 'offer_received', notes: ['Needs a seller contact with an email on the listing. Drafts wait for your approval unless the listing is on Auto.'] }, () => [
    notify(0, 'after', 'New offer on {{address}}', 'Review the offer terms and let the seller know.'),
    task(0, 'after', 'Review the new offer with the seller', 1),
    email(0, 'after', ['seller'], 'New offer on {{address}}', 'Hello,\n\nWe have received a new offer on {{address}}. I am reviewing the terms and will walk you through them shortly.\n\nThank you,'),
  ]),
  make({ id: 'li-prelaunch', category: 'listing', tier: 'essential', name: 'Pre-Launch Countdown', summary: 'Counts down to the planned list date so nothing is missed before the listing goes live.', triggerType: 'listing_planned_list_date', notes: ['Needs a planned list date on the listing.'] }, () => [
    notify(3, 'before', 'Listing goes live in 3 days: {{address}}', 'Confirm photos, description and pricing are final.'),
    notify(1, 'before', 'Listing goes live tomorrow: {{address}}'),
    notify(0, 'before', 'Planned list date is today: {{address}}', 'Activate the listing and tell the seller it is live.'),
  ]),
  make({ id: 'li-seller-updates', category: 'listing', tier: 'advanced', name: 'Seller Update Reminders', summary: 'Weekly reminders for the first four weeks to send the seller an activity update.', triggerType: 'listing_created', notes: ['Reminds you; it does not write or send the update yet.'] }, () => [
    notify(7, 'after', 'Send the seller a weekly update: {{address}}'),
    notify(14, 'after', 'Send the seller a weekly update: {{address}}'),
    notify(21, 'after', 'Send the seller a weekly update: {{address}}'),
    notify(28, 'after', 'Send the seller a weekly update: {{address}}'),
  ]),
  make({ id: 'li-expiration', category: 'listing', tier: 'essential', name: 'Listing Expiration Warning', summary: '14, 7 and 2 days before the listing expires: notifies you and prompts a seller conversation.', triggerType: 'listing_expiration', notes: ['Needs an expiration date on the listing.'] }, () => [
    notify(14, 'before', 'Listing expires in 14 days: {{address}}', 'Talk to the seller about renewal or next steps.'),
    notify(7, 'before', 'Listing expires in 7 days: {{address}}'),
    note(7, 'before', 'Follow up with the seller about renewal or next steps.'),
    notify(2, 'before', 'Listing expires in 2 days: {{address}}'),
  ]),
  make({ id: 'li-expired', category: 'listing', tier: 'essential', name: 'Listing Expired', summary: 'On the expiration date: tells you and prompts a status update and seller follow-up.', triggerType: 'listing_expiration', notes: ['It does not check whether the listing is still active, and it does not change its status.'] }, () => [
    notify(0, 'after', 'Listing expiration date reached: {{address}}', 'Update the listing status and follow up with the seller.'),
    note(0, 'after', 'Expiration date reached. Update the listing status and follow up with the seller.'),
  ]),
];

/** Wanted, but they need events or data Relay does not record yet. Shown so nobody wonders where they are. */
export const COMING_SOON: ComingSoon[] = [
  { name: 'Listing Activation Workflow', category: 'listing', summary: 'Tell the seller the listing is live and create marketing follow-ups.', needs: 'A listing status change event.' },
  { name: 'Showing Confirmation and Post-Showing Follow-up', category: 'listing', summary: 'Notify the seller and agent of showings and collect feedback.', needs: 'Showings recorded in Relay.' },
  { name: 'No Showing Activity Alert', category: 'listing', summary: 'Alert the agent after 7 days without showings.', needs: 'Showings recorded in Relay.' },
  { name: 'Accepted Offer Handoff', category: 'listing', summary: 'Start a transaction from the listing and suggest its automations.', needs: 'Offers and listing-to-transaction conversion.' },
  { name: 'Missing Document Escalation', category: 'transaction', summary: 'Remind and escalate when a required document is overdue.', needs: 'Required documents tracked per deal.' },
  { name: 'Stalled Transaction Detection', category: 'transaction', summary: 'Flag deals with no progress.', needs: 'Conditions and activity tracking (phase 2).' },
  { name: 'Brokerage Deal Oversight', category: 'both', summary: 'Show brokerage owners which deals are falling behind.', needs: 'Brokerage-wide templates (phase 3).' },
];
