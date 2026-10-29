import { getAnthropicClient, CONTRACT_EXTRACTION_MODEL } from '@/lib/anthropic';
import { logAiUsage } from '@/lib/aiUsage';

// Reads a real estate purchase contract PDF with Claude and returns its key fields. Shared by the New Transaction
// page (an uploaded file) and the listing "convert to a deal" step (a file already stored on the listing).

// A single tool definition forces a structured, predictable response
// instead of parsing free-form text out of a model reply. Text fields
// use "" and numeric fields use 0 for "not found in the document" --
// simpler and more broadly compatible across tool-use validation than
// nullable union types in the schema.
const EXTRACTION_TOOL = {
  name: 'record_contract_fields',
  description:
    "Record the key fields extracted from a real estate purchase contract. Leave a field as an empty string, 0, or empty array when it genuinely is not present in the document -- never guess or invent a value that isn't actually there.",
  input_schema: {
    type: 'object' as const,
    properties: {
      isPurchaseContract: {
        type: 'boolean',
        description:
          'True only if this document is actually a real estate purchase contract/purchase agreement. False for anything else (an inspection report, a disclosure form, a lease, an unrelated PDF, etc).',
      },
      propertyAddress: {
        type: 'string',
        description: 'The full street address of the property being purchased. Empty string if not found.',
      },
      purchasePrice: {
        type: 'number',
        description: 'The purchase price as a plain number, no currency symbols or commas. 0 if not found.',
      },
      acceptanceDate: {
        type: 'string',
        description: "The contract's effective/acceptance date as YYYY-MM-DD. Empty string if not found.",
      },
      closingDate: {
        type: 'string',
        description: 'The target/scheduled closing date as YYYY-MM-DD. Empty string if not found.',
      },
      buyerNames: { type: 'array', items: { type: 'string' }, description: 'Buyer full name(s).' },
      sellerNames: { type: 'array', items: { type: 'string' }, description: 'Seller full name(s).' },
      listingAgentName: { type: 'string', description: "The listing (seller's) agent's name, empty string if not found." },
      buyerAgentName: { type: 'string', description: "The buyer's agent's name, empty string if not found." },
      earnestMoneyAmount: { type: 'number', description: 'Earnest money deposit amount, 0 if not found.' },
      earnestMoneyDueDate: {
        type: 'string',
        description:
          "The date the earnest money deposit is due, as YYYY-MM-DD. If the contract states it as a number of days after the effective/acceptance date, work out the calendar date from acceptanceDate. Empty string if not stated.",
      },
      inspectionDeadline: {
        type: 'string',
        description:
          "The deadline for the buyer's inspection / due diligence period or inspection objection, as YYYY-MM-DD. If stated as N days after the effective/acceptance date, work out the calendar date from acceptanceDate. Empty string if not stated.",
      },
      appraisalDeadline: {
        type: 'string',
        description:
          'The appraisal contingency deadline, as YYYY-MM-DD (computed from acceptanceDate if stated in days). Empty string if there is no appraisal contingency date.',
      },
      financingContingencyDeadline: {
        type: 'string',
        description:
          'The financing / loan approval contingency deadline, as YYYY-MM-DD (computed from acceptanceDate if stated in days). Empty string if not stated or if the purchase is cash.',
      },
      titleCommitmentDueDate: {
        type: 'string',
        description: 'The date the title commitment / title search is due, as YYYY-MM-DD. Empty string if not stated.',
      },
      financingType: {
        type: 'string',
        description: 'e.g. Cash, Conventional, FHA, VA. Empty string if not found.',
      },
      lenderName: {
        type: 'string',
        description: 'The lending institution/bank name, if one is named in the contract. Empty string if not found (a financing type with no named lender is common and fine).',
      },
      titleCompanyName: { type: 'string', description: 'The title/escrow company name. Empty string if not found.' },
      escrowOfficerName: { type: 'string', description: 'The escrow officer or title company contact person. Empty string if not found.' },
      escrowOfficerEmail: { type: 'string', description: "The escrow officer's/title company's email. Empty string if not found." },
      escrowOfficerPhone: { type: 'string', description: "The escrow officer's/title company's phone number. Empty string if not found." },
      notes: {
        type: 'string',
        description:
          'Anything about the extraction the TC should double-check -- illegible fields, ambiguous or conflicting dates, handwriting that was hard to read, etc. Empty string if nothing to flag.',
      },
    },
    required: ['isPurchaseContract', 'propertyAddress', 'purchasePrice', 'acceptanceDate', 'closingDate', 'buyerNames', 'sellerNames'],
  },
};


export type ContractReading = { kind: 'fields'; fields: Record<string, unknown> } | { kind: 'not_contract' } | { kind: 'unreadable' };

export async function readContractPdf(base64: string, userId?: string): Promise<ContractReading> {
  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: CONTRACT_EXTRACTION_MODEL,
    max_tokens: 2000,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: 'auto' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 },
          },
          {
            type: 'text',
            text:
              'Extract the key fields from this real estate purchase contract, including the contract\'s critical deadlines (earnest money due, inspection, appraisal, financing contingency, title commitment). When a deadline is written as a number of days after the effective date, convert it to a calendar date. Only fill a date that is actually stated or directly computable -- never guess. If any date is ambiguous, say so in notes. You must respond by calling the record_contract_fields tool with what you find -- do not reply in plain text.',
          },
        ],
      },
    ],
  });

  if (userId) await logAiUsage(userId, 'contract', CONTRACT_EXTRACTION_MODEL, response.usage);

  const toolUse = response.content.find(
    (block): block is Extract<typeof block, { type: 'tool_use' }> => block.type === 'tool_use'
  );
  if (!toolUse) return { kind: 'unreadable' };
  const fields = toolUse.input as Record<string, unknown>;
  if (fields.isPurchaseContract !== true) return { kind: 'not_contract' };
  return { kind: 'fields', fields };
}
