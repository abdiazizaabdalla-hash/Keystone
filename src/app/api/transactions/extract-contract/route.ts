import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { checkRateLimit } from '@/lib/rateLimit';
import { readContractPdf } from '@/lib/contractExtraction';

// Matches the 25MB cap used for the regular document upload route
// (src/app/api/documents/route.ts) -- no reason for this one to be
// looser, and Claude's PDF support tops out well above this anyway.
const MAX_FILE_SIZE = 25 * 1024 * 1024;

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

    const reading = await readContractPdf(base64, user.id);

    if (reading.kind === 'unreadable') {
      return NextResponse.json({ error: 'Could not read the contract. Please try again or enter the details manually.' }, { status: 502 });
    }

    if (reading.kind === 'not_contract') {
      return NextResponse.json(
        {
          error:
            "This doesn't look like a purchase contract -- I couldn't confidently extract deal details from it. You can still enter the details manually below.",
          notAContract: true,
        },
        { status: 422 }
      );
    }

    const fields = reading.fields;

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
