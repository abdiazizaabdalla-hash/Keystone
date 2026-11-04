-- Commission statements that start as an estimate (Step 1 of the commission workflow).
--
-- Before this, a statement could only exist once someone typed in a gross commission. Now:
--   * a statement can exist with no figures yet (status 'estimate'), built from the agent's base terms; the brokerage owner
--     replaces it with the confirmed gross from the closing documents, which moves it to 'proposed' for the agent to review;
--   * the brokerage's base terms for an agent can carry default fees and an optional cap (with how it resets);
--   * each statement records who confirmed it and when, and keeps the cap rule that applied when it was made.
-- Nothing existing changes: every statement already in the table keeps its status, figures and dates, and is marked as
-- confirmed by its brokerage owner. Safe to run more than once. Run after add-brokerage-oversight.sql.

-- A statement with no confirmed figure has no gross and no net yet.
alter table public.deal_commissions alter column gross_cents drop not null;
alter table public.deal_commissions alter column agent_net_cents drop not null;
alter table public.deal_commissions alter column brokerage_net_cents drop not null;

-- The new 'estimate' status, and the rule that every other status has a gross.
alter table public.deal_commissions drop constraint if exists deal_commissions_status_check;
alter table public.deal_commissions add constraint deal_commissions_status_check
  check (status in ('estimate', 'proposed', 'change_requested', 'accepted', 'paid', 'void'));
alter table public.deal_commissions drop constraint if exists deal_commissions_gross_when_confirmed;
alter table public.deal_commissions add constraint deal_commissions_gross_when_confirmed
  check (status in ('estimate', 'void') or (gross_cents is not null and agent_net_cents is not null and brokerage_net_cents is not null));

-- Who confirmed the gross, and when; and the cap rule the statement was made under (kept so cap tracking can be computed later).
alter table public.deal_commissions add column if not exists confirmed_at timestamptz;
alter table public.deal_commissions add column if not exists confirmed_by uuid;
alter table public.deal_commissions add column if not exists cap_snapshot jsonb;

-- Existing statements were all made from a figure the owner typed: treat them as confirmed by the owner. Statuses are not touched.
update public.deal_commissions
   set confirmed_at = coalesce(accepted_at, proposed_at), confirmed_by = owner_user_id
 where confirmed_at is null and confirmed_by is null and status <> 'estimate' and gross_cents is not null;

-- The brokerage's base terms for an agent: default fees (each { label, amount, when }) and an optional cap.
alter table public.brokerage_links add column if not exists default_fees jsonb not null default '[]'::jsonb;
alter table public.brokerage_links add column if not exists cap_cents bigint;
alter table public.brokerage_links add column if not exists cap_reset text;
alter table public.brokerage_links add column if not exists cap_start date;
alter table public.brokerage_links drop constraint if exists brokerage_links_cap_check;
alter table public.brokerage_links add constraint brokerage_links_cap_check
  check ((cap_cents is null and cap_reset is null) or (cap_cents > 0 and cap_reset in ('calendar_year', 'anniversary')));

select column_name, is_nullable from information_schema.columns
 where table_schema = 'public' and table_name = 'deal_commissions' and column_name in ('gross_cents', 'agent_net_cents', 'brokerage_net_cents', 'confirmed_at', 'confirmed_by', 'cap_snapshot')
 order by column_name;
