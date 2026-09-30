import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isValidCategory, isValidDocumentType, DEFAULT_CATEGORY_KEY, DEFAULT_DOCUMENT_TYPE } from '@/lib/documentTaxonomy';
import { getVisibleTcUserIds } from '@/lib/team';
import { isAgentUser, assertAgentOnTransaction } from '@/lib/agentPortal';

const BUCKET = 'transaction-documents';
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

let bucketEnsured = false;
async function ensureBucket() {
  if (bucketEnsured) return;
  try {
    const { data: buckets, error: listError } = await supabaseServer.storage.listBuckets();
    if (listError) {
      // Can't confirm either way — don't block reads/writes on a listing
      // call that isn't essential; upload/download will surface their own
      // clear error if the bucket genuinely doesn't exist.
      console.warn('Warning: could not list storage buckets', listError);
      return;
    }
    const exists = buckets?.some((b) => b.name === BUCKET);
    if (!exists) {
      const { error } = await supabaseServer.storage.createBucket(BUCKET, { public: false });
      // Ignore races where the bucket already exists — Supabase Storage has
      // been observed to surface this as a generic row-level-security
      // violation on the underlying insert rather than a clean
      // "already exists" message, so treat both as non-fatal.
      if (error && !/already exists|row-level security/i.test(error.message)) {
        throw error;
      }
    }
    bucketEnsured = true;
  } catch (err) {
    console.warn('Warning: ensureBucket check failed, proceeding anyway', err);
  }
}

// Verifies the requesting user may act on this transaction's documents.
// Returns the transaction row (with agent_id) once ownership is confirmed.
//
// `readOnly` widens the check to the caller's whole visible team (same
// rule as /api/transactions, /api/agents, /api/tasks -- see
// getVisibleTcUserIds): a Team owner can VIEW a teammate's documents,
// not just their own. Uploading, marking signed, and deleting stay
// scoped to the direct owner only, matching how every other mutation in
// this codebase (creating/deleting a transaction, an agent, an invoice)
// is deliberately kept owner-only even though team owners can see more
// than they can edit. Fixed 2026-09 -- this previously 403'd a team
// owner just opening a teammate's transaction's document list.
async function assertTransactionAccess(
  transactionId: string,
  userId: string,
  isAdmin: boolean,
  { readOnly = false, allowAgent = false, isAgent = false }: { readOnly?: boolean; allowAgent?: boolean; isAgent?: boolean } = {}
) {
  // An invited agent is scoped to exactly this one transaction, via
  // transaction_agents -- never the TC ownership check below, which an
  // agent (no `agents` row of their own) would always fail anyway.
  if (allowAgent && isAgent) {
    await assertAgentOnTransaction(transactionId, userId);
    const { data: transaction, error } = await supabaseServer
      .from('transactions')
      .select('id, agent_id')
      .eq('id', transactionId)
      .single();
    if (error || !transaction) {
      throw new AuthError('Transaction not found', 404);
    }
    return transaction;
  }

  const { data: transaction, error } = await supabaseServer
    .from('transactions')
    .select('id, agent_id')
    .eq('id', transactionId)
    .single();

  if (error || !transaction) {
    throw new AuthError('Transaction not found', 404);
  }

  if (!isAdmin) {
    const ownerIds = readOnly ? await getVisibleTcUserIds(userId) : [userId];
    const { data: agent } = await supabaseServer
      .from('agents')
      .select('id')
      .eq('id', transaction.agent_id)
      .in('tc_user_id', ownerIds)
      .single();

    if (!agent) {
      throw new AuthError('You do not have permission to access documents for this transaction', 403);
    }
  }

  return transaction;
}

