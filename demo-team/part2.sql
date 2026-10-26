-- PART 2 of 6: Abdiaziz's open and closed deals (checklists, critical dates, deal contacts, invoices). Run after part 1.
do $$
declare
  u0 uuid; u1 uuid; u2 uuid; tm uuid; uid uuid;
  has_waiting boolean;
  steps text[] := array['Contract & File Setup','Earnest Money & Option','Inspection & Repairs','Title, Appraisal & Financing','Clear to Close','Closing & Post-Closing'];
  stages text[] := array['Contract Pending','Contract & File Setup','Earnest Money & Option','Inspection & Repairs','Title, Appraisal & Financing','Clear to Close','Closed'];
  firsts text[] := array['Priya','Daniel','Maria','Chris','Aisha','Tom','Lauren','Victor','Grace','Omar','Elena','Ben'];
  lasts  text[] := array['Patel','Nguyen','Alvarez','Thompson','Rahman','Becker','Okafor','Murphy','Silva','Khan','Rossi','Hart'];
  lenders text[] := array['Colin Brooks','Dana Whitaker','Rafael Ortega','Kim Nguyen'];
  titles  text[] := array['Hannah Reyes','Marcus Doyle','Elise Navarro','Priscilla Tran'];
  t record; tx uuid; ag uuid;
  k int := 0; n int; c int; a int; amt numeric;
begin
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'waiting_on') and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'waiting_on_since') into has_waiting;
  select id into u0 from auth.users where lower(email) = 'abdiaziz.a.abdalla@gmail.com';
  select id into u1 from auth.users where lower(email) = 'aabdiaziz47@gmail.com';
  select id into u2 from auth.users where lower(email) = 'aaa7420023@gmail.com';
  if u0 is null or u1 is null or u2 is null then
    raise exception 'One of the three accounts does not exist yet.';
  end if;
  select team_id into tm from public.team_members where user_id = u0 limit 1;
  for t in
    select * from (values
      ('2026-2101', 0, 'Lena Park',     '2218 Magnolia Ridge Lane, Austin, TX 78704',        412000,  -9, 2, 32, null,            0, null),
      ('2026-2102', 0, 'Marcus Bell',   '905 Harbor View Court, Austin, TX 78746',           689900, -21, 3, 35, 'Lender',        0, null),
      ('2026-2103', 0, 'Ana Ortiz',     '41 Cedar Hollow Road, Cedar Park, TX 78613',        355000,  -3, 1, 30, null,            0, null),
      ('2026-2104', 0, 'Sam Whitfield', '77 Lakeside Avenue, Lakeway, TX 78734',             514000, -26, 4, 33, 'Title company', 0, null),
      ('2026-2105', 0, 'Lena Park',     '1630 Pine Ridge Drive, Round Rock, TX 78664',       298500,   0, 0, 34, null,            0, null),
      ('2026-2106', 0, 'Priya Nair',    '33 Orchard Lane, Georgetown, TX 78628',             447000,  -1, 1, 31, null,            0, null),
      ('2026-2107', 0, 'Devon Hayes',   '4107 Juniper Bend, Austin, TX 78745',               389000, -17, 2, 28, null,            0, null),
      ('2026-2108', 0, 'Ana Ortiz',     '12 Windmill Court, Cedar Park, TX 78613',           560000, -30, 5, 32, null,            1, null),
      ('2026-2109', 0, 'Marcus Bell',   '600 Congress Ave Unit 1204, Austin, TX 78701',      725000, -12, 2, 40, 'Buyer',         0, null),
      ('2026-2001', 0, 'Sam Whitfield', '1405 Westbank Drive, West Lake Hills, TX 78746',    950000, -78, 6, 33, null,            0, 4),
      ('2026-2002', 0, 'Marcus Bell',   '512 Bayview Terrace, Austin, TX 78731',             603000, -64, 6, 32, null,            0, 6),
      ('2026-2003', 0, 'Priya Nair',    '2611 Sunset Ridge, Georgetown, TX 78628',           421000, -96, 6, 34, null,            0, 5),
      ('2026-2004', 0, 'Lena Park',     '17 Arbor Glen, Round Rock, TX 78681',               335000,-115, 6, 31, null,            0, 8),
      ('2026-2005', 0, 'Devon Hayes',   '3350 Rollingwood Drive, Austin, TX 78746',          780000, -52, 6, 30, null,            0, 7),
      ('2026-2006', 0, 'Ana Ortiz',     '66 Quail Hollow, Cedar Park, TX 78613',             391000, -45, 6, 33, null,            0, null)
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
      insert into public.tasks (transaction_id, name, completed, sort_order, due_date)
      values (tx, steps[n], n <= t.done, n - 1,
        current_date + case n when 1 then a + 2 when 2 then a + 3 when 3 then a + 12 when 4 then least(a + 25, c - 5) when 5 then c - 3 else c end);
    end loop;
    if has_waiting and t.waiting is not null then
      execute 'update public.tasks set waiting_on = $1, waiting_on_since = $2 where transaction_id = $3 and sort_order = $4'
        using t.waiting, current_date - (2 + k % 5), tx, t.done;
    end if;

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

end $$;
