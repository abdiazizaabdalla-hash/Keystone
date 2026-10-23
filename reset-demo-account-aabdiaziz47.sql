-- OPTIONAL. Clears the aabdiaziz47@gmail.com account down to nothing (deals, listings, invoices, contacts) so the
-- sample data from add-sample-data-aabdiaziz47.sql is the only thing on screen when you take screenshots.
-- It only touches that one login (user id 3853f16c-1775-4324-b0d5-0845eb99ce04). It permanently deletes data.
-- Agents are kept (the sample script re-uses them); delete extra agents in the app if you want a shorter list.
-- Run this FIRST, then add-sample-data-aabdiaziz47.sql.

delete from public.invoices where transaction_id in (select id from public.transactions where tc_user_id = '3853f16c-1775-4324-b0d5-0845eb99ce04');
delete from public.transactions where tc_user_id = '3853f16c-1775-4324-b0d5-0845eb99ce04';
delete from public.listings where tc_user_id = '3853f16c-1775-4324-b0d5-0845eb99ce04';
delete from public.contacts where tc_user_id = '3853f16c-1775-4324-b0d5-0845eb99ce04';

select (select count(*) from public.transactions where tc_user_id = '3853f16c-1775-4324-b0d5-0845eb99ce04') as deals_left,
       (select count(*) from public.listings where tc_user_id = '3853f16c-1775-4324-b0d5-0845eb99ce04') as listings_left;
