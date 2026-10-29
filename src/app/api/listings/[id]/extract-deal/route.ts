import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { checkRateLimit } from '@/lib/rateLimit';
import { requireListingAccess } from '@/lib/listings';
import { readContractPdf } from '@/lib/contractExtraction';

const BUCKET = 'transaction-documents';
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const text = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const names = (v: unknown) => (Array.isArray(v) ? v.map((x) => text(x, 120)).filter(Boolean).slice(0, 6) : []);

// GET: is AI reading set up at all? (so the screen can hide the option instead of failing)
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireListingAccess(request, id);
    return NextResponse.json({ available: Boolean(process.env.ANTHROPIC_API_KEY) });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// POST { source: 'listing' | 'offer', documentId }: reads a contract that is already stored on this listing (or on one of its
// offers) and returns what the new deal can be filled in with: price, dates, the contract's deadlines and the people named.
// Nothing is saved here. The coordinator reviews and edits the result in the convert step before a deal is created.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await requireListingAccess(request, id);
    await assertTrialActive(user);
    if (!(await checkRateLimit(`extract-contract:${user.id}`, 20, 60 * 60))) {
      return NextResponse.json({ error: 'Too many contract reads in a short time. Please wait a bit and try again.' }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));
    const documentId = typeof body?.documentId === 'string' ? body.documentId : '';
    const source = body?.source === 'offer' ? 'offer' : 'listing';
    if (!documentId) return NextResponse.json({ error: 'documentId is required' }, { status: 400 });

    // The file must belong to THIS listing, whichever table it is in.
    const { data: doc } = await supabaseServer
      .from(source === 'offer' ? 'listing_offer_documents' : 'listing_documents')
      .select('id, file_name, storage_path, content_type, file_size')
      .eq('id', documentId)
      .eq('listing_id', id)
      .maybeSingle();
    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    const fileName = String(doc.file_name);
    if (!(doc.content_type === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf'))) {
      return NextResponse.json({ error: 'Only PDF contracts can be read' }, { status: 400 });
    }
    if (Number(doc.file_size) > MAX_FILE_SIZE) return NextResponse.json({ error: 'File exceeds the 25MB limit' }, { status: 400 });

    const { data: blob, error: downloadError } = await supabaseServer.storage.from(BUCKET).download(doc.storage_path as string);
    if (downloadError || !blob) return NextResponse.json({ error: 'Could not open that file' }, { status: 500 });
    const bytes = Buffer.from(await blob.arrayBuffer());
    if (bytes.byteLength > MAX_FILE_SIZE) return NextResponse.json({ error: 'File exceeds the 25MB limit' }, { status: 400 });

    const reading = await readContractPdf(bytes.toString('base64'), user.id);
    if (reading.kind === 'unreadable') return NextResponse.json({ error: 'Could not read that contract. You can fill the details in by hand.' }, { status: 502 });
    if (reading.kind === 'not_contract') {
      return NextResponse.json({ error: "That document doesn't look like a purchase contract, so nothing was filled in.", notAContract: true }, { status: 422 });
    }

    const f = reading.fields;
    const date = (v: unknown) => (typeof v === 'string' && DATE_RE.test(v) ? v : '');
    const candidates = [
      { kind: 'earnest_money', label: 'Earnest money due', dueDate: date(f.earnestMoneyDueDate) },
      { kind: 'inspection', label: 'Inspection deadline', dueDate: date(f.inspectionDeadline) },
      { kind: 'appraisal', label: 'Appraisal deadline', dueDate: date(f.appraisalDeadline) },
      { kind: 'financing', label: 'Financing contingency', dueDate: date(f.financingContingencyDeadline) },
      { kind: 'title_commitment', label: 'Title commitment due', dueDate: date(f.titleCommitmentDueDate) },
    ].filter((d) => d.dueDate);

    const contacts: { role: string; name: string; email?: string; phone?: string }[] = [];
    const buyers = names(f.buyerNames);
    if (buyers.length) contacts.push({ role: 'Buyer', name: buyers.join(', ') });
    const lender = text(f.lenderName, 160);
    if (lender) contacts.push({ role: 'Lender', name: lender });
    const titleName = text(f.escrowOfficerName, 160) || text(f.titleCompanyName, 160);
    if (titleName) {
      contacts.push({ role: 'Title', name: titleName, email: text(f.escrowOfficerEmail, 320) || undefined, phone: text(f.escrowOfficerPhone, 60) || undefined });
    }

    return NextResponse.json({
      fileName,
      propertyAddress: text(f.propertyAddress, 300),
      price: Number(f.purchasePrice) > 0 ? Number(f.purchasePrice) : null,
      acceptanceDate: date(f.acceptanceDate),
      closingDate: date(f.closingDate),
      financingType: text(f.financingType, 80),
      dates: candidates,
      contacts,
      notes: text(f.notes, 1000),
    });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    if (error instanceof Error && error.message.includes('ANTHROPIC_API_KEY')) {
      return NextResponse.json({ error: 'Contract reading is not set up yet. Fill the details in by hand.' }, { status: 503 });
    }
    console.error('Error reading the contract for a listing:', error);
    return NextResponse.json({ error: 'Could not read that contract' }, { status: 500 });
  }
}
