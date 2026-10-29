import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isAgentUser } from '@/lib/agentPortal';
import { checkRateLimit } from '@/lib/rateLimit';
import { getAnthropicClient, CONTRACT_EXTRACTION_MODEL } from '@/lib/anthropic';
import { logAiUsage } from '@/lib/aiUsage';
import { IncomingError, parseUploadRequest } from '@/lib/incomingUploads';

export const maxDuration = 60;

const PDF_ONLY = { pdf: 'application/pdf' };

// Reads a listing agreement PDF so a new listing can start pre-filled. Same approach as the purchase
// contract reader: one forced tool call, "" / 0 / [] for anything not actually in the document.
const EXTRACTION_TOOL = {
  name: 'record_listing_agreement',
  description:
    'Record the details and every named party from a real estate listing agreement. Leave a field as an empty string, 0 or an empty array when it is genuinely not in the document. Never guess or invent a value.',
  input_schema: {
    type: 'object' as const,
    properties: {
      isListingAgreement: {
        type: 'boolean',
        description: 'True only if this document is a real estate listing agreement (exclusive right to sell, exclusive agency, open listing, or similar). False for anything else.',
      },
      propertyAddress: { type: 'string', description: 'Full street address of the property being listed, with city, state and ZIP when present.' },
      listPrice: { type: 'number', description: 'The listing price as a plain number, no symbols or commas. 0 if not stated.' },
      agreementStartDate: { type: 'string', description: 'The date the listing period begins (or the agreement is effective), as YYYY-MM-DD. Empty if not stated.' },
      expirationDate: { type: 'string', description: 'The date the listing period ends, as YYYY-MM-DD. Empty if not stated.' },
      mlsNumber: { type: 'string', description: 'MLS number if one is written in. Empty otherwise.' },
      listingType: { type: 'string', description: 'e.g. Exclusive Right to Sell, Exclusive Agency, Open Listing. Empty if not stated.' },
      commissionSummary: {
        type: 'string',
        description: "One or two plain sentences on the listing broker's fee and any compensation offered to buyer's brokers, exactly as the document states it. Empty if not stated.",
      },
      people: {
        type: 'array',
        description:
          'EVERY named person or company on the agreement other than the property itself: each seller or owner (and any co-owner, trustee, executor, or person signing under power of attorney), the listing agent(s), the supervising or managing broker, the brokerage company, and anyone else named with a role. One entry per person. Use the exact role wording from the document when there is one.',
        items: {
          type: 'object',
          properties: {
            role: { type: 'string', description: 'e.g. Seller, Co-Seller, Trustee, Listing Agent, Co-Listing Agent, Broker, Brokerage.' },
            name: { type: 'string', description: 'Full name, or company name for a brokerage.' },
            email: { type: 'string', description: 'Email if written in the document, else empty.' },
            phone: { type: 'string', description: 'Phone if written in the document, else empty.' },
            company: { type: 'string', description: 'Brokerage or company the person works for, if stated.' },
          },
          required: ['role', 'name'],
        },
      },
      notes: {
        type: 'string',
        description: 'Anything the person should double-check: unreadable or handwritten parts, conflicting dates, blanks that look unfilled, unsigned pages. Empty if nothing to flag.',
      },
    },
    required: ['isListingAgreement', 'propertyAddress', 'listPrice', 'people'],
  },
};

export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (isAgentUser(user)) throw new AuthError('Not available', 403);
    await assertTrialActive(user);

    const rateOk = await checkRateLimit(`extract-listing:${user.id}`, 20, 60 * 60);
    if (!rateOk) return NextResponse.json({ error: 'Too many uploads in a short time. Please wait a bit and try again.' }, { status: 429 });

    // The agreement arrives either as { uploads: [{ path, name }] } (already in private storage, any size up to
    // 25MB) or as a small multipart file. It is NOT deleted here: saving it as the listing's document uses it next.
    const { files } = await parseUploadRequest(request, user.id, PDF_ONLY, 1);
    const file = files[0];
    if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });

    const base64 = Buffer.from(await file.arrayBuffer()).toString('base64');
    const response = await getAnthropicClient().messages.create({
      model: CONTRACT_EXTRACTION_MODEL,
      max_tokens: 3000,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: 'auto' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            {
              type: 'text',
              text:
                'This should be a real estate listing agreement. Extract the property, price, listing period and fee terms, and list EVERY named party (all sellers and co-owners, trustees or people signing for them, all listing agents, the broker and the brokerage) in the people array. Only fill what is actually written; never guess. Flag anything unclear in notes. Respond by calling the record_listing_agreement tool, not in plain text.',
            },
          ],
        },
      ],
    });

    await logAiUsage(user.id, 'listing_agreement', CONTRACT_EXTRACTION_MODEL, response.usage);

    const toolUse = response.content.find((b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use');
    if (!toolUse) return NextResponse.json({ error: 'Could not read the agreement. Please try again or enter the details yourself.' }, { status: 502 });

    const fields = toolUse.input as Record<string, unknown>;
    if (fields.isListingAgreement !== true) {
      return NextResponse.json(
        { error: "This doesn't look like a listing agreement, so nothing was read from it. You can still enter the details yourself.", notAnAgreement: true },
        { status: 422 }
      );
    }
    return NextResponse.json({ fields });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof IncomingError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    if (error instanceof Error && error.message.includes('ANTHROPIC_API_KEY')) {
      return NextResponse.json({ error: 'Reading agreements is not set up yet. Enter the details yourself.' }, { status: 503 });
    }
    console.error('Error extracting listing agreement:', error);
    return NextResponse.json({ error: 'Failed to read the agreement' }, { status: 500 });
  }
}

// Lets the page hide the upload option when no API key is configured.
export async function GET(request: NextRequest) {
  try {
    await getUserFromRequest(request);
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  return NextResponse.json({ available: Boolean(process.env.ANTHROPIC_API_KEY) });
}
