// Built-in starter templates. They are generic on purpose: friendly emails and plain letters, no legal forms and no
// state-specific legal text. Installing the pack copies them into the person's own library, where every word is theirs
// to edit. State forms are the person's own licensed files, uploaded as "form" templates tagged with their state.

export interface StarterTemplate {
  key: string;
  kind: 'email' | 'letter';
  name: string;
  description: string;
  category: 'post_closing' | 'welcome' | 'general';
  subject?: string;
  body: string;
  /** A suggested automatic rule, offered but never switched on by itself. */
  suggestedRule?: { trigger: 'deal_closed' | 'closing_date' | 'acceptance_date'; offsetDays: number; repeatYearly?: boolean; roles: string[] };
}

const SIGN = '\n\n{{my_name}}\n{{my_email}}';

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    key: 'post_closing_congrats',
    kind: 'email',
    name: 'Congratulations on closing',
    description: 'Sent when the deal closes.',
    category: 'post_closing',
    subject: 'Congratulations on {{property_address}}!',
    body: `Hi {{client_first_name}},\n\nCongratulations, {{property_address}} is officially closed! It was a pleasure working with you through the whole process.\n\nIf anything comes up in the coming weeks, a question about the paperwork or a recommendation for someone local, just reply to this email.${SIGN}`,
    suggestedRule: { trigger: 'deal_closed', offsetDays: 0, roles: ['Buyer', 'Seller'] },
  },
  {
    key: 'post_closing_week_one',
    kind: 'email',
    name: 'One week after closing: how is it going?',
    description: 'A short check-in a week after closing.',
    category: 'post_closing',
    subject: 'How are you settling in?',
    body: `Hi {{client_first_name}},\n\nIt has been about a week since closing on {{property_address}}. I wanted to check in and make sure everything is going smoothly.\n\nIf you have any questions about documents, utilities, or anything else from the transaction, I am happy to help.${SIGN}`,
    suggestedRule: { trigger: 'closing_date', offsetDays: 7, roles: ['Buyer', 'Seller'] },
  },
  {
    key: 'post_closing_review_request',
    kind: 'email',
    name: 'Review request',
    description: 'Asks for a review two weeks after closing.',
    category: 'post_closing',
    subject: 'Would you share your experience?',
    body: `Hi {{client_first_name}},\n\nThank you again for trusting us with {{property_address}}. If you were happy with how things went, a short review would mean a great deal and helps other buyers and sellers find us.\n\nReply to this email and I will send you the link, or just tell me what we could have done better.${SIGN}`,
    suggestedRule: { trigger: 'closing_date', offsetDays: 14, roles: ['Buyer', 'Seller'] },
  },
  {
    key: 'post_closing_30_day',
    kind: 'email',
    name: 'One month after closing',
    description: 'A friendly note at the 30-day mark, with a referral nudge.',
    category: 'post_closing',
    subject: 'A month in at {{property_address}}',
    body: `Hi {{client_first_name}},\n\nIt has been a month since closing. I hope you are enjoying the home.\n\nIf you know anyone thinking about buying or selling, I would be glad to help them the way we helped you.${SIGN}`,
    suggestedRule: { trigger: 'closing_date', offsetDays: 30, roles: ['Buyer', 'Seller'] },
  },
  {
    key: 'post_closing_anniversary',
    kind: 'email',
    name: 'Home anniversary',
    description: 'A yearly note on the anniversary of closing.',
    category: 'post_closing',
    subject: 'Happy home anniversary!',
    body: `Hi {{client_first_name}},\n\nHappy anniversary! It has been a year since you closed on {{property_address}}.\n\nIf you would ever like a quick look at what homes nearby are selling for, I am glad to put one together, no strings attached.${SIGN}`,
    suggestedRule: { trigger: 'closing_date', offsetDays: 365, repeatYearly: true, roles: ['Buyer', 'Seller'] },
  },
  {
    key: 'post_closing_agent_thanks',
    kind: 'email',
    name: 'Thank you to the agent',
    description: 'A thank-you to the agent on the deal after closing.',
    category: 'post_closing',
    subject: 'Thank you, {{property_address}} is closed',
    body: `Hi {{agent_first_name}},\n\n{{property_address}} closed, and I wanted to say thank you for the opportunity to work on it. I am glad to help with the next one whenever it comes up.${SIGN}`,
    suggestedRule: { trigger: 'deal_closed', offsetDays: 1, roles: ['agent'] },
  },
  {
    key: 'welcome_what_to_expect',
    kind: 'email',
    name: 'Welcome: what to expect',
    description: 'Sent when the contract is accepted.',
    category: 'welcome',
    subject: 'Next steps for {{property_address}}',
    body: `Hi {{client_first_name}},\n\nCongratulations on getting {{property_address}} under contract. I will be keeping the checklist and key dates organized for you, and you will hear from me as each step is completed.\n\nYour closing is scheduled for {{closing_date}}. If anything in that timeline changes, I will let you know right away.${SIGN}`,
    suggestedRule: { trigger: 'acceptance_date', offsetDays: 0, roles: ['Buyer', 'Seller'] },
  },
  {
    key: 'closing_week_reminder',
    kind: 'email',
    name: 'Closing week reminder',
    description: 'Sent a few days before closing.',
    category: 'general',
    subject: 'Closing is coming up for {{property_address}}',
    body: `Hi {{client_first_name}},\n\nA quick reminder that closing on {{property_address}} is scheduled for {{closing_date}}. A few things to have ready: a government-issued photo ID, and any funds your title company has asked you to bring, in the form they requested.\n\nCall me if you want to go over anything.${SIGN}`,
    suggestedRule: { trigger: 'closing_date', offsetDays: -3, roles: ['Buyer', 'Seller'] },
  },
  {
    key: 'letter_closing_summary',
    kind: 'letter',
    name: 'Closing summary letter',
    description: 'A one-page letter for the deal file.',
    category: 'post_closing',
    body: `{{today}}\n\nRe: {{property_address}}\nFile {{file_number}}\n\nThis letter confirms that the transaction for {{property_address}} closed on {{closing_date}}. The final documents are kept in the deal file.\n\nSincerely,\n{{my_name}}\n{{my_email}}`,
  },
  {
    key: 'letter_welcome_client',
    kind: 'letter',
    name: 'Client welcome letter',
    description: 'A short letter introducing how the deal will run.',
    category: 'welcome',
    body: `{{today}}\n\nDear {{client_name}},\n\nWelcome. I will be coordinating your transaction at {{property_address}}. Key dates and documents are in your client portal, and I will let you know as each step is completed.\n\nThe contract was accepted on {{acceptance_date}} and closing is set for {{closing_date}}.\n\nSincerely,\n{{my_name}}`,
  },
];

export function getStarter(key: string): StarterTemplate | undefined {
  return STARTER_TEMPLATES.find((t) => t.key === key);
}
