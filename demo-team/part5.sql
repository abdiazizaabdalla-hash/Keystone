-- PART 5 of 6: the 7 listings with checklists, offers and showings. Run after part 4.
do $$
declare
  u0 uuid; u1 uuid; u2 uuid; tm uuid; uid uuid;
  t record; d record; l uuid; ag uuid; k int := 0; n int;
begin
  select id into u0 from auth.users where lower(email) = 'abdiaziz.a.abdalla@gmail.com';
  select id into u1 from auth.users where lower(email) = 'aabdiaziz47@gmail.com';
  select id into u2 from auth.users where lower(email) = 'aaa7420023@gmail.com';
  if u0 is null or u1 is null or u2 is null then
    raise exception 'One of the three accounts does not exist yet.';
  end if;
  select team_id into tm from public.team_members where user_id = u0 limit 1;
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

end $$;
