-- DEMO TEAM: sets up abdiaziz.a.abdalla@gmail.com as the manager of a busy Team account with two team members
-- (aabdiaziz47@gmail.com = "Maya Chen", aaa7420023@gmail.com = "Jordan Reyes"), filled with believable data:
-- 24 open deals, 15 closed deals with paid and unpaid invoices, 7 listings (preparing, active, under offer) with offers
-- and showings, about 45 contacts, agents for every TC, and team chat. Fictional people, example.com emails, Austin TX area.
-- Everything is dated relative to TODAY, so run it right before a demo and it looks current.
--
-- WARNING: permanently deletes the deals, listings, invoices, contacts and agents of these THREE accounts first
-- (including the ZZ test data). It touches no other account. Nothing is emailed: it only writes database rows.
-- Safe to run more than once. Run in the Supabase SQL Editor.

do $$
declare
  owner_email text := 'abdiaziz.a.abdalla@gmail.com';
  m1_email    text := 'aabdiaziz47@gmail.com';
  m2_email    text := 'aaa7420023@gmail.com';
  u0 uuid; u1 uuid; u2 uuid; tm uuid; uid uuid;
  t record; d record; tx uuid; l uuid; ag uuid;
  k int := 0; n int; c int; a int;
  amt numeric;
  steps text[] := array['Contract & File Setup','Earnest Money & Option','Inspection & Repairs','Title, Appraisal & Financing','Clear to Close','Closing & Post-Closing'];
  stages text[] := array['Contract Pending','Contract & File Setup','Earnest Money & Option','Inspection & Repairs','Title, Appraisal & Financing','Clear to Close','Closed'];
  firsts text[] := array['Priya','Daniel','Maria','Chris','Aisha','Tom','Lauren','Victor','Grace','Omar','Elena','Ben'];
  lasts  text[] := array['Patel','Nguyen','Alvarez','Thompson','Rahman','Becker','Okafor','Murphy','Silva','Khan','Rossi','Hart'];
  lenders text[] := array['Colin Brooks','Dana Whitaker','Rafael Ortega','Kim Nguyen'];
  titles  text[] := array['Hannah Reyes','Marcus Doyle','Elise Navarro','Priscilla Tran'];
