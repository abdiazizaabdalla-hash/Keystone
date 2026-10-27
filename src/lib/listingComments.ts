import { supabaseServer } from '@/lib/supabase';

// Short messages between the TC and the listing agent, kept on the listing. Plain text only (React escapes it
// on screen; emails never include the text). Both sides go through these helpers so the rules are the same.

export const MAX_COMMENT_LENGTH = 2000;
export const MAX_COMMENTS_PER_SIDE = 250; // per listing, for each of the two sides, so one side can't lock the other out

export interface ListingComment {
  id: string;
  author_role: 'tc' | 'agent';
  author_label: string | null;
  body: string;
  created_at: string;
  attachment_document_id?: string | null;
  attachment?: { fileName: string; url: string | null } | null;
}

const ATTACHMENT_BUCKET = 'transaction-documents';
const ATTACHMENT_URL_TTL_SECONDS = 60 * 60;

export async function loadComments(listingId: string): Promise<{ comments: ListingComment[]; available: boolean }> {
  // The attachment column comes from add-listing-comment-attachments.sql; until that is run, read the older columns only.
  let rows: ListingComment[] | null = null;
  const withAttach = await supabaseServer
    .from('listing_comments')
    .select('id, author_role, author_label, body, created_at, attachment_document_id')
    .eq('listing_id', listingId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (!withAttach.error) {
    rows = (withAttach.data || []) as ListingComment[];
  } else {
    const plain = await supabaseServer
      .from('listing_comments')
      .select('id, author_role, author_label, body, created_at')
      .eq('listing_id', listingId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (plain.error) return { comments: [], available: false }; // add-listing-round3.sql not run yet
    rows = (plain.data || []) as ListingComment[];
  }
  const comments = rows.reverse();

  // A short-lived link for each attached file, the same way a deal's messages get theirs.
  const ids = [...new Set(comments.map((c) => c.attachment_document_id).filter((v): v is string => !!v))];
  if (ids.length > 0) {
    const { data: docs } = await supabaseServer.from('listing_documents').select('id, file_name, storage_path').in('id', ids);
    const byId = new Map<string, { fileName: string; url: string | null }>();
    await Promise.all(
      (docs || []).map(async (d) => {
        const { data: signed } = await supabaseServer.storage.from(ATTACHMENT_BUCKET).createSignedUrl(d.storage_path as string, ATTACHMENT_URL_TTL_SECONDS);
        byId.set(d.id as string, { fileName: d.file_name as string, url: signed?.signedUrl || null });
      })
    );
    for (const c of comments) c.attachment = c.attachment_document_id ? byId.get(c.attachment_document_id) || null : null;
  }
  return { comments, available: true };
}

/** Saves one comment after checking length and the per-listing cap. Returns an error message or the saved row. */
export async function addComment(params: {
  listingId: string;
  userId: string;
  role: 'tc' | 'agent';
  label: string;
  body: unknown;
  attachmentDocumentId?: unknown;
}): Promise<{ ok: true; comment: ListingComment } | { ok: false; error: string; status: number }> {
  const text = typeof params.body === 'string' ? params.body.replace(/\r\n/g, '\n').trim() : '';
  const attachmentId = typeof params.attachmentDocumentId === 'string' && params.attachmentDocumentId ? params.attachmentDocumentId : null;
  if (!text && !attachmentId) return { ok: false, error: 'Write a message first', status: 400 };
  if (text.length > MAX_COMMENT_LENGTH) return { ok: false, error: `Keep messages under ${MAX_COMMENT_LENGTH} characters`, status: 400 };
  const { count, error: countError } = await supabaseServer.from('listing_comments').select('id', { count: 'exact', head: true }).eq('listing_id', params.listingId).eq('author_role', params.role);
  if (countError) return { ok: false, error: 'Messages are not set up yet. Run the latest database update first.', status: 503 };
  if ((count ?? 0) >= MAX_COMMENTS_PER_SIDE) return { ok: false, error: 'This listing has reached its message limit', status: 400 };
  let attachment: { fileName: string; url: string | null } | null = null;
  if (attachmentId) {
    // Only a file that belongs to this listing can be attached.
    const { data: doc } = await supabaseServer.from('listing_documents').select('id, file_name, storage_path').eq('id', attachmentId).eq('listing_id', params.listingId).maybeSingle();
    if (!doc) return { ok: false, error: 'That file is not on this listing', status: 400 };
    const { data: signed } = await supabaseServer.storage.from(ATTACHMENT_BUCKET).createSignedUrl(doc.storage_path as string, ATTACHMENT_URL_TTL_SECONDS);
    attachment = { fileName: doc.file_name as string, url: signed?.signedUrl || null };
  }
  const { data, error } = await supabaseServer
    .from('listing_comments')
    .insert({
      listing_id: params.listingId,
      author_user_id: params.userId,
      author_role: params.role,
      author_label: params.label.slice(0, 200),
      body: text,
      ...(attachmentId ? { attachment_document_id: attachmentId } : {}),
    })
    .select(attachmentId ? 'id, author_role, author_label, body, created_at, attachment_document_id' : 'id, author_role, author_label, body, created_at')
    .single();
  if (error || !data) {
    if (attachmentId) return { ok: false, error: 'Sending files in messages needs the latest database update (add-listing-comment-attachments.sql).', status: 503 };
    return { ok: false, error: 'Could not send the message', status: 500 };
  }
  return { ok: true, comment: { ...(data as unknown as ListingComment), attachment } };
}
