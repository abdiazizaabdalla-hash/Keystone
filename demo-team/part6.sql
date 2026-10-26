-- PART 6 of 6: contacts (Abdiaziz, Maya and Jordan). Run last; the table at the end is the check.
do $$
declare
  u0 uuid; u1 uuid; u2 uuid; tm uuid; uid uuid;
  has_contact_team boolean;
begin
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contacts' and column_name = 'team_id') and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contacts' and column_name = 'shared_at') into has_contact_team;
  select id into u0 from auth.users where lower(email) = 'abdiaziz.a.abdalla@gmail.com';
  select id into u1 from auth.users where lower(email) = 'aabdiaziz47@gmail.com';
  select id into u2 from auth.users where lower(email) = 'aaa7420023@gmail.com';
  if u0 is null or u1 is null or u2 is null then
    raise exception 'One of the three accounts does not exist yet.';
  end if;
  select team_id into tm from public.team_members where user_id = u0 limit 1;
  -- ---------- contacts: Abdiaziz's book (the vendor ones are shared with the team) ----------
  insert into public.contacts (tc_user_id, name, email, phone, company, role, tags, source, created_at, updated_at)
  select u0, v.name, lower(replace(v.name, ' ', '.')) || '@example.com', '(512) 555-' || lpad((6000 + row_number() over ())::text, 4, '0'),
         v.company, v.role, array[v.tag], v.src,
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
  -- the vendor contacts marked true above are shared with the team
  if has_contact_team then
    execute 'update public.contacts set team_id = $1, shared_at = created_at where tc_user_id = $2 and name = any($3)'
      using tm, u0, array['Hannah Reyes','Marcus Doyle','Elise Navarro','Priscilla Tran','Colin Brooks','Dana Whitaker','Rafael Ortega','Kim Nguyen','Tamara Singh','Wes Callahan','Gabe Lindqvist'];
  end if;

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

end $$;

notify pgrst, 'reload schema';

select u.email,
       (select count(*) from public.transactions t where t.tc_user_id = u.id and t.status <> 'Closed') as open_deals,
       (select count(*) from public.transactions t where t.tc_user_id = u.id and t.status = 'Closed')  as closed_deals,
       (select count(*) from public.listings l where l.tc_user_id = u.id)                               as listings,
       (select count(*) from public.contacts c where c.tc_user_id = u.id)                               as contacts,
       (select count(*) from public.agents a where a.tc_user_id = u.id)                                 as agents
from auth.users u
where lower(u.email) in ('abdiaziz.a.abdalla@gmail.com', 'aabdiaziz47@gmail.com', 'aaa7420023@gmail.com')
order by u.email;
