-- Gives the admin account (abdiaziz.a.abdalla@gmail.com) a full set of UPCOMING dates on its
-- 2 deals and 2 listings, so every kind of date can show on Google Calendar:
--   deals:    closing, critical dates (earnest money, inspection, appraisal, financing, title),
--             checklist task due dates
--   listings: go-live day, expiration, checklist step due dates, extra dates (open house, price review)
-- Only touches rows owned by that one login. Safe to run more than once.
-- Run AFTER add-closing-calendar-events.sql.

do $$
declare
  admin_id uuid := '6b41a519-8a34-4d41-923a-4b3bcfe5d870';
  t record;
  l record;
  n int := 0;
begin
  -- ---------- DEALS ----------
  for t in
    select id, closing_date from public.transactions
    where tc_user_id = admin_id and coalesce(status, '') <> 'Closed'
    order by created_at
  loop
    n := n + 1;

    -- closing a few weeks out (keeps an existing future closing date)
    if t.closing_date is null or t.closing_date < current_date then
      update public.transactions set closing_date = current_date + (21 + n * 7) where id = t.id;
    end if;

    -- critical dates: add each kind once if the deal doesn't already have it
    insert into public.transaction_key_dates (transaction_id, kind, label, due_date, source)
    select t.id, k.kind, k.label, current_date + k.days + n, 'manual'
    from (values
      ('earnest_money',    'Earnest money due',        3),
      ('inspection',       'Inspection deadline',      7),
      ('appraisal',        'Appraisal deadline',      12),
      ('financing',        'Financing contingency',   16),
      ('title_commitment', 'Title commitment',        18)
    ) as k(kind, label, days)
    where not exists (
      select 1 from public.transaction_key_dates d
      where d.transaction_id = t.id and d.kind = k.kind
    );

    -- any critical date that is in the past or completed becomes upcoming again
    update public.transaction_key_dates
       set due_date = current_date + 5 + n, completed = false
     where transaction_id = t.id and kind <> 'closing' and due_date < current_date;

    -- checklist tasks: every open task gets a due date, spread over the coming weeks
    update public.tasks x
       set due_date = current_date + 2 + (s.rn * 2)::int
      from (
        select id, row_number() over (order by created_at, id) as rn
        from public.tasks
        where transaction_id = t.id and coalesce(completed, false) = false
      ) s
     where x.id = s.id;
  end loop;

  -- ---------- LISTINGS ----------
  n := 0;
  for l in
    select id from public.listings
    where tc_user_id = admin_id and status in ('preparing', 'active', 'under_offer')
    order by created_at
  loop
    n := n + 1;

    update public.listings
       set planned_list_date = current_date + 4 + n * 2,
           expiration_date   = current_date + 90
     where id = l.id;

    update public.listing_tasks x
       set due_date = current_date + 1 + (s.rn * 2)::int
      from (
        select id, row_number() over (order by sort_order, created_at, id) as rn
        from public.listing_tasks
        where listing_id = l.id and coalesce(completed, false) = false
      ) s
     where x.id = s.id;

    insert into public.listing_dates (listing_id, label, due_date)
    select l.id, d.label, current_date + d.days + n
    from (values ('Open house', 10), ('Price review', 21)) as d(label, days)
    where not exists (
      select 1 from public.listing_dates e where e.listing_id = l.id and e.label = d.label
    );

    update public.listing_dates
       set due_date = current_date + 10 + n
     where listing_id = l.id and due_date < current_date;
  end loop;
end $$;

-- Check: everything below should show future dates for the admin login.
select 'deal closing' as kind, t.property_address as what, t.closing_date as due
from public.transactions t
where t.tc_user_id = '6b41a519-8a34-4d41-923a-4b3bcfe5d870' and t.closing_date >= current_date
union all
select 'critical date', t.property_address || ' — ' || d.label, d.due_date
from public.transaction_key_dates d join public.transactions t on t.id = d.transaction_id
where t.tc_user_id = '6b41a519-8a34-4d41-923a-4b3bcfe5d870' and d.due_date >= current_date and not d.completed
union all
select 'deal task', t.property_address || ' — ' || k.name, k.due_date
from public.tasks k join public.transactions t on t.id = k.transaction_id
where t.tc_user_id = '6b41a519-8a34-4d41-923a-4b3bcfe5d870' and k.due_date >= current_date and not coalesce(k.completed, false)
union all
select 'listing', l.property_address || ' — go live', l.planned_list_date
from public.listings l where l.tc_user_id = '6b41a519-8a34-4d41-923a-4b3bcfe5d870' and l.planned_list_date >= current_date
union all
select 'listing step', l.property_address || ' — ' || k.name, k.due_date
from public.listing_tasks k join public.listings l on l.id = k.listing_id
where l.tc_user_id = '6b41a519-8a34-4d41-923a-4b3bcfe5d870' and k.due_date >= current_date and not coalesce(k.completed, false)
union all
select 'listing date', l.property_address || ' — ' || d.label, d.due_date
from public.listing_dates d join public.listings l on l.id = d.listing_id
where l.tc_user_id = '6b41a519-8a34-4d41-923a-4b3bcfe5d870' and d.due_date >= current_date
order by 3, 1;
