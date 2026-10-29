import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { checkRateLimit } from '@/lib/rateLimit';
import { getAnthropicClient, CONTRACT_EXTRACTION_MODEL } from '@/lib/anthropic';
import { logAiUsage } from '@/lib/aiUsage';
import { requireListingAccess } from '@/lib/listings';
import { MAX_OFFER_FILES, MAX_OFFER_FILE_SIZE } from '@/lib/listingOfferFiles';
import { IncomingError, parseUploadRequest } from '@/lib/incomingUploads';
import { OFFER_DOC_KINDS, TERM_FIELDS, normalizeTerms, type OfferTerms, VERSION_KINDS } from '@/lib/offerTerms';

export const maxDuration = 60;

// Reads an offer package (purchase contract + addenda, or a counteroffer / amendment) and proposes the
// terms. Nothing is saved here: the TC reviews and edits the answer in the browser first.
//
// Two modes:
//  - new offer:  `originalTerms` = what the base contract says; `finalTerms` = the terms after any addenda
//                or counteroffers inside the same package. If they differ, the page offers two versions.
//  - revision:   the documents change an offer already on file. The current terms are sent along and
//                `finalTerms` are the terms in force after applying these documents.

const TERMS_SCHEMA = {
  type: 'object' as const,
  properties: {
    buyerName: { type: 'string', description: 'All buyer names exactly as written, e.g. "Jane Doe and John Doe". Empty if not stated.' },
    buyerAgent: { type: 'string', description: "Buyer's real estate agent (and brokerage if given). Empty if not stated." },
    offerPrice: { type: 'number', description: 'Purchase price as a plain number. 0 if not stated.' },
    financing: { type: 'string', description: 'Exactly one of: Cash, Conventional, FHA, VA, USDA, Other. Empty if not stated.' },
    earnestMoney: { type: 'number', description: 'Earnest money amount as a plain number. 0 if not stated.' },
    optionDays: { type: 'number', description: 'Option / inspection period in days. Use 0 only if the contract says no option period; use -1 if it is not stated.' },
    closingDate: { type: 'string', description: 'Closing date as YYYY-MM-DD. Empty if not stated.' },
    sellerConcessions: { type: 'number', description: 'Dollar amount the seller agrees to pay toward buyer costs or repairs. 0 if none or not stated.' },
    offerExpires: { type: 'string', description: 'Deadline for the seller to respond, with the time and time zone if written, e.g. "2026-10-25 5:00 PM CT". Empty if not stated.' },
    possession: { type: 'string', description: 'Possession terms (e.g. "At closing and funding", "Temporary lease back 7 days"). Empty if not stated.' },
    contingencies: { type: 'string', description: 'Financing, appraisal, sale-of-home or other contingencies, in one or two plain sentences. Empty if none stated.' },
    otherTerms: {
      type: 'string',
      description: 'Anything else that changes the deal: escalation clause, repairs, title policy payer, HOA terms, items conveying. Plain sentences. Empty if nothing notable.',
    },
  },
  required: ['buyerName', 'offerPrice', 'closingDate'],
};