begin
  select id into u0 from auth.users where lower(email) = owner_email;
  select id into u1 from auth.users where lower(email) = m1_email;
  select id into u2 from auth.users where lower(email) = m2_email;
  if u0 is null or u1 is null or u2 is null then
    raise exception 'One of the three accounts does not exist yet (owner %, member 1 %, member 2 %).', u0, u1, u2;
  end if;

  -- ---------- the team ----------
  select team_id into tm from public.team_members where user_id = u0 limit 1;
  if tm is null then
    insert into public.teams (owner_id) values (u0) returning id into tm;
    insert into public.team_members (team_id, user_id, role) values (tm, u0, 'owner');
  end if;
  update public.teams set name = 'Lone Star Closing Team' where id = tm;
  delete from public.team_members where user_id in (u1, u2) and team_id <> tm;
  insert into public.team_members (team_id, user_id, role)
    select tm, x, 'member' from unnest(array[u1, u2]) x
    where not exists (select 1 from public.team_members where team_id = tm and user_id = x);

  -- names, Team plan and "setup finished" for the two members (the owner is already set up)
  update auth.users set
    raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', 'Maya Chen', 'onboarding_completed', true),
    raw_app_meta_data  = coalesce(raw_app_meta_data,  '{}'::jsonb) || jsonb_build_object('plan', 'team')
  where id = u1;
  update auth.users set
    raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', 'Jordan Reyes', 'onboarding_completed', true),
    raw_app_meta_data  = coalesce(raw_app_meta_data,  '{}'::jsonb) || jsonb_build_object('plan', 'team')
  where id = u2;

  -- ---------- wipe the three accounts ----------
  delete from public.invoices where transaction_id in (select id from public.transactions where tc_user_id in (u0, u1, u2));
  delete from public.transactions where tc_user_id in (u0, u1, u2);
  delete from public.listings where tc_user_id in (u0, u1, u2);
  delete from public.contacts where tc_user_id in (u0, u1, u2);
  delete from public.agents where tc_user_id in (u0, u1, u2);
  delete from public.team_messages where team_id = tm;

  -- ---------- agents (each TC works with their own) ----------
  insert into public.agents (tc_user_id, team_id, name, brokerage, commission_percent, email, phone)
  select case v.tc when 0 then u0 when 1 then u1 else u2 end, tm, v.name, v.brk, 0,
         lower(replace(v.name, ' ', '.')) || '@example.com', '(512) 555-' || lpad((1100 + row_number() over ())::text, 4, '0')
  from (values
    (0, 'Lena Park',     'Capital City Realty'),   (0, 'Marcus Bell',   'Lakeline Properties'),   (0, 'Ana Ortiz',     'Hill Country Homes'),
    (0, 'Sam Whitfield', 'Lakeway Luxury Group'),  (0, 'Priya Nair',    'Georgetown Home Co.'),   (0, 'Devon Hayes',   'Barton Springs Realty'),
    (1, 'Rosa Delgado',  'South Congress Group'),  (1, 'Tyler Brooks',  'Pflugerville Realty'),   (1, 'Nina Kapoor',   'Domain Residential'),
    (1, 'Caleb Moore',   'Oak Hill Brokers'),
    (2, 'Hana Sato',     'Mueller Realty Partners'), (2, 'Eric Lindgren', 'Bee Cave Properties'),  (2, 'Tasha Williams','East Austin Homes'),
    (2, 'Omar Haddad',   'Leander Home Group')
  ) as v(tc, name, brk);

  -- ---------- deals ----------
  -- tc 0/1/2 = Abdiaziz / Maya / Jordan; a = days from today to acceptance; done = checklist steps finished; cl = days from
  -- acceptance to closing; waiting = who the next step is stuck on; inv = open deal that already has an invoice;
  -- pay = closed deal: days after closing the invoice was paid (null = still unpaid)
  for t in
    select * from (values
      -- Abdiaziz (manager): open
      ('2026-2101', 0, 'Lena Park',     '2218 Magnolia Ridge Lane, Austin, TX 78704',        412000,  -9, 2, 32, null,            0, null),
      ('2026-2102', 0, 'Marcus Bell',   '905 Harbor View Court, Austin, TX 78746',           689900, -21, 3, 35, 'Lender',        0, null),
      ('2026-2103', 0, 'Ana Ortiz',     '41 Cedar Hollow Road, Cedar Park, TX 78613',        355000,  -3, 1, 30, null,            0, null),
      ('2026-2104', 0, 'Sam Whitfield', '77 Lakeside Avenue, Lakeway, TX 78734',             514000, -26, 4, 33, 'Title company', 0, null),
      ('2026-2105', 0, 'Lena Park',     '1630 Pine Ridge Drive, Round Rock, TX 78664',       298500,   0, 0, 34, null,            0, null),
      ('2026-2106', 0, 'Priya Nair',    '33 Orchard Lane, Georgetown, TX 78628',             447000,  -1, 1, 31, null,            0, null),
      ('2026-2107', 0, 'Devon Hayes',   '4107 Juniper Bend, Austin, TX 78745',               389000, -17, 2, 28, null,            0, null),
      ('2026-2108', 0, 'Ana Ortiz',     '12 Windmill Court, Cedar Park, TX 78613',           560000, -30, 5, 32, null,            1, null),
      ('2026-2109', 0, 'Marcus Bell',   '600 Congress Ave Unit 1204, Austin, TX 78701',      725000, -12, 2, 40, 'Buyer',         0, null),
      -- Maya Chen: open
      ('2026-2110', 1, 'Tyler Brooks',  '3302 Bluebonnet Trail, Pflugerville, TX 78660',     332000,  -6, 1, 33, null,            0, null),
      ('2026-2111', 1, 'Nina Kapoor',   '58 Sundance Way, Austin, TX 78729',                 478000, -19, 3, 31, 'Inspector',     0, null),
      ('2026-2112', 1, 'Rosa Delgado',  '1920 Riverside Dr Unit 5B, Austin, TX 78741',       365000,  -2, 1, 36, null,            0, null),
      ('2026-2113', 1, 'Caleb Moore',   '744 Oak Hill Parkway, Austin, TX 78735',            612000, -28, 4, 35, null,            0, null),
      ('2026-2114', 1, 'Nina Kapoor',   '9 Stonecrest Circle, Austin, TX 78759',             540000, -14, 2, 29, null,            0, null),
      ('2026-2115', 1, 'Rosa Delgado',  '2501 Barton Hills Drive, Austin, TX 78704',         835000, -33, 5, 36, null,            1, null),
      ('2026-2116', 1, 'Tyler Brooks',  '311 Cottonwood Street, Pflugerville, TX 78660',     289000,   1, 0, 30, null,            0, null),
      ('2026-2117', 1, 'Caleb Moore',   '1450 Skyline Terrace, Austin, TX 78746',            920000,  -8, 2, 45, 'Appraiser',     0, null),
      -- Jordan Reyes: open
      ('2026-2118', 2, 'Eric Lindgren', '27 Meadow Brook Lane, Bee Cave, TX 78738',          705000, -11, 2, 38, null,            0, null),
      ('2026-2119', 2, 'Hana Sato',     '3815 Mueller Blvd Unit 310, Austin, TX 78723',      398000,  -4, 1, 33, null,            0, null),
      ('2026-2120', 2, 'Eric Lindgren', '602 Spyglass Lane, Austin, TX 78746',              1180000, -24, 4, 37, 'Title company', 0, null),
      ('2026-2121', 2, 'Tasha Williams','1812 E 12th Street, Austin, TX 78702',              455000, -16, 2, 34, null,            0, null),
      ('2026-2122', 2, 'Omar Haddad',   '90 Prairie Wind Drive, Leander, TX 78641',          349000,  -7, 2, 32, null,            0, null),
      ('2026-2123', 2, 'Hana Sato',     '540 Bellmont Ridge, Austin, TX 78702',              512000,  -1, 0, 35, null,            0, null),
      ('2026-2124', 2, 'Omar Haddad',   '2205 Hilltop Court, Leander, TX 78641',             318000, -22, 3, 30, 'Lender',        0, null),
      -- closed (last four months)
      ('2026-2001', 0, 'Sam Whitfield', '1405 Westbank Drive, West Lake Hills, TX 78746',    950000, -78, 6, 33, null,            0, 4),
      ('2026-2002', 0, 'Marcus Bell',   '512 Bayview Terrace, Austin, TX 78731',             603000, -64, 6, 32, null,            0, 6),
      ('2026-2003', 0, 'Priya Nair',    '2611 Sunset Ridge, Georgetown, TX 78628',           421000, -96, 6, 34, null,            0, 5),
      ('2026-2004', 0, 'Lena Park',     '17 Arbor Glen, Round Rock, TX 78681',               335000,-115, 6, 31, null,            0, 8),
      ('2026-2005', 0, 'Devon Hayes',   '3350 Rollingwood Drive, Austin, TX 78746',          780000, -52, 6, 30, null,            0, 7),
      ('2026-2006', 0, 'Ana Ortiz',     '66 Quail Hollow, Cedar Park, TX 78613',             391000, -45, 6, 33, null,            0, null),
      ('2026-2007', 1, 'Rosa Delgado',  '1011 Chicon Street, Austin, TX 78702',              489000, -70, 6, 32, null,            0, 3),
      ('2026-2008', 1, 'Tyler Brooks',  '45 Wildflower Court, Pflugerville, TX 78660',       305000, -58, 6, 31, null,            0, 5),
      ('2026-2009', 1, 'Nina Kapoor',   '2030 Lamar Blvd Unit 12, Austin, TX 78705',         372000,-104, 6, 33, null,            0, 9),
      ('2026-2010', 1, 'Caleb Moore',   '815 Scenic Drive, Austin, TX 78703',               1090000, -40, 6, 30, null,            0, 2),
      ('2026-2011', 1, 'Rosa Delgado',  '7 Longhorn Lane, Austin, TX 78745',                 342000,-125, 6, 34, null,            0, 4),
      ('2026-2012', 2, 'Eric Lindgren', '19 Clover Hill, Bee Cave, TX 78738',                865000, -60, 6, 33, null,            0, 3),
      ('2026-2013', 2, 'Omar Haddad',   '3 Silver Creek, Leander, TX 78641',                 312000, -88, 6, 32, null,            0, 6),
      ('2026-2014', 2, 'Tasha Williams','2417 Manor Road, Austin, TX 78722',                 436000, -47, 6, 31, null,            0, null),
      ('2026-2015', 2, 'Hana Sato',     '120 Eastside Ave, Austin, TX 78702',                401000,-132, 6, 35, null,            0, 5)
    ) as v(fn, tc, agent, addr, price, a, done, cl, waiting, inv, pay)
  loop
    k := k + 1;
    uid := case t.tc when 0 then u0 when 1 then u1 else u2 end;
    select id into ag from public.agents where tc_user_id = uid and name = t.agent;
    a := t.a; c := t.a + t.cl;

    insert into public.transactions (tc_user_id, agent_id, file_number, property_address, purchase_price, status, acceptance_date, closing_date, inbound_token)
    values (uid, ag, t.fn, t.addr, t.price, stages[t.done + 1], current_date + a, current_date + c, lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)))
    returning id into tx;

    -- checklist: due dates follow the contract timeline
    for n in 1..6 loop
      insert into public.tasks (transaction_id, name, completed, sort_order, due_date, waiting_on, waiting_on_since)
      values (tx, steps[n], n <= t.done, n - 1,
        current_date + case n when 1 then a + 2 when 2 then a + 3 when 3 then a + 12 when 4 then least(a + 25, c - 5) when 5 then c - 3 else c end,
        case when t.waiting is not null and n = t.done + 1 then t.waiting end,
        case when t.waiting is not null and n = t.done + 1 then current_date - (2 + k % 5) end);
    end loop;

    -- critical dates; past ones are done, except financing/title on deals stuck waiting
    insert into public.transaction_key_dates (transaction_id, kind, label, due_date, completed, source)
    select tx, kd.kind, kd.label, current_date + a + kd.off,
           (a + kd.off) < 0 and not (t.waiting is not null and kd.kind in ('financing', 'title_commitment')), 'manual'
    from (values
      ('earnest_money',    'Earnest money due',      3),
      ('inspection',       'Inspection deadline',   12),
      ('appraisal',        'Appraisal deadline',    19),
      ('financing',        'Financing contingency', 22),
      ('title_commitment', 'Title commitment due',  25)
    ) as kd(kind, label, off);
    insert into public.transaction_key_dates (transaction_id, kind, label, due_date, completed, source)
    values (tx, 'custom', 'Final walkthrough', current_date + c - 1, (c - 1) < 0, 'manual');

    -- the people on the deal
    insert into public.transaction_contacts (transaction_id, role, name, email, phone, position) values
      (tx, 'Buyer',         firsts[(k % 12) + 1] || ' ' || lasts[((k * 5) % 12) + 1], 'buyer' || k || '@example.com', '(512) 555-' || lpad((2000 + k)::text, 4, '0'), 0),
      (tx, 'Seller',        firsts[((k * 7 + 3) % 12) + 1] || ' ' || lasts[((k * 3 + 1) % 12) + 1], 'seller' || k || '@example.com', '(512) 555-' || lpad((3000 + k)::text, 4, '0'), 1),
      (tx, 'Lender',        lenders[(k % 4) + 1], lower(replace(lenders[(k % 4) + 1], ' ', '.')) || '@example.com', '(512) 555-' || lpad((4000 + k % 4)::text, 4, '0'), 2),
      (tx, 'Title / escrow', titles[((k + 1) % 4) + 1], lower(replace(titles[((k + 1) % 4) + 1], ' ', '.')) || '@example.com', '(512) 555-' || lpad((5000 + k % 4)::text, 4, '0'), 3);

    -- invoices: closed deals are billed at closing (most paid), two open deals near closing already have one
    if t.done = 6 or t.inv = 1 then
      amt := 350 + 50 * (k % 4);
      insert into public.invoices (agent_id, transaction_id, amount_owed, invoice_number, invoice_date, due_date, paid, paid_at, paid_amount, sent_at, sent_to)
      values (ag, tx, amt, 'RLY-' || t.fn,
              (current_date + case when t.done = 6 then c else -2 end)::timestamp + interval '9 hours',
              current_date + case when t.done = 6 then c else -2 end + 14,
              t.pay is not null,
              case when t.pay is not null then (current_date + c + t.pay)::timestamp + interval '14 hours' end,
              case when t.pay is not null then amt end,
              (current_date + case when t.done = 6 then c else -2 end)::timestamp + interval '10 hours',
              (select email from public.agents where id = ag));
    end if;
  end loop;

  -- ---------- listings ----------
  -- tc, agent, address, seller, email, list price, status, planned list date (days from today), mls
  k := 0;
  for t in
    select * from (values
      (0, 'Lena Park',     '718 Willow Creek Lane, Austin, TX 78759',      'Jordan & Priya Shah',  'shah.family@example.com', 529000, 'preparing',   14, null),
      (0, 'Marcus Bell',   '1204 Sycamore Drive, Cedar Park, TX 78613',    'Elena Rossi',          'elena.rossi@example.com', 639000, 'active',     -10, 'MLS-2048817'),
      (0, 'Ana Ortiz',     '88 Heron Point Road, Lakeway, TX 78734',       'Walter & June Bishop', 'bishop.wj@example.com',   775000, 'under_offer',-24, 'MLS-2047102'),
      (1, 'Nina Kapoor',   '204 Lantana Court, Austin, TX 78731',          'Grace Whitman',        'grace.whitman@example.com', 585000, 'active',    -6, 'MLS-2049930'),
      (1, 'Rosa Delgado',  '1618 Alta Vista Avenue, Austin, TX 78704',     'The Moreno Family',    'moreno.fam@example.com',  449000, 'preparing',    9, null),
      (2, 'Eric Lindgren', '15 Vista Ridge Drive, Bee Cave, TX 78738',     'Richard Osei',         'r.osei@example.com',      995000, 'active',     -15, 'MLS-2048255'),
      (2, 'Hana Sato',     '2909 Tannehill Lane, Austin, TX 78702',        'Camille Dubois',       'camille.dubois@example.com', 515000, 'under_offer', -19, 'MLS-2047661')
    ) as v(tc, agent, addr, seller, email, price, status, planned, mls)
  loop
    k := k + 1;
    uid := case t.tc when 0 then u0 when 1 then u1 else u2 end;
    select id into ag from public.agents where tc_user_id = uid and name = t.agent;
    insert into public.listings (tc_user_id, agent_id, property_address, seller_name, seller_email, list_price, planned_list_date, expiration_date, mls_number, status)
    values (uid, ag, t.addr, t.seller, t.email, t.price, current_date + t.planned, current_date + t.planned + 180, t.mls, t.status)
    returning id into l;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'listings' and column_name = 'listed_on') and t.status <> 'preparing' then
      execute 'update public.listings set listed_on = $1 where id = $2' using current_date + t.planned, l;
    end if;

    -- checklist: before go-live for a listing being prepared, after it for one on the market
    n := 0;
    for d in
      select * from (values
        ('Listing agreement signed and filed', -21), ('Seller disclosures collected', -14), ('Photographer scheduled', -12),
        ('Photos, video and floor plan delivered', -5), ('Listing description and MLS data prepared', -3), ('Yard sign and lockbox ordered', -2),
        ('Go live on MLS', 0), ('First weekend of showings', 3), ('Weekly update to seller', 7), ('Review showing feedback and price', 12)
      ) as s(name, off)
    loop
      n := n + 1;
      insert into public.listing_tasks (listing_id, name, due_date, completed, sort_order)
      values (l, d.name, current_date + t.planned + d.off, (current_date + t.planned + d.off) < current_date - 1, n);
    end loop;
    insert into public.listing_dates (listing_id, label, due_date) values
      (l, 'Open house', current_date + 4 + k), (l, 'Price review', current_date + 12 + k);

    if t.status = 'active' then
      insert into public.listing_offers (listing_id, buyer_name, buyer_agent, offer_price, terms, status, received_on) values
        (l, 'M. Alvarez',  'Dana Cole',  round(t.price * 0.985), 'Conventional, 30-day close, inspection contingency.', 'countered', current_date - 3),
        (l, 'T. & R. Kim', 'Ravi Menon', round(t.price * 1.005), 'Cash, 21-day close, no appraisal contingency.',        'received',  current_date - 1);
      insert into public.listing_showings (listing_id, showing_date, kind, visitor, interest, feedback) values
        (l, current_date - 8, 'open_house', '14 groups',  'warm', 'Loved the kitchen; several asked about the school zone.'),
        (l, current_date - 5, 'showing',    'Dana Cole',  'hot',  'Second showing requested for this weekend.'),
        (l, current_date - 2, 'showing',    'Ravi Menon', 'hot',  'Writing an offer tonight.');
    elsif t.status = 'under_offer' then
      insert into public.listing_tasks (listing_id, name, due_date, completed, sort_order)
      values (l, 'Accepted offer: send to title', current_date + 1, false, 99);
      insert into public.listing_dates (listing_id, label, due_date) values (l, 'Option period ends', current_date + 4);
      insert into public.listing_offers (listing_id, buyer_name, buyer_agent, offer_price, terms, status, received_on) values
        (l, 'C. Hoffman', 'Lila Grant', round(t.price * 0.99), 'FHA, 35-day close, seller pays $5,000 closing costs.', 'accepted', current_date - 5);
    end if;
  end loop;

  -- ---------- contacts: Abdiaziz's book (the vendor ones are shared with the team) ----------
  insert into public.contacts (tc_user_id, name, email, phone, company, role, tags, source, team_id, shared_at, created_at, updated_at)
  select u0, v.name, lower(replace(v.name, ' ', '.')) || '@example.com', '(512) 555-' || lpad((6000 + row_number() over ())::text, 4, '0'),
         v.company, v.role, array[v.tag], v.src,
         case when v.shared then tm end, case when v.shared then now() - (v.days || ' days')::interval end,
         now() - (v.days || ' days')::interval, now() - (v.days || ' days')::interval
  from (values
    ('Hannah Reyes',     'Northshore Title',          'Title / escrow', 'Title',     'manual', true,  160),
    ('Marcus Doyle',     'Capital Title Group',       'Title / escrow', 'Title',     'manual', true,  150),
    ('Elise Navarro',    'Lone Star Escrow',          'Escrow officer', 'Title',     'manual', true,  120),
    ('Priscilla Tran',   'Hill Country Title',        'Title / escrow', 'Title',     'import', true,   95),
    ('Colin Brooks',     'First Harbor Lending',      'Loan officer',   'Lender',    'manual', true,  170),
    ('Dana Whitaker',    'Austin Home Loans',         'Loan officer',   'Lender',    'manual', true,  140),
    ('Rafael Ortega',    'Texas Mortgage Partners',   'Loan officer',   'Lender',    'import', true,   80),
    ('Kim Nguyen',       'Summit Credit Union',       'Mortgage lender','Lender',    'manual', true,   33),
    ('Tamara Singh',     'Pillar Inspections',        'Inspector',      'Inspector', 'manual', true,  165),
    ('Wes Callahan',     'Bluebonnet Home Inspections','Inspector',     'Inspector', 'manual', true,  110),
    ('Jorge Mendez',     'Longhorn Inspect',          'Inspector',      'Inspector', 'import', false,  60),
    ('Gabe Lindqvist',   'Lindqvist Appraisal',       'Appraiser',      'Appraiser', 'manual', true,  155),
    ('Sofia Reed',       'Reed Valuation',            'Appraiser',      'Appraiser', 'manual', false,  72),
    ('Lawrence Ford',    'Ford Real Estate Law',      'Attorney',       'Attorney',  'manual', false, 130),
    ('Brenda Cole',      'Alamo Insurance',           'Insurance agent','Insurance', 'manual', false, 100),
    ('Tyrell Banks',     'Hearth Home Insurance',     'Insurance agent','Insurance', 'import', false,  45),
    ('Pam Ellison',      'Westlake Hills HOA',        'HOA manager',    'HOA',       'manual', false,  88),
    ('Mike Duarte',      'Duarte Roofing',            'Vendor',         'Vendor',    'manual', false,  70),
    ('Carla Iverson',    'Iverson Staging',           'Stager',         'Vendor',    'manual', false,  52),
    ('Pete Anders',      'Anders Photography',        'Photographer',   'Vendor',    'manual', false,  40),
    ('Luis Romero',      'Romero Plumbing',           'Vendor',         'Vendor',    'import', false,  26),
    ('Joy Kim',          'Austin Movers',             'Vendor',         'Vendor',    'manual', false,  18),
    ('Dana Cole',        'Cole & Co. Realty',         'Agent',          'Agent',     'deals',  false,  35),
    ('Ravi Menon',       'Menon Realty Group',        'Agent',          'Agent',     'deals',  false,  30),
    ('Lila Grant',       'Grant Home Partners',       'Agent',          'Agent',     'deals',  false,  24),
    ('Miguel Castillo',  'Castillo Realty',           'Agent',          'Agent',     'deals',  false,  12),
    ('Jordan Shah',      null,                        'Seller',         'Seller',    'manual', false,  14),
    ('Elena Rossi',      null,                        'Seller',         'Seller',    'manual', false,  10),
    ('Walter Bishop',    null,                        'Seller',         'Seller',    'manual', false,   9),
    ('Aisha Rahman',     null,                        'Buyer',          'Buyer',     'manual', false,   6),
    ('Tom Becker',       null,                        'Buyer',          'Buyer',     'manual', false,   4),
    ('Lauren Okafor',    null,                        'Buyer',          'Buyer',     'manual', false,   2),
    ('Victor Murphy',    null,                        'Buyer',          'Buyer',     'manual', false,   1)
  ) as v(name, company, role, tag, src, shared, days);

  -- Maya's and Jordan's own contacts
  insert into public.contacts (tc_user_id, name, email, phone, company, role, tags, source, created_at, updated_at)
  select case v.tc when 1 then u1 else u2 end, v.name, lower(replace(v.name, ' ', '.')) || '.' || v.tc || '@example.com',
         '(512) 555-' || lpad((7000 + row_number() over ())::text, 4, '0'), v.company, v.role, array[v.tag], 'manual',
         now() - (v.days || ' days')::interval, now() - (v.days || ' days')::interval
  from (values
    (1, 'Isabel Flores',  'Domain Title',        'Title / escrow', 'Title',     60), (1, 'Noah Greene',  'Greene Home Inspection', 'Inspector', 'Inspector', 44),
    (1, 'Chloe Barrett',  'Central Texas Lending','Loan officer',  'Lender',    38), (1, 'Andre Walker', null,                  'Buyer',   'Buyer',     7),
    (1, 'Grace Whitman',  null,                  'Seller',         'Seller',    6),  (1, 'Fiona Maddox', 'Maddox Appraisal',   'Appraiser','Appraiser', 51),
    (2, 'Leo Fernandez',  'Eastside Title',      'Title / escrow', 'Title',     66), (2, 'Hazel Ortiz',  'Ortiz Inspections',   'Inspector','Inspector', 41),
    (2, 'Sean Gallagher', 'Bee Cave Mortgage',   'Loan officer',   'Lender',    35), (2, 'Mia Thornton', null,                  'Buyer',   'Buyer',     5),
    (2, 'Richard Osei',   null,                  'Seller',         'Seller',    12), (2, 'Yusuf Demir',  'Demir Roofing',       'Vendor',  'Vendor',    28)
  ) as v(tc, name, company, role, tag, days);

  -- ---------- team chat ----------
  insert into public.team_messages (team_id, sender_id, recipient_id, body, created_at) values
    (tm, u0, null, 'Morning team. Closings this week: Windmill Court (Wed) and Barton Hills (Thu). Clear to close checks by end of day Monday please.', now() - interval '3 days 5 hours'),
    (tm, u1, null, 'Barton Hills: title commitment is in, lender says final numbers tomorrow morning.', now() - interval '3 days 3 hours'),
    (tm, u2, null, 'Spyglass Lane is waiting on title for the survey. I escalated this morning.', now() - interval '2 days 22 hours'),
    (tm, u0, null, 'Thanks both. Reminder: every new deal gets the Baseline checklist unless I say otherwise.', now() - interval '2 days 20 hours'),
    (tm, u1, u0,   'Can you take the Skyline Terrace appraisal follow-up? I am out for inspections all day Thursday.', now() - interval '2 days 6 hours'),
    (tm, u0, u1,   'Yes, send me the appraiser contact and I will chase it. Enjoy the inspections.', now() - interval '2 days 5 hours'),
    (tm, u2, u0,   'Two new contracts came in overnight. Want me to take both or hand one to Maya?', now() - interval '1 day 8 hours'),
    (tm, u0, u2,   'Take the Leander one, Maya has the Pflugerville one. Set up files before noon.', now() - interval '1 day 7 hours'),
    (tm, u0, null, 'Heads up: Hearth Home Insurance is our new go-to for quick quotes. Added to the shared contacts.', now() - interval '1 day 2 hours'),
    (tm, u1, null, 'Nice, used them for Sundance Way and the quote was back in an hour.', now() - interval '23 hours'),
    (tm, u2, null, 'Meadow Brook Lane option period ends tomorrow, inspection is clean. Agent is happy.', now() - interval '9 hours'),
    (tm, u0, null, 'Great work this month. Revenue is on track and nothing is overdue past two days. Keep it up.', now() - interval '2 hours');

end $$;

notify pgrst, 'reload schema';

-- Check: what the three accounts now hold
select u.email,
       (select count(*) from public.transactions t where t.tc_user_id = u.id and t.status <> 'Closed') as open_deals,
       (select count(*) from public.transactions t where t.tc_user_id = u.id and t.status = 'Closed')  as closed_deals,
       (select count(*) from public.listings l where l.tc_user_id = u.id)                               as listings,
       (select count(*) from public.contacts c where c.tc_user_id = u.id)                               as contacts,
       (select count(*) from public.agents a where a.tc_user_id = u.id)                                 as agents
from auth.users u
where lower(u.email) in ('abdiaziz.a.abdalla@gmail.com', 'aabdiaziz47@gmail.com', 'aaa7420023@gmail.com')
order by u.email;
