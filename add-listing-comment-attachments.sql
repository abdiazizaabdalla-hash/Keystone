-- Lets a listing message carry a file, like a deal message does. The file is a normal listing document
-- (so it can be filed under any Documents area), and the message points at it.
alter table public.listing_comments
  add column if not exists attachment_document_id uuid references public.listing_documents(id) on delete set null;

-- A message may now be just a file, so the body can be empty (still capped at 2000 characters).
alter table public.listing_comments drop constraint if exists listing_comments_body_check;
alter table public.listing_comments add constraint listing_comments_body_check check (char_length(body) <= 2000);
