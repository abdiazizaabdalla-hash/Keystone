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
}

export async function loadComments(listingId: string): Promise<{ comments: ListingComment[]; available: boolean }> {
  const { data, error } = await supabaseServer
    .from('listing_comments')
    .select('id, author_role, author_label, body, created_at')
    .eq('listing_id', listingId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return { comments: [], available: false }; // add-listing-round3.sql not run yet
  return { comments: ((data || []) as ListingComment[]).reverse(), available: true };
}

/** Saves one comment after checking length and the per-listing cap. Returns an error message or the saved row. */
export async function addComment(params: {
  listingId: string;
  userId: string;
  role: 'tc' | 'agent';
  label: string;
  body: unknown;
}): Promise<{ ok: true; comment: ListingComment } | { ok: false; error: string; status: number }> {
  const text = typeof params.body === 'string' ? params.body.replace(/\r\n/g, '\n').trim() : '';
  if (!text) return { ok: false, error: 'Write a message first', status: 400 };
  if (text.length > MAX_COMMENT_LENGTH) return { ok: false, error: `Keep messages under ${MAX_COMMENT_LENGTH} characters`, status: 400 };
  const { count, error: countError } = await supabaseServer.from('listing_comments').select('id', { count: 'exact', head: true }).eq('listing_id', params.listingId).eq('author_role', params.role);
  if (countError) return { ok: false, error: 'Messages are not set up yet. Run the latest database update first.', status: 503 };
  if ((count ?? 0) >= MAX_COMMENTS_PER_SIDE) return { ok: false, error: 'This listing has reached its message limit', status: 400 };
  const { data, error } = await supabaseServer
    .from('listing_comments')
    .insert({ listing_id: params.listingId, author_user_id: params.userId, author_role: params.role, author_label: params.label.slice(0, 200), body: text })
    .select('id, author_role, author_label, body, created_at')
    .single();
  if (error || !data) return { ok: false, error: 'Could not send the message', status: 500 };
  return { ok: true, comment: data as ListingComment };
}
