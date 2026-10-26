-- PART 4 of 6: Jordan Reyes's open and closed deals (checklists, critical dates, deal contacts, invoices). Run after part 3.
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
  k int := 28; n int; c int; a int; amt numeric;
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
      ('2026-2118', 2, 'Eric Lindgren', '27 Meadow Brook Lane, Bee Cave, TX 78738',          705000, -11, 2, 38, null,            0, null),
      ('2026-2119', 2, 'Hana Sato',     '3815 Mueller Blvd Unit 310, Austin, TX 78723',      398000,  -4, 1, 33, null,            0, null),
      ('2026-2120', 2, 'Eric Lindgren', '602 Spyglass Lane, Austin, TX 78746',              1180000, -24, 4, 37, 'Title company', 0, null),
      ('2026-2121', 2, 'Tasha Williams','1812 E 12th Street, Austin, TX 78702',              455000, -16, 2, 34, null,            0, null),
      ('2026-2122', 2, 'Omar Haddad',   '90 Prairie Wind Drive, Leander, TX 78641',          349000,  -7, 2, 32, null,            0, null),
      ('2026-2123', 2, 'Hana Sato',     '540 Bellmont Ridge, Austin, TX 78702',              512000,  -1, 0, 35, null,            0, null),
      ('2026-2124', 2, 'Omar Haddad',   '2205 Hilltop Court, Leander, TX 78641',             318000, -22, 3, 30, 'Lender',        0, null),
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
