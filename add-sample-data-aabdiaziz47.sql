-- ONE script: wipes the aabdiaziz47@gmail.com account (user id 3853f16c-1775-4324-b0d5-0845eb99ce04) and fills it with clean,
-- believable sample data for the product screenshots. Fictional people and made-up addresses in one market (Austin, TX area);
-- example.com emails; every deadline sits in a sensible order after the acceptance date and before closing, relative to TODAY.
--
-- WARNING: it permanently deletes that one account's deals, listings, invoices, contacts and agents first. It touches no other account.
-- Safe to run more than once. Run in the Supabase SQL Editor (after add-closing-calendar-events.sql).

do $$
declare
  u uuid := '3853f16c-1775-4324-b0d5-0845eb99ce04';
  a_lena uuid; a_marcus uuid; a_ana uuid; a_sam uuid; a_priya uuid;
  t record; tx uuid; d record; l uuid; n int; a int; c int;
  steps text[] := array['Contract & File Setup','Earnest Money & Option','Inspection & Repairs','Title, Appraisal & Financing','Clear to Close','Closing & Post-Closing'];
  stages text[] := array['Contract Pending','Contract & File Setup','Earnest Money & Option','Inspection & Repairs','Title, Appraisal & Financing','Clear to Close','Closed'];
begin
  -- ---------- wipe this account ----------
  delete from public.invoices where transaction_id in (select id from public.transactions where tc_user_id = u);
  delete from public.transactions where tc_user_id = u;
  delete from public.listings where tc_user_id = u;
  delete from public.contacts where tc_user_id = u;
  delete from public.agents where tc_user_id = u;

  -- ---------- agents ----------
  insert into public.agents (tc_user_id, name, brokerage, commission_percent, email, phone) values
    (u, 'Lena Park',     'Capital City Realty',    25, 'lena.park@example.com',     '(512) 555-0141'),
    (u, 'Marcus Bell',   'Lakeline Properties',    25, 'marcus.bell@example.com',   '(512) 555-0142'),
    (u, 'Ana Ortiz',     'Hill Country Homes',     25, 'ana.ortiz@example.com',     '(512) 555-0143'),
    (u, 'Sam Whitfield', 'Lakeway Luxury Group',   25, 'sam.whitfield@example.com', '(512) 555-0144'),
    (u, 'Priya Nair',    'Georgetown Home Co.',    25, 'priya.nair@example.com',    '(512) 555-0145');
  select id into a_lena   from public.agents where tc_user_id = u and name = 'Lena Park';
  select id into a_marcus from public.agents where tc_user_id = u and name = 'Marcus Bell';
  select id into a_ana    from public.agents where tc_user_id = u and name = 'Ana Ortiz';
  select id into a_sam    from public.agents where tc_user_id = u and name = 'Sam Whitfield';
  select id into a_priya  from public.agents where tc_user_id = u and name = 'Priya Nair';

  -- ---------- deals ----------
  -- a = days from today to the acceptance date; done = checklist steps complete (status follows it); closing = acceptance + 32 days
  for t in
    select * from (values
      ('2026-1001', '2218 Magnolia Ridge Lane, Austin, TX 78704',   a_lena,   412000,  -9, 2),
      ('2026-1002', '905 Harbor View Court, Austin, TX 78746',      a_marcus, 689900, -21, 4),
      ('2026-1003', '41 Cedar Hollow Road, Cedar Park, TX 78613',   a_ana,    355000,  -3, 1),
      ('2026-1004', '77 Lakeside Avenue, Lakeway, TX 78734',        a_sam,    514000, -26, 5),
      ('2026-1005', '1630 Pine Ridge Drive, Round Rock, TX 78664',  a_lena,   298500,   0, 0),
      ('2026-1006', '33 Orchard Lane, Georgetown, TX 78628',        a_priya,  447000,  -1, 1),
      ('2026-0988', '512 Bayview Terrace, Austin, TX 78731',        a_marcus, 603000, -60, 6)
    ) as v(fn, addr, agent, price, a, done)
  loop
    a := t.a; c := a + 32;
    insert into public.transactions (tc_user_id, agent_id, file_number, property_address, purchase_price, status, acceptance_date, closing_date, inbound_token)
    values (u, t.agent, t.fn, t.addr, t.price, stages[t.done + 1], current_date + a, current_date + c, lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)))
    returning id into tx;

    -- checklist: each step has a due date that follows the contract timeline
    for n in 1..6 loop
      insert into public.tasks (transaction_id, name, completed, sort_order, due_date)
      values (tx, steps[n], n <= t.done, n - 1,
        current_date + case n when 1 then a + 2 when 2 then a + 3 when 3 then a + 12 when 4 then a + 25 when 5 then c - 3 else c end);
    end loop;

    -- critical dates in contract order; anything already past is marked done
    insert into public.transaction_key_dates (transaction_id, kind, label, due_date, completed, source)
    select tx, k.kind, k.label, current_date + a + k.off, (a + k.off) < 0, 'manual'
    from (values
      ('earnest_money',    'Earnest money due',      3),
      ('inspection',       'Inspection deadline',   12),
      ('appraisal',        'Appraisal deadline',    19),
      ('financing',        'Financing contingency', 22),
      ('title_commitment', 'Title commitment due',  25)
    ) as k(kind, label, off);
    insert into public.transaction_key_dates (transaction_id, kind, label, due_date, completed, source)
    values (tx, 'custom', 'Final walkthrough', current_date + c - 1, (c - 1) < 0, 'manual');

    -- invoices: the closed deal is paid; two open deals are waiting
    if t.fn in ('2026-0988', '2026-1004', '2026-1002') then
      insert into public.invoices (agent_id, transaction_id, amount_owed, invoice_number, invoice_date, due_date, paid, paid_at, paid_amount, sent_at, sent_to)
      values (t.agent, tx, case t.fn when '2026-1002' then 450 else 400 end, 'INV-' || right(t.fn, 4),
              now() - interval '12 days', current_date + case t.fn when '2026-0988' then -2 else 18 end,
              t.fn = '2026-0988', case when t.fn = '2026-0988' then now() - interval '6 days' end,
              case when t.fn = '2026-0988' then 400 end, now() - interval '12 days',
              (select email from public.agents where id = t.agent));
    end if;
  end loop;

  -- ---------- listings ----------
  -- 1) preparing: checklist runs up to a go-live date two weeks out
  insert into public.listings (tc_user_id, agent_id, property_address, seller_name, seller_email, list_price, planned_list_date, expiration_date, mls_number, status, notes)
  values (u, a_lena, '718 Willow Creek Lane, Austin, TX 78759', 'Jordan & Priya Shah', 'shah.family@example.com', 529000, current_date + 14, current_date + 194, null, 'preparing', null)
  returning id into l;
  n := 0;
  for d in select * from (values
      ('Listing agreement signed',        true,  -12), ('Seller disclosures collected', true,  -8), ('Photographer booked',           true,  -5),
      ('Pre-listing inspection ordered',  true,  -2),  ('Lockbox and signage',          true,   0),
      ('Professional photos delivered',   false,  4),  ('MLS description approved',     false,  8),
      ('Price review with seller',        false, 11),  ('Go live on MLS',               false, 14)) as v(name, done, off)
  loop
    n := n + 1;
    insert into public.listing_tasks (listing_id, name, due_date, completed, sort_order) values (l, d.name, current_date + d.off, d.done, n);
  end loop;
  insert into public.listing_dates (listing_id, label, due_date) values (l, 'Open house', current_date + 17), (l, 'Price review', current_date + 21);

  -- 2) active, listed 10 days ago, with offers and showings
  insert into public.listings (tc_user_id, agent_id, property_address, seller_name, seller_email, list_price, planned_list_date, expiration_date, mls_number, status, notes)
  values (u, a_marcus, '1204 Sycamore Drive, Cedar Park, TX 78613', 'Elena Rossi', 'elena.rossi@example.com', 639000, current_date - 10, current_date + 170, 'MLS-2048817', 'active', null)
  returning id into l;
  n := 0;
  for d in select * from (values
      ('Listing agreement signed',    true, -24), ('Photos and virtual tour',    true, -16), ('Go live on MLS',            true, -10),
      ('First weekend of showings',   true,  -7), ('Seller update call',         false,  2), ('Review offers with seller', false,  4)) as v(name, done, off)
  loop
    n := n + 1;
    insert into public.listing_tasks (listing_id, name, due_date, completed, sort_order) values (l, d.name, current_date + d.off, d.done, n);
  end loop;
  insert into public.listing_dates (listing_id, label, due_date) values (l, 'Broker tour', current_date + 5), (l, 'Open house', current_date + 9);
  insert into public.listing_offers (listing_id, buyer_name, buyer_agent, offer_price, terms, status, received_on) values
    (l, 'M. Alvarez',  'Dana Cole',  628000, 'Conventional, 30-day close, inspection contingency.', 'countered', current_date - 3),
    (l, 'T. & R. Kim', 'Ravi Menon', 641500, 'Cash, 21-day close, no appraisal contingency.',        'received',  current_date - 1);
  insert into public.listing_showings (listing_id, showing_date, kind, visitor, interest, feedback) values
    (l, current_date - 8, 'open_house', '14 groups',        'warm', 'Loved the kitchen; several asked about the school zone.'),
    (l, current_date - 5, 'showing',    'Dana Cole',        'hot',  'Second showing requested for this weekend.'),
    (l, current_date - 2, 'showing',    'Ravi Menon',       'hot',  'Writing an offer tonight.');

  -- 3) under offer: accepted offer, option period still running
  insert into public.listings (tc_user_id, agent_id, property_address, seller_name, seller_email, list_price, planned_list_date, expiration_date, mls_number, status, notes)
  values (u, a_ana, '88 Heron Point Road, Lakeway, TX 78734', 'Walter & June Bishop', 'bishop.wj@example.com', 775000, current_date - 24, current_date + 156, 'MLS-2047102', 'under_offer', null)
  returning id into l;
  insert into public.listing_tasks (listing_id, name, due_date, completed, sort_order) values
    (l, 'Listing agreement signed', current_date - 30, true, 1), (l, 'Go live on MLS', current_date - 24, true, 2), (l, 'Accepted offer: send to title', current_date + 1, false, 3);
  insert into public.listing_dates (listing_id, label, due_date) values (l, 'Option period ends', current_date + 4);
  insert into public.listing_offers (listing_id, buyer_name, buyer_agent, offer_price, terms, status, received_on) values
    (l, 'C. Hoffman', 'Lila Grant', 768000, 'FHA, 35-day close, seller pays $5,000 closing costs.', 'accepted', current_date - 5);

  -- ---------- contacts ----------
  insert into public.contacts (tc_user_id, name, email, phone, company, role, source) values
    (u, 'Hannah Reyes',   'hannah.reyes@example.com', '(512) 555-0161', 'Northshore Title',     'Title / escrow', 'manual'),
    (u, 'Colin Brooks',   'colin.brooks@example.com', '(512) 555-0162', 'First Harbor Lending', 'Lender',         'manual'),
    (u, 'Tamara Singh',   'tamara.singh@example.com', '(512) 555-0163', 'Pillar Inspections',   'Inspector',      'manual'),
    (u, 'Gabe Lindqvist', 'gabe.l@example.com',       '(512) 555-0164', 'Lindqvist Appraisal',  'Appraiser',      'manual');
end $$;

notify pgrst, 'reload schema';

select 'deals' as what, count(*) from public.transactions where tc_user_id = '3853f16c-1775-4324-b0d5-0845eb99ce04'
union all select 'listings', count(*) from public.listings where tc_user_id = '3853f16c-1775-4324-b0d5-0845eb99ce04'
union all select 'invoices', count(*) from public.invoices i join public.transactions t on t.id = i.transaction_id where t.tc_user_id = '3853f16c-1775-4324-b0d5-0845eb99ce04'
union all select 'agents', count(*) from public.agents where tc_user_id = '3853f16c-1775-4324-b0d5-0845eb99ce04';
