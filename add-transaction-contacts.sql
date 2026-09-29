-- Adds a free-form list of Deal Contacts per transaction (buyer, seller,
-- lender, title/escrow, etc.) -- shown right under the Checklist card on
-- the transaction detail page. The linked Agent is NOT stored here; it's
-- shown from the existing agents table (that row is already the source
-- of truth for the agent's contact info, managed on the Agents page).
-- This table only holds the *other* parties a TC adds by hand for this
-- specific deal: a free-text role (e.g. "Buyer", "Lender"), their name or
-- company, plus email and phone.
--
-- Safe to run whether or not you already ran an earlier version of this
-- migration without the `name` column -- the `alter table` below is a
-- no-op if the column is already there.

create table if not exists transaction_contacts (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions(id) on delete cascade,
  role varchar(255),
  name varchar(255),
  email varchar(255),
  phone varchar(20),
  position integer not null default 0,
  created_at timestamp default current_timestamp
);

alter table transaction_contacts add column if not exists name varchar(255);

create index if not exists idx_transaction_contacts_transaction_id on transaction_contacts(transaction_id);

alter table transaction_contacts enable row level security;

-- Mirrors the existing "TC can see agent tasks" policy on the tasks
-- table -- same join-through-agents ownership check. Reads and writes in
-- the app itself go through the service-role client (see
-- src/app/api/transactions/[id]/contacts/route.ts), which bypasses RLS;
-- this policy just keeps the table from being reachable through the
-- anon/authenticated PostgREST roles too.
drop policy if exists "TC can see contacts for their own transactions" on transaction_contacts;
create policy "TC can see contacts for their own transactions"
  on transaction_contacts for select
  using (
    transaction_id in (
      select t.id from transactions t
      join agents a on t.agent_id = a.id
      where a.tc_user_id = auth.uid()
    )
  );