const TOOL = {
  name: 'record_offer',
  description:
    'Record the terms of a real estate offer from the documents provided. Leave a field empty (or 0 / -1 as described) when it is genuinely not in the documents. Never guess or invent a value, and never assume a number from another document.',
  input_schema: {
    type: 'object' as const,
    properties: {
      isOffer: { type: 'boolean', description: 'True only if the documents are a real estate purchase offer, counteroffer or amendment to one. False for anything else.' },
      documents: {
        type: 'array',
        description: 'One entry for each document provided, in the order given (index starts at 0).',
        items: {
          type: 'object',
          properties: {
            index: { type: 'number' },
            kind: { type: 'string', description: `One of: ${OFFER_DOC_KINDS.join(', ')}` },
            description: { type: 'string', description: 'A few words, e.g. "Residential contract, 9 pages" or "Third-party financing addendum".' },
          },
          required: ['index', 'kind'],
        },
      },
      originalTerms: { ...TERMS_SCHEMA, description: 'Terms exactly as the primary purchase contract states them, before any addendum, amendment or counteroffer in the package. Omit when reading a revision.' },
      finalTerms: { ...TERMS_SCHEMA, description: 'The terms in force after applying every addendum, amendment and counteroffer provided. If nothing changes the base contract, repeat the base terms.' },
      changesSummary: { type: 'string', description: 'One or two plain sentences on what the addenda, amendment or counteroffer changed (e.g. "Closing moved from Nov 1 to Nov 8; seller pays $5,000"). Empty if nothing changed.' },
      revisionKind: { type: 'string', description: `For a revision: one of ${VERSION_KINDS.filter((k) => k !== 'original').join(', ')}. Empty otherwise.` },
      references: {
        type: 'array',
        description: 'Where each term was found, so the person can verify it. Only for terms you actually filled in.',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', description: `One of: ${TERM_FIELDS.map((f) => f.key).join(', ')}` },
            document: { type: 'number', description: 'Index of the document it was found in.' },
            page: { type: 'number', description: 'Page number in that document, 1-based. 0 if unknown.' },
          },
          required: ['field', 'document', 'page'],
        },
      },
      uncertain: {
        type: 'array',
        description: 'Terms you are not sure about: handwritten or unclear text, conflicting numbers, blanks that look unfilled, unsigned pages, a term that an addendum may or may not override.',
        items: {
          type: 'object',
          properties: { field: { type: 'string' }, reason: { type: 'string' } },
          required: ['field', 'reason'],
        },
      },
      notes: { type: 'string', description: 'Anything else the TC should double-check (e.g. offer not signed, pages missing, expired). Empty if nothing.' },
    },
    required: ['isOffer', 'documents', 'finalTerms'],
  },
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await requireListingAccess(request, id);
    await assertTrialActive(user);

    const ok = await checkRateLimit(`extract-offer:${user.id}`, 40, 60 * 60);
    if (!ok) return NextResponse.json({ error: 'Too many uploads in a short time. Please wait a bit and try again.' }, { status: 429 });

    // JSON { uploads: [{ path, name }], currentTerms } (files already in private storage; they stay there for the
    // save step that follows) or small multipart. Reading works on PDFs only.
    const parsed = await parseUploadRequest(request, user.id, { pdf: 'application/pdf' }, MAX_OFFER_FILES);
    const files = parsed.files;
    if (files.length === 0) return NextResponse.json({ error: 'Add at least one PDF' }, { status: 400 });
    if (files.length > MAX_OFFER_FILES) return NextResponse.json({ error: `Add up to ${MAX_OFFER_FILES} files at a time` }, { status: 400 });
    let total = 0;
    for (const f of files) {
      if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
        return NextResponse.json({ error: `${f.name} is not a PDF. Reading works on PDFs; you can still attach other files after.` }, { status: 400 });
      }
      if (f.size > MAX_OFFER_FILE_SIZE) return NextResponse.json({ error: `${f.name} is over the 25MB limit` }, { status: 400 });
      total += f.size;
    }
    if (total > 32 * 1024 * 1024) return NextResponse.json({ error: 'These files are too large to read together. Try fewer files at a time.' }, { status: 400 });

    // Revision mode: the offer already on file (sent by the page as JSON of its current terms)
    let current: OfferTerms | null = null;
    const currentRaw = parsed.field('currentTerms');
    if (typeof currentRaw === 'string' && currentRaw) {
      try {
        current = normalizeTerms(JSON.parse(currentRaw));
      } catch {
        return NextResponse.json({ error: 'Could not read the current terms' }, { status: 400 });
      }
    }

    const content: Array<Record<string, unknown>> = [];
    for (let i = 0; i < files.length; i++) {
      content.push({ type: 'text', text: `Document ${i} (file name: ${files[i].name.replace(/[^\w .()-]/g, '_')}):` });
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(await files[i].arrayBuffer()).toString('base64') } });
    }
    content.push({
      type: 'text',
      text: current
        ? 'These documents are a counteroffer, amendment or revised offer for an offer already on file. The terms currently on file are:\n' +
          JSON.stringify(current) +
          '\n\nWork out the terms that are in force after applying these documents to the current terms. Keep the current value for anything the documents do not change; change only what they change. Put them in finalTerms, describe the change in changesSummary, and set revisionKind. Do not fill originalTerms. Only fill what is actually written; never guess. Respond by calling the record_offer tool, not in plain text.'
        : 'These documents are an offer package for a listing: usually a purchase contract plus addenda, sometimes a counteroffer. Read the primary purchase contract into originalTerms, then apply every addendum, amendment and counteroffer to produce finalTerms and describe the change in changesSummary. Classify each document. Note the page where each term was found. Only fill what is actually written; never guess. Flag anything unclear in uncertain. Respond by calling the record_offer tool, not in plain text.',
    });

    const response = await getAnthropicClient().messages.create({
      model: CONTRACT_EXTRACTION_MODEL,
      max_tokens: 4000,
      tools: [TOOL],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: content as never }],
    });

    await logAiUsage(user.id, 'offer', CONTRACT_EXTRACTION_MODEL, response.usage);

    const toolUse = response.content.find((b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use');
    if (!toolUse) return NextResponse.json({ error: 'Could not read the offer. Please try again or enter the terms yourself.' }, { status: 502 });
    const out = toolUse.input as Record<string, unknown>;
    if (out.isOffer !== true) {
      return NextResponse.json({ error: "This doesn't look like an offer, counteroffer or amendment, so nothing was read from it. You can still enter the terms yourself.", notAnOffer: true }, { status: 422 });
    }

    const final = normalizeTerms(out.finalTerms as Record<string, unknown>);
    const original = out.originalTerms && !current ? normalizeTerms(out.originalTerms as Record<string, unknown>) : null;
    const docsOut = (Array.isArray(out.documents) ? out.documents : [])
      .map((d) => {
        const r = d as Record<string, unknown>;
        return {
          index: Number(r.index),
          kind: OFFER_DOC_KINDS.includes(r.kind as never) ? (r.kind as string) : 'other',
          description: typeof r.description === 'string' ? r.description.slice(0, 120) : '',
        };
      })
      .filter((d) => Number.isInteger(d.index) && d.index >= 0 && d.index < files.length);

    const references: Record<string, { document: number; page: number }> = {};
    for (const raw of Array.isArray(out.references) ? out.references : []) {
      const r = raw as Record<string, unknown>;
      const field = String(r.field);
      if (!TERM_FIELDS.some((f) => f.key === field)) continue;
      const document = Number(r.document);
      const page = Number(r.page);
      if (Number.isInteger(document) && document >= 0 && document < files.length) references[field] = { document, page: Number.isInteger(page) && page > 0 ? page : 0 };
    }
    const uncertain: Record<string, string> = {};
    for (const raw of Array.isArray(out.uncertain) ? out.uncertain : []) {
      const r = raw as Record<string, unknown>;
      const field = String(r.field);
      if (TERM_FIELDS.some((f) => f.key === field) && typeof r.reason === 'string') uncertain[field] = r.reason.slice(0, 300);
    }

    const revisionKind = VERSION_KINDS.includes(out.revisionKind as never) && out.revisionKind !== 'original' ? (out.revisionKind as string) : 'amendment';
    return NextResponse.json({
      final,
      original,
      documents: docsOut,
      changesSummary: typeof out.changesSummary === 'string' ? out.changesSummary.slice(0, 1000) : '',
      revisionKind,
      references,
      uncertain,
      notes: typeof out.notes === 'string' ? out.notes.slice(0, 1000) : '',
    });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof IncomingError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrialExpiredError) return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    if (error instanceof Error && error.message.includes('ANTHROPIC_API_KEY')) {
      return NextResponse.json({ error: 'Reading offers is not set up yet. Enter the terms yourself.' }, { status: 503 });
    }
    console.error('Error reading offer documents:', error);
    return NextResponse.json({ error: 'Failed to read the offer' }, { status: 500 });
  }
}