export async function GET(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const transactionId = request.nextUrl.searchParams.get('transactionId');

    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
    }

    await assertTransactionAccess(transactionId, user.id, isAdmin, {
      readOnly: true,
      allowAgent: true,
      isAgent: isAgentUser(user),
    });
    await ensureBucket();

    const { data: docs, error } = await supabaseServer
      .from('documents')
      .select('*')
      .eq('transaction_id', transactionId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const docList = docs || [];

    // Attach a short-lived signed URL to each document so the private
    // bucket's files can be viewed/downloaded from the browser.
    const withUrls = await Promise.all(
      docList.map(async (doc) => {
        const { data: signed } = await supabaseServer.storage
          .from(BUCKET)
          .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);
        return { ...doc, url: signed?.signedUrl || null };
      })
    );

    return NextResponse.json(withUrls);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching documents:', error);
    return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const callerIsAgent = isAgentUser(user);
    // Agents aren't TCs and have no plan/trial of their own -- the trial
    // gate is about whether the TC's account can keep creating/editing,
    // not whether an agent they've invited can upload a document.
    if (!callerIsAgent) {
      await assertTrialActive(user);
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const transactionId = formData.get('transactionId');
    const taskId = formData.get('taskId'); // optional — associates with a checklist stage
    const categoryRaw = formData.get('category');
    const documentTypeRaw = formData.get('documentType');
    const requiresSignatureRaw = formData.get('requiresSignature'); // optional — defaults to true

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }
    if (typeof transactionId !== 'string' || !transactionId) {
      return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File exceeds the 25MB limit' }, { status: 400 });
    }

    const category = typeof categoryRaw === 'string' && categoryRaw ? categoryRaw : DEFAULT_CATEGORY_KEY;
    const documentType = typeof documentTypeRaw === 'string' && documentTypeRaw ? documentTypeRaw : DEFAULT_DOCUMENT_TYPE;
    // Most documents in a real-estate file need a signature; only treat it
    // as "no signature needed" when the caller explicitly said so.
    const requiresSignature = requiresSignatureRaw !== 'false';

    if (!isValidCategory(category)) {
      return NextResponse.json({ error: `Unknown document category: ${category}` }, { status: 400 });
    }
    if (!isValidDocumentType(category, documentType)) {
      return NextResponse.json(
        { error: `"${documentType}" is not a valid document type for category "${category}"` },
        { status: 400 }
      );
    }

    await assertTransactionAccess(transactionId, user.id, isAdmin, {
      allowAgent: true,
      isAgent: callerIsAgent,
    });
    await ensureBucket();

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${transactionId}/${crypto.randomUUID()}-${safeName}`;

    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadError } = await supabaseServer.storage
      .from(BUCKET)
      .upload(storagePath, arrayBuffer, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data: docRow, error: insertError } = await supabaseServer
      .from('documents')
      .insert({
        transaction_id: transactionId,
        task_id: typeof taskId === 'string' && taskId ? taskId : null,
        category,
        document_type: documentType,
        file_name: file.name,
        storage_path: storagePath,
        content_type: file.type || null,
        file_size: file.size,
        uploaded_by: user.id,
        requires_signature: requiresSignature,
      })
      .select()
      .single();

    if (insertError) {
      // Roll back the uploaded file if the DB insert failed, so storage
      // doesn't accumulate orphaned files with no matching record.
      await supabaseServer.storage.from(BUCKET).remove([storagePath]);
      throw insertError;
    }

    const { data: signed } = await supabaseServer.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

    return NextResponse.json({ ...docRow, url: signed?.signedUrl || null }, { status: 201 });
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
    console.error('Error uploading document:', error);
    const msg = error instanceof Error ? error.message : 'Failed to upload document';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH /api/documents -- lets the TC mark a document Signed/Not Signed
// after it's already been uploaded (e.g. it was signed outside Relay, on
// paper or through an existing DocuSign account), and/or flip whether a
// document requires a signature at all (some uploads -- photos, MLS
// printouts, internal notes -- never need one). These two flags plus
// everything else about a document are otherwise immutable once uploaded.
export async function PATCH(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    if (!isAgentUser(user)) {
      await assertTrialActive(user);
    }
    const body = await request.json();
    const { id, isSigned, requiresSignature } = body;

    if (typeof id !== 'string' || !id) {
      return NextResponse.json({ error: 'Document id is required' }, { status: 400 });
    }
    if (isSigned === undefined && requiresSignature === undefined) {
      return NextResponse.json({ error: 'isSigned or requiresSignature is required' }, { status: 400 });
    }
    if (isSigned !== undefined && typeof isSigned !== 'boolean') {
      return NextResponse.json({ error: 'isSigned must be a boolean' }, { status: 400 });
    }
    if (requiresSignature !== undefined && typeof requiresSignature !== 'boolean') {
      return NextResponse.json({ error: 'requiresSignature must be a boolean' }, { status: 400 });
    }

    const { data: doc, error: fetchError } = await supabaseServer
      .from('documents')
      .select('id, transaction_id')
      .eq('id', id)
      .single();

    if (fetchError || !doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Agents may toggle a document's signed / requires-signature state on
    // their own transactions -- the same as any other document mutation
    // they're allowed (upload, view). Actually *sending* a signature
    // request (and voiding one) is a separate endpoint
    // (/api/signing-requests) that deliberately stays TC-only.
    await assertTransactionAccess(doc.transaction_id, user.id, isAdmin, {
      allowAgent: true,
      isAgent: isAgentUser(user),
    });

    const updates: Record<string, boolean> = {};
    if (isSigned !== undefined) updates.is_signed = isSigned;
    if (requiresSignature !== undefined) updates.requires_signature = requiresSignature;

    const { data: updated, error: updateError } = await supabaseServer
      .from('documents')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    return NextResponse.json(updated);
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
    console.error('Error updating document:', error);
    return NextResponse.json({ error: 'Failed to update document' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Document id is required' }, { status: 400 });
    }

    const { data: doc, error: fetchError } = await supabaseServer
      .from('documents')
      .select('id, transaction_id, storage_path')
      .eq('id', id)
      .single();

    if (fetchError || !doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    await assertTransactionAccess(doc.transaction_id, user.id, isAdmin);

    const { error: removeError } = await supabaseServer.storage.from(BUCKET).remove([doc.storage_path]);
    if (removeError) console.warn('Warning: storage removal failed, deleting DB row anyway', removeError);

    const { error: deleteError } = await supabaseServer.from('documents').delete().eq('id', id);
    if (deleteError) throw deleteError;

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error deleting document:', error);
    return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 });
  }
}
