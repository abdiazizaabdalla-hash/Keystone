-- Agent portal: lets a TC invite an agent (by email) into one specific
-- transaction. Agents are real Supabase Auth users (free, not TCs) tagged
-- with user_metadata.role = 'agent'. There's no separate token table for
-- the auth step itself -- inviting/re-logging-in an agent goes through
-- Supabase's own signInWithOtp magic-link flow (the same mechanism
-- /auth/forgot-password already uses for password-reset links), which
-- both creates the account on first use and sends the email. See
-- src/app/api/agent-invites/route.ts and src/app/agent/accept/page.tsx.
--
-- agent_invites below is TC-side bookkeeping only (so a transaction page
-- can show "invited, not yet accepted") -- it does not gate access by
-- itself. Access is actually granted by a transaction_agents row, created
-- only once the agent clicks their emailed link and its Supabase session
-- proves they really do control that invited email address (see
-- src/app/api/agent-invites/accept/route.ts).
--
-- Like every other table in this schema, authorization is enforced in
-- application code with the service-role client (see src/lib/auth.ts,
-- src/lib/agentPortal.ts), not by the RLS policies below -- those exist
-- as a defense-in-depth safety net only, matching add-transaction-contacts.sql.

create table if not exists transaction_agents (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions(id) on delete cascade,
  agent_user_id uuid not null references auth.users(id) on delete cascade,
  invited_by uuid not null references auth.users(id),
  created_at timestamp default current_timestamp,
  unique (transaction_id, agent_user_id)
);

create index if not exists idx_transaction_agents_transaction_id on transaction_agents(transaction_id);
create index if not exists idx_transaction_agents_agent_user_id on transaction_agents(agent_user_id);

create table if not exists agent_invites (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions(id) on delete cascade,
  email varchar(255) not null,
  invited_by uuid not null references auth.users(id),
  status varchar(20) not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamp default current_timestamp,
  accepted_at timestamp,
  unique (transaction_id, email)
);

create index if not exists idx_agent_invites_transaction_id on agent_invites(transaction_id);
create index if not exists idx_agent_invites_email on agent_invites(lower(email));

-- Per-transaction message thread between the TC and whichever agent(s)
-- are on it -- the in-app alternative to texting/emailing back and forth,
-- so that history lives on the deal instead of scattered across inboxes.
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  sender_role varchar(10) not null check (sender_role in ('tc', 'agent')),
  body text not null,
  created_at timestamp default current_timestamp
);

create index if not exists idx_messages_transaction_id on messages(transaction_id, created_at);

alter table transaction_agents enable row level security;
alter table agent_invites enable row level security;
alter table messages enable row level security;

drop policy if exists "TC can see agents on their own transactions" on transaction_agents;
create policy "TC can see agents on their own transactions"
  on transaction_agents for select
  using (
    transaction_id in (
      select t.id from transactions t
      join agents a on t.agent_id = a.id
      where a.tc_user_id = auth.uid()
    )
  );

drop policy if exists "Agent can see their own transaction access" on transaction_agents;
create policy "Agent can see their own transaction access"
  on transaction_agents for select
  using (agent_user_id = auth.uid());

drop policy if exists "TC can see invites for their own transactions" on agent_invites;
create policy "TC can see invites for their own transactions"
  on agent_invites for select
  using (
    transaction_id in (
      select t.id from transactions t
      join agents a on t.agent_id = a.id
      where a.tc_user_id = auth.uid()
    )
  );

drop policy if exists "TC can see messages on their own transactions" on messages;
create policy "TC can see messages on their own transactions"
  on messages for select
  using (
    transaction_id in (
      select t.id from transactions t
      join agents a on t.agent_id = a.id
      where a.tc_user_id = auth.uid()
    )
  );

drop policy if exists "Agent can see messages on their own transactions" on messages;
create policy "Agent can see messages on their own transactions"
  on messages for select
  using (
    transaction_id in (
      select transaction_id from transaction_agents where agent_user_id = auth.uid()
    )
  );
