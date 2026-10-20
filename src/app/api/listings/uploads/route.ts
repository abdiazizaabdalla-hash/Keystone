import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isAgentUser } from '@/lib/agentPortal';
import { checkRateLimit } from '@/lib/rateLimit';
import { IncomingError, MAX_INCOMING_WAITING, countIncoming, createIncomingUpload } from '@/lib/incomingUploads';

// Step 1 of a big upload: ask for one-time signed upload links (see lib/incomingUploads.ts).
// The browser then sends each file straight to private storage; later requests only name the paths.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    if (isAgentUser(user)) return NextResponse.json({ error: 'Not available' }, { status: 403 });
    await assertTrialActive(user);

    if (!(await checkRateLimit(`incoming-upload:${user.id}`, 120, 60 * 60))) {
      return NextResponse.json({ error: 'Too many uploads in a short time. Please wait a bit and try again.' }, { status: 429 });
    }
    const body = await request.json().catch(() => ({}));
    const files: unknown[] = Array.isArray(body.files) ? body.files : [];
    if (files.length === 0 || files.length > 10) return NextResponse.json({ error: 'Add between 1 and 10 files' }, { status: 400 });

    // Unused uploads are cleared daily; this stops one account from piling up storage in the meantime.
    if ((await countIncoming(user.id)) + files.length > MAX_INCOMING_WAITING) {
      return NextResponse.json({ error: 'You have a lot of files waiting from earlier uploads. Finish or wait a day for them to clear, then try again.' }, { status: 429 });
    }

    const uploads = [];
    for (const raw of files) {
      const f = (raw || {}) as { name?: unknown; size?: unknown };
      if (typeof f.name !== 'string' || !f.name.trim()) return NextResponse.json({ error: 'Each file needs a name' }, { status: 400 });
      uploads.push(await createIncomingUpload(user.id, f.name.trim().slice(0, 300), Number(f.size)));
    }
    return NextResponse.json({ uploads });
  } catch (error) {
    if (error instanceof IncomingError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    console.error('Error creating upload links:', error);
    return NextResponse.json({ error: 'Failed to start the upload' }, { status: 500 });
  }
}
