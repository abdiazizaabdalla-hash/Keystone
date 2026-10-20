-- Lets the listing agent add people to their listing from the agent portal (and remove the ones they added).
-- Safe to run more than once. Until it is run, agents can still see contacts but cannot add or remove any.
alter table public.listing_contacts add column if not exists added_by_agent boolean not null default false;
notify pgrst, 'reload schema';
