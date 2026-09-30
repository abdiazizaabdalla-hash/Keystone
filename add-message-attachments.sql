-- Lets a message in the per-transaction thread (see add-agent-portal.sql)
-- carry a file attachment, instead of only plain text. The file itself
-- is a normal row in `documents` -- uploaded through the existing
-- POST /api/documents pipeline (same storage bucket, same signed-URL
-- pattern, same agent-upload permission already in place) -- this column
-- just lets a message point at one. Nulling it out if the document is
-- later deleted keeps the message readable (falls back to plain text)
-- instead of ever blocking or cascading the delete.
alter table messages add column if not exists attachment_document_id uuid references documents(id) on delete set null;

create index if not exists idx_messages_attachment_document_id on messages(attachment_document_id);
