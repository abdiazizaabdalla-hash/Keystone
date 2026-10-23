-- Sample data for the product screenshots, in the aabdiaziz47@gmail.com account ONLY
-- (user id 3853f16c-1775-4324-b0d5-0845eb99ce04). Everything is fictional: example.com emails,
-- made-up addresses and people. Dates are set relative to today, so run it the day you take screenshots.
-- Safe to run more than once: it removes its own earlier sample rows (file numbers starting SMP-,
-- listings whose notes are 'Sample data') and re-creates them. It never touches any other account.
--
-- Run in the Supabase SQL Editor (after add-closing-calendar-events.sql).

do $$
declare
  u uuid := '3853f16c-1775-4324-b0d5-0845eb99ce04';
  a_lena uuid; a_marcus uuid; a_ana uuid; a_sam uuid; a_priya uuid;
  t record; tx uuid; d record; l uuid; n int;
  steps text[] := array['Contract & File Setup','Earnest Money & Option','Inspection & Repairs','Title, Appraisal & Financing','Clear to Close','Closing & Post-Closing'];
begin
  -- ---------- clean up an earlier run ----------
  delete from public.invoices where invoice_number like 'SMP-%';
  delete from public.transactions where tc_user_id = u and file_number like 'SMP-%';
  delete from public.listings where tc_user_id = u and notes = 'Sample data';
  delete from public.contacts where tc_user_id = u and source = 'sample';

  -- ---------- agents ----------
  insert into public.agents (tc_user_id, name, brokerage, commission_percent, email, phone)
  select u, v.name, v.brokerage, 25, v.email, v.phone
  from (values
    ('Lena Park',     'Demo Realty Group',   'lena.park@example.com',   '(555) 010-1101'),
    ('Marcus Bell',   'Harbor & Co Realty',  'marcus.bell@example.com', '(555) 010-1102'),
    ('Ana Ortiz',     'Cedar Street Homes',  'ana.ortiz@example.com',   '(555) 010-1103'),
    ('Sam Whitfield', 'Lakeside Properties', 'sam.whitfield@example.com','(555) 010-1104'),
    ('Priya Nair',    'Orchard Lane Realty', 'priya.nair@example.com',  '(555) 010-1105')
  ) as v(name, brokerage, email, phone)
  where not exists (select 1 from public.agents x where x.tc_user_id = u and x.name = v.name);

  select id into a_lena   from public.agents where tc_user_id = u and name = 'Lena Park'     order by created_at limit 1;
  select id into a_marcus from public.agents where tc_user_id = u and name = 'Marcus Bell'   order by created_at limit 1;
  select id into a_ana    from public.agents where tc_user_id = u and name = 'Ana Ortiz'     order by created_at limit 1;
  select id into a_sam    from public.agents where tc_user_id = u and name = 'Sam Whitfield' order by created_at limit 1;
  select id into a_priya  from public.agents where tc_user_id = u and name = 'Priya Nair'    order by created_at limit 1;

  -- ---------- transactions, checklists, critical dates ----------
  -- done = how many checklist steps are complete; a = acceptance offset, c = closing offset (days from today)
  for t in
    select * from (values
      ('SMP-1001', '2218 Magnolia Ridge Lane',   a_lena,   412000, 'Inspection & Repairs',         2,  -9, 22),
      ('SMP-1002', '905 Harbor View Court',      a_marcus, 689900, 'Title, Appraisal & Financing', 3, -21, 12),
      ('SMP-1003', '41 Cedar Hollow Road',       a_ana,    355000, 'Contract & File Setup',        1,  -3, 35),
      ('SMP-1004', '77 Lakeside Avenue',         a_sam,    514000, 'Clear to Close',               4, -32,  6),
      ('SMP-1005', '1630 Pine Ridge Drive',      a_lena,   298500, 'Contract Pending',             0,   0, 40),
      ('SMP-1006', '33 Orchard Lane',            a_priya,  447000, 'Contract & File Setup',        1,  -1, 28),
      ('SMP-1007', '512 Bayview Terrace',        a_marcus, 603000, 'Closed',                       6, -60, -4)
    ) as v(fn, addr, agent, price, status, done, a, c)
  loop
    insert into public.transactions (tc_user_id, agent_id, file_number, property_address, purchase_price, status, acceptance_date, closing_date)
    values (u, t.agent, t.fn, t.addr, t.price, t.status, current_date + t.a, current_date + t.c)
    returning id into tx;

    for n in 1..6 loop
      insert into public.tasks (transaction_id, name, completed, sort_order, due_date)
      values (tx, steps[n], n <= t.done, n - 1,
        case n when 1 then current_date + t.a + 2 when 2 then current_date + t.a + 4 when 3 then current_date + t.a + 9
                 when 4 then current_date + t.a + 18 when 5 then current_date + t.c - 3 else current_date + t.c end);
    end loop;

    if t.fn = 'SMP-1001' then
      insert into public.transaction_key_dates (transaction_id, kind, label, due_date, completed, source) values
        (tx,'earnest_money','Earnest money due',current_date - 6,true,'manual'),
        (tx,'inspection','Inspection deadline',current_date + 3,false,'manual'),
        (tx,'financing','Financing contingency',current_date + 6,false,'manual'),
        (tx,'title_commitment','Title commitment due',current_date + 7,false,'manual'),
        (tx,'appraisal','Appraisal deadline',current_date + 12,false,'manual');
    elsif t.fn = 'SMP-1002' then
      insert into public.transaction_key_dates (transaction_id, kind, label, due_date, completed, source) values
        (tx,'appraisal','Appraisal deadline',current_date + 2,false,'manual'),
        (tx,'financing','Financing contingency',current_date + 4,false,'manual'),
        (tx,'title_commitment','Title commitment due',current_date + 5,false,'manual');
    elsif t.fn = 'SMP-1003' then
      insert into public.transaction_key_dates (transaction_id, kind, label, due_date, completed, source) values
        (tx,'earnest_money','Earnest money due',current_date + 1,false,'manual'),
        (tx,'inspection','Inspection deadline',current_date + 8,false,'manual');
    elsif t.fn = 'SMP-1004' then
      insert into public.transaction_key_dates (transaction_id, kind, label, due_date, completed, source) values
        (tx,'title_commitment','Title commitment due',current_date + 1,false,'manual');
    elsif t.fn = 'SMP-1005' then
      insert into public.transaction_key_dates (transaction_id, kind, label, due_date, completed, source) values
        (tx,'earnest_money','Earnest money due',current_date + 3,false,'manual');
    elsif t.fn = 'SMP-1006' then
      insert into public.transaction_key_dates (transaction_id, kind, label, due_date, completed, source) values
        (tx,'inspection','Inspection deadline',current_date + 6,false,'manual');
    end if;

    -- invoices: the closed deal is paid, two open deals are waiting
    if t.fn in ('SMP-1007','SMP-1004','SMP-1002') then
      insert into public.invoices (agent_id, transaction_id, amount_owed, invoice_number, invoice_date, due_date, paid, paid_at, paid_amount, sent_at, sent_to)
      values (t.agent, tx, case t.fn when 'SMP-1002' then 450 else 400 end, 'SMP-INV-' || right(t.fn, 4),
              now() - interval '20 days', current_date + case t.fn when 'SMP-1007' then -10 else 10 end,
              t.fn = 'SMP-1007', case when t.fn = 'SMP-1007' then now() - interval '5 days' end,
              case when t.fn = 'SMP-1007' then 400 end, now() - interval '20 days',
              (select email from public.agents where id = t.agent));
    end if;
  end loop;

  -- ---------- listings ----------
  insert into public.listings (tc_user_id, agent_id, property_address, seller_name, seller_email, list_price, planned_list_date, expiration_date, mls_number, status, notes)
  values (u, a_lena, '718 Willow Creek Lane', 'Jordan & Priya Shah', 'shah.family@example.com', 529000, current_date + 14, current_date + 104, null, 'preparing', 'Sample data')
  returning id into l;
  n := 0;
  for d in select * from (values
      ('Listing agreement signed', true,  -10), ('Seller disclosures collected', true, -6), ('Photographer booked', true, -4),
      ('Pre-listing inspection ordered', true, -2), ('Lockbox and signage', true, 0),
      ('Professional photos delivered', false, 4), ('MLS description approved', false, 8),
      ('Price review with seller', false, 11), ('Go live on MLS', false, 14)) as v(name, done, off)
  loop
    n := n + 1;
    insert into public.listing_tasks (listing_id, name, due_date, completed, sort_order) values (l, d.name, current_date + d.off, d.done, n);
  end loop;
  insert into public.listing_dates (listing_id, label, due_date) values (l, 'Open house', current_date + 17), (l, 'Price review', current_date + 21);

  insert into public.listings (tc_user_id, agent_id, property_address, seller_name, seller_email, list_price, planned_list_date, expiration_date, mls_number, status, notes)
  values (u, a_marcus, '1204 Sycamore Drive', 'Elena Rossi', 'elena.rossi@example.com', 639000, current_date - 10, current_date + 80, 'MLS-2048817', 'active', 'Sample data')
  returning id into l;
  n := 0;
  for d in select * from (values
      ('Listing agreement signed', true, -20), ('Photos and virtual tour', true, -14), ('Go live on MLS', true, -10),
      ('First weekend of showings', true, -7), ('Seller update call', false, 2), ('Review offers with seller', false, 6)) as v(name, done, off)
  loop
    n := n + 1;
    insert into public.listing_tasks (listing_id, name, due_date, completed, sort_order) values (l, d.name, current_date + d.off, d.done, n);
  end loop;
  insert into public.listing_dates (listing_id, label, due_date) values (l, 'Broker tour', current_date + 5), (l, 'Open house', current_date + 9);
  insert into public.listing_offers (listing_id, buyer_name, buyer_agent, offer_price, terms, status, received_on) values
    (l, 'M. Alvarez',  'Dana Cole',  628000, 'Conventional, 30-day close, inspection contingency.', 'countered', current_date - 3),
    (l, 'T. & R. Kim', 'Ravi Menon', 641500, 'Cash, 21-day close, no appraisal contingency.',        'received',  current_date - 1);
  insert into public.listing_showings (listing_id, showing_date, kind, visitor, interest, feedback) values
    (l, current_date - 8, 'open_house', '14 groups',     'warm', 'Loved the kitchen; several asked about the school zone.'),
    (l, current_date - 5, 'showing',    'Buyer agent Cole', 'hot',  'Second showing requested for this weekend.'),
    (l, current_date - 2, 'showing',    'Buyer agent Menon','hot',  'Writing an offer tonight.');

  insert into public.listings (tc_user_id, agent_id, property_address, seller_name, seller_email, list_price, planned_list_date, expiration_date, mls_number, status, notes)
  values (u, a_ana, '88 Heron Point Road', 'Walter & June Bishop', 'bishop.wj@example.com', 775000, current_date - 24, current_date + 66, 'MLS-2047102', 'under_offer', 'Sample data')
  returning id into l;
  insert into public.listing_tasks (listing_id, name, due_date, completed, sort_order) values
    (l, 'Listing agreement signed', current_date - 30, true, 1), (l, 'Go live on MLS', current_date - 24, true, 2), (l, 'Accepted offer: send to title', current_date + 1, false, 3);
  insert into public.listing_dates (listing_id, label, due_date) values (l, 'Option period ends', current_date + 4);
  insert into public.listing_offers (listing_id, buyer_name, buyer_agent, offer_price, terms, status, received_on) values
    (l, 'C. Hoffman', 'Lila Grant', 768000, 'FHA, 35-day close, seller pays $5,000 closing costs.', 'accepted', current_date - 5);

  -- ---------- contacts ----------
  insert into public.contacts (tc_user_id, name, email, phone, company, role, source) values
    (u, 'Hannah Reyes', 'hannah.reyes@example.com', '(555) 010-2201', 'Northshore Title',  'Title / escrow', 'sample'),
    (u, 'Colin Brooks', 'colin.brooks@example.com', '(555) 010-2202', 'First Harbor Lending','Lender',        'sample'),
    (u, 'Tamara Singh', 'tamara.singh@example.com', '(555) 010-2203', 'Pillar Inspections', 'Inspector',      'sample'),
    (u, 'Gabe Lindqvist','gabe.l@example.com',      '(555) 010-2204', 'Lindqvist Appraisal','Appraiser',      'sample');
end $$;

notify pgrst, 'reload schema';

select 'deals' as what, count(*) from public.transactions where tc_user_id = '3853f16c-1775-4324-b0d5-0845eb99ce04' and file_number like 'SMP-%'
union all select 'listings', count(*) from public.listings where tc_user_id = '3853f16c-1775-4324-b0d5-0845eb99ce04' and notes = 'Sample data'
union all select 'invoices', count(*) from public.invoices where invoice_number like 'SMP-%'
union all select 'contacts', count(*) from public.contacts where tc_user_id = '3853f16c-1775-4324-b0d5-0845eb99ce04' and source = 'sample';
