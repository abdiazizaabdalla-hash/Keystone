import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { checkRateLimit } from '@/lib/rateLimit';
import { getAnthropicClient, CONTRACT_EXTRACTION_MODEL } from '@/lib/anthropic';

// Matches the 25MB cap used for the regular document upload route
// (src/app/api/documents/route.ts) -- no reason for this one to be
// looser, and Claude's PDF support tops out well above this anyway.
const MAX_FILE_SIZE = 25 * 1024 * 1024;

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
      financingType: {
        type: 'string',
        description: 'e.g. Cash, Conventional, FHA, VA. Empty string if not found.',
      },
      notes: {
        type: 'string',
        description:
          'Anything about the extraction the TC should double-check -- illegible fields, ambiguous or conflicting dates, handwriting that was hard to read, etc. Empty string if nothing to flag.',
      },
    },
    required: ['isPurchaseContract', 'propertyAddress', 'purchasePrice', 'acceptanceDate', 'closingDate', 'buyerNames', 'sellerNames'],
  },
};

export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    await assertTrialActive(user);

    // Cheap but real abuse/cost control -- each call is a paid API
    // request to Anthropic. 20/hour is generous for actually creating
    // transactions (a TC isn't onboarding 20 deals an hour) while
    // stopping a runaway client-side bug or scripted abuse from
    // running up a bill unnoticed.
    const rateOk = await checkRateLimit(`extract-contract:${user.id}`, 20, 60 * 60);
    if (!rateOk) {
      return NextResponse.json(
        { error: 'Too many contract uploads in a short time. Please wait a bit and try again.' },
        { status: 429 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'Please upload a PDF file' }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File exceeds the 25MB limit' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: CONTRACT_EXTRACTION_MODEL,
      max_tokens: 1500,
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
                'Extract the key fields from this real estate purchase contract. You must respond by calling the record_contract_fields tool with what you find -- do not reply in plain text.',
            },
          ],
        },
      ],
    });

    const toolUse = response.content.find(
      (block): block is Extract<typeof block, { type: 'tool_use' }> => block.type === 'tool_use'
    );

    if (!toolUse) {
      return NextResponse.json({ error: 'Could not read the contract. Please try again or enter the details manually.' }, { status: 502 });
    }

    const fields = toolUse.input as Record<string, unknown>;

    if (fields.isPurchaseContract !== true) {
      return NextResponse.json(
        {
          error:
            "This doesn't look like a purchase contract -- I couldn't confidently extract deal details from it. You can still enter the details manually below.",
          notAContract: true,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({ fields });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof TrialExpiredError) {
      return NextResponse.json(
        { error: error.message, code: 'trial_expired', trialEndsAt: error.trialEndsAt },
        { status: error.status }
      );
    }
    if (error instanceof Error && error.message.includes('ANTHROPIC_API_KEY')) {
      return NextResponse.json(
        { error: 'AI contract intake is not configured yet. Enter the details manually below.' },
        { status: 503 }
      );
    }
    console.error('Error extracting contract:', error);
    const msg = error instanceof Error ? error.message : 'Failed to read the contract';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// GET /api/transactions/extract-contract -- lets the New Transaction page
// check whether AI contract intake is actually configured (an
// ANTHROPIC_API_KEY is set) before showing the upload option at all,
// rather than showing a button that always 503s on a fresh install.
export async function GET(request: NextRequest) {
  try {
    await getUserFromRequest(request);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
  return NextResponse.json({ available: Boolean(process.env.ANTHROPIC_API_KEY) });
}
