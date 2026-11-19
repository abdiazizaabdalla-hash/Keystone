-- Extra things a coordinator charges an agent besides the standard fees (e.g. "Rush file", "Amendment", "Closing gift"):
-- a list of { id, name, amount } kept on the agent's profile. They show in the invoice's Service dropdown. Safe to re-run.
alter table public.agents add column if not exists services jsonb not null default '[]'::jsonb;
