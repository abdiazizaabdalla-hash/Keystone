-- Remembers whether an agent has already seen the "new on your dashboard" notice for a deal, so it shows once.
-- Safe to run more than once. Deals already on agents' portals count as seen.
alter table public.transaction_agents add column if not exists notice_seen boolean not null default true;
alter table public.transaction_agents alter column notice_seen set default false;

notify pgrst, 'reload schema';
