-- PART 1 of 6: team, the two team members, clears the three accounts' old data, creates the agents and the team chat. RUN THIS FIRST.
-- WARNING: permanently deletes the deals, listings, invoices, contacts and agents of abdiaziz.a.abdalla, aabdiaziz47 and aaa7420023.
do $$
declare
  u0 uuid; u1 uuid; u2 uuid; tm uuid; uid uuid;
  has_agent_team boolean; has_team_name boolean;
begin
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agents' and column_name = 'team_id') into has_agent_team;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'teams' and column_name = 'name') into has_team_name;
  select id into u0 from auth.users where lower(email) = 'abdiaziz.a.abdalla@gmail.com';
  select id into u1 from auth.users where lower(email) = 'aabdiaziz47@gmail.com';
  select id into u2 from auth.users where lower(email) = 'aaa7420023@gmail.com';
  if u0 is null or u1 is null or u2 is null then
    raise exception 'One of the three accounts does not exist yet.';
  end if;
  -- ---------- the team ----------
  select team_id into tm from public.team_members where user_id = u0 limit 1;
  if tm is null then
    insert into public.teams (owner_id) values (u0) returning id into tm;
    insert into public.team_members (team_id, user_id, role) values (tm, u0, 'owner');
  end if;
  if has_team_name then update public.teams set name = 'Lone Star Closing Team' where id = tm; end if;
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
  insert into public.agents (tc_user_id, name, brokerage, commission_percent, email, phone)
  select case v.tc when 0 then u0 when 1 then u1 else u2 end, v.name, v.brk, 0,
         lower(replace(v.name, ' ', '.')) || '@example.com', '(512) 555-' || lpad((1100 + row_number() over ())::text, 4, '0')
  from (values
    (0, 'Lena Park',     'Capital City Realty'),   (0, 'Marcus Bell',   'Lakeline Properties'),   (0, 'Ana Ortiz',     'Hill Country Homes'),
    (0, 'Sam Whitfield', 'Lakeway Luxury Group'),  (0, 'Priya Nair',    'Georgetown Home Co.'),   (0, 'Devon Hayes',   'Barton Springs Realty'),
    (1, 'Rosa Delgado',  'South Congress Group'),  (1, 'Tyler Brooks',  'Pflugerville Realty'),   (1, 'Nina Kapoor',   'Domain Residential'),
    (1, 'Caleb Moore',   'Oak Hill Brokers'),
    (2, 'Hana Sato',     'Mueller Realty Partners'), (2, 'Eric Lindgren', 'Bee Cave Properties'),  (2, 'Tasha Williams','East Austin Homes'),
    (2, 'Omar Haddad',   'Leander Home Group')
  ) as v(tc, name, brk);
  if has_agent_team then execute 'update public.agents set team_id = $1 where tc_user_id in ($2, $3, $4)' using tm, u0, u1, u2; end if;


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
