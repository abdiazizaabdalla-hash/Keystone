-- The built-in starter pack no longer has letters (the closing summary letter and the client welcome letter were not being used).
-- This hides the copies that were installed in accounts from the old pack. They are archived, not deleted, so anything someone
-- edited can still be found under archived templates, and documents already made from them are untouched.
-- Run once in the Supabase SQL editor. Safe to run again.
update public.doc_templates
set archived = true, updated_at = now()
where starter_key in ('letter_closing_summary', 'letter_welcome_client') and archived = false;

select count(*) as starter_letters_still_showing from public.doc_templates
where starter_key in ('letter_closing_summary', 'letter_welcome_client') and archived = false;
