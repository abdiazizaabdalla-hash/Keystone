// Email templates attached to checklist steps: each step on a deal can open a
// ready-to-send email with the deal's details already filled in.
//
// A TC's saved version of a step's template (table step_email_templates) wins;
// otherwise the built-in default for that step name is used; otherwise a short
// generic template. Merge fields are written {{like_this}} in the stored text and
// filled in only when the email is opened, so one template serves every deal.

export type RecipientKind = 'agent' | 'lender' | 'title' | 'client' | 'inspector' | 'any';

export interface StepEmailTemplate {
  subject: string;
  body: string;
  /** Who this email usually goes to; used only to pre-tick recipients. */
  suggestedRecipients: RecipientKind[];
}

export const MERGE_FIELDS: { key: string; label: string }[] = [
  { key: 'property_address', label: 'Property address' },
  { key: 'file_number', label: 'File number' },
  { key: 'agent_name', label: 'Agent full name' },
  { key: 'agent_first_name', label: 'Agent first name' },
  { key: 'acceptance_date', label: 'Acceptance date' },
  { key: 'closing_date', label: 'Closing date' },
  { key: 'step_name', label: 'Checklist step' },
  { key: 'due_date', label: 'Step due date' },
  { key: 'tc_name', label: 'Your name' },
];

export type MergeVars = Record<string, string>;

/** Normalizes a step name to the key templates are stored under ("Clear to Close" -> "cleartoclose"). */
export function stepKey(stepName: string): string {
  return stepName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80);
}

/** Replaces {{field}} with its value. Unknown fields and empty values become a [bracketed prompt] the TC has to resolve before sending. */
export function fillTemplate(text: string, vars: MergeVars): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_match, key: string) => {
    const value = vars[key];
    if (value && value.trim()) return value;
    const label = MERGE_FIELDS.find((f) => f.key === key)?.label.toLowerCase() ?? key.replace(/_/g, ' ');
    return `[${label}]`;
  });
}

/** True while any [bracketed prompt] is still in the text. */
export function hasUnresolvedPrompts(...texts: string[]): boolean {
  return texts.some((t) => /\[[^\]\n]{1,60}\]/.test(t));
}

const SIGNOFF = '\n\nThank you,\n{{tc_name}}';

export const DEFAULT_STEP_TEMPLATES: Record<string, StepEmailTemplate> = {
  [stepKey('Contract & File Setup')]: {
    subject: 'Your file is open: {{property_address}}',
    body:
      'Hi {{agent_first_name}},\n\nI have opened the file for {{property_address}} and will be coordinating the transaction from here.\n\n' +
      'Acceptance date: {{acceptance_date}}\nClosing date: {{closing_date}}\n\n' +
      'If anything is still outstanding (fully executed contract, addenda, HOA documents, buyer or seller contact details), please send it my way. ' +
      'I will keep you posted at every step.' +
      SIGNOFF,
    suggestedRecipients: ['agent'],
  },
  [stepKey('Earnest Money & Option')]: {
    subject: 'Earnest money and option fee: {{property_address}}',
    body:
      'Hello,\n\nI am coordinating the transaction for {{property_address}} (file {{file_number}}). ' +
      'Could you please confirm that you have received the earnest money and option fee, and send me a copy of the receipt?\n\n' +
      'The closing date is {{closing_date}}.' +
      SIGNOFF,
    suggestedRecipients: ['title'],
  },
  [stepKey('Inspection & Repairs')]: {
    subject: 'Inspection update: {{property_address}}',
    body:
      'Hi {{agent_first_name}},\n\nQuick update on the inspection for {{property_address}}: [inspection status, for example scheduled for a date or report received].\n\n' +
      'Next step: [repair request, amendment, or nothing needed]. Let me know how you would like to handle it and I will take care of the paperwork.' +
      SIGNOFF,
    suggestedRecipients: ['agent'],
  },
  [stepKey('Title, Appraisal & Financing')]: {
    subject: 'Status check: title, appraisal and financing for {{property_address}}',
    body:
      'Hello,\n\nI am following up on {{property_address}} (file {{file_number}}), closing {{closing_date}}. ' +
      'Could you give me a quick status on the title commitment, the appraisal, and loan approval, and let me know if you need anything from the buyer or seller?' +
      SIGNOFF,
    suggestedRecipients: ['lender', 'title'],
  },
  [stepKey('Clear to Close')]: {
    subject: 'Clear to close: {{property_address}}',
    body:
      'Hi {{agent_first_name}},\n\nGood news: {{property_address}} is clear to close. Closing is scheduled for {{closing_date}}.\n\n' +
      'Please remind your client to bring a government-issued photo ID and any funds due at closing. I will send the final details as soon as the closing time is set.' +
      SIGNOFF,
    suggestedRecipients: ['agent'],
  },
  [stepKey('Closing & Post-Closing')]: {
    subject: 'Closing wrap-up: {{property_address}}',
    body:
      'Hi {{agent_first_name}},\n\nCongratulations on closing {{property_address}}! I am wrapping up the file now: final documents and commission paperwork are being filed.\n\n' +
      'If you need copies of anything, just reply to this email. It was a pleasure working on this one with you.' +
      SIGNOFF,
    suggestedRecipients: ['agent'],
  },
};

const GENERIC_TEMPLATE: StepEmailTemplate = {
  subject: '{{step_name}}: {{property_address}}',
  body:
    'Hello,\n\nA quick update on {{property_address}} (file {{file_number}}) for the step "{{step_name}}":\n\n[what you need to say or ask]\n\n' +
    'The closing date is {{closing_date}}.' +
    SIGNOFF,
  suggestedRecipients: ['any'],
};

export function defaultTemplateFor(stepName: string): StepEmailTemplate {
  return DEFAULT_STEP_TEMPLATES[stepKey(stepName)] ?? GENERIC_TEMPLATE;
}

const ROLE_WORDS: Record<Exclude<RecipientKind, 'agent' | 'any'>, string[]> = {
  lender: ['lender', 'loan', 'mortgage', 'bank'],
  title: ['title', 'escrow', 'closer', 'attorney'],
  client: ['buyer', 'seller', 'client'],
  inspector: ['inspector', 'inspection'],
};

/** Does a contact's role label ("Title / Escrow", "Lender") fit a suggested recipient kind? */
export function contactMatchesKind(role: string | null | undefined, kind: RecipientKind): boolean {
  if (kind === 'any' || kind === 'agent') return false;
  const r = (role || '').toLowerCase();
  return ROLE_WORDS[kind].some((w) => r.includes(w));
}

export const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export const LIMITS = { subject: 200, body: 6000, recipients: 6 } as const;
