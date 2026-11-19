-- Relay TC database schema snapshot (schema only, no data).
-- Generated 2026-11-02 from the production (keystone) schema. Use it to rebuild the relay-test
-- project or to diff against production. The three open "Allow service_role full access"
-- policies on tasks, invoices and transactions were dropped in production on 2026-11-02 and are
-- left out here. To refresh: regenerate with the schema generator query, then replace this file.
-- Tables with row-level security enabled: all of them; client roles have no table grants, so all
-- authorization is enforced in application code (see src/lib/authorize.ts).

set check_function_bodies = false;

create extension if not exists "uuid-ossp" with schema extensions;

create extension if not exists pgcrypto with schema extensions;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_id_by_email(lookup_email text)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select id from auth.users where lower(email) = lower(lookup_email) limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.check_rate_limit(p_key text, p_max integer, p_window_seconds integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare
  v_count integer;
  v_window_start timestamptz;
begin
  insert into rate_limits (key, count, window_start)
  values (p_key, 1, now())
  on conflict (key) do update
    set
      count = case
        when rate_limits.window_start <= now() - (p_window_seconds || ' seconds')::interval
          then 1
        else rate_limits.count + 1
      end,
      window_start = case
        when rate_limits.window_start <= now() - (p_window_seconds || ' seconds')::interval
          then now()
        else rate_limits.window_start
      end
  returning count, window_start into v_count, v_window_start;

  return v_count <= p_max;
end;
$function$
;

create table public.users (
  id uuid default gen_random_uuid() not null,
  email character varying(255) not null,
  name character varying(255) not null,
  role character varying(50) not null,
  password_hash character varying(255),
  created_at timestamp without time zone default CURRENT_TIMESTAMP
);

create table public.transactions (
  id uuid default gen_random_uuid() not null,
  agent_id uuid not null,
  file_number character varying(255) not null,
  property_address character varying(500),
  purchase_price numeric(12,2),
  status character varying(100) default 'Contract Pending'::character varying,
  created_at timestamp without time zone default CURRENT_TIMESTAMP,
  updated_at timestamp without time zone default CURRENT_TIMESTAMP,
  checklist_template_name text,
  acceptance_date date,
  closing_date date,
  inbound_token text not null,
  search_vector tsvector generated always as (to_tsvector('english'::regconfig, (((COALESCE(file_number, ''::character varying))::text || ' '::text) || (COALESCE(property_address, ''::character varying))::text))) stored,
  tc_user_id uuid,
  source text,
  client_share_new_documents boolean default false not null
);

create table public.tasks (
  id uuid default gen_random_uuid() not null,
  transaction_id uuid not null,
  name character varying(255) not null,
  completed boolean default false,
  created_at timestamp without time zone default CURRENT_TIMESTAMP,
  sort_order integer default 0 not null,
  due_date date,
  google_event_id text,
  due_days_after_acceptance integer,
  due_date_spec jsonb,
  waiting_on text,
  waiting_on_since date,
  search_vector tsvector generated always as (to_tsvector('english'::regconfig, (((COALESCE(name, ''::character varying))::text || ' '::text) || COALESCE(waiting_on, ''::text)))) stored,
  client_visible boolean default false not null
);

create table public.invoices (
  id uuid default gen_random_uuid() not null,
  agent_id uuid not null,
  transaction_id uuid not null,
  amount_owed numeric(12,2) not null,
  invoice_number character varying(100) not null,
  invoice_date timestamp without time zone default CURRENT_TIMESTAMP,
  due_date date not null,
  paid boolean default false,
  paid_at timestamp without time zone,
  paid_amount numeric(12,2),
  created_at timestamp without time zone default CURRENT_TIMESTAMP,
  updated_at timestamp without time zone default CURRENT_TIMESTAMP,
  sent_at timestamp without time zone,
  sent_to character varying(255),
  helcim_pay_url text,
  helcim_invoice_number text,
  refunded boolean default false,
  refunded_at timestamp without time zone,
  refunded_amount numeric(12,2),
  qb_invoice_id text,
  qb_payment_id text,
  qb_sync_status text,
  qb_sync_error text,
  qb_synced_at timestamp with time zone
);

create table public.agents (
  id uuid default gen_random_uuid() not null,
  tc_user_id uuid,
  name text not null,
  brokerage text,
  email text,
  phone text,
  flat_fee numeric(12,2) default 400,
  commission_percent numeric(5,2) default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  payment_method text default 'default'::text not null,
  zelle_contact text,
  zelle_display_name text,
  notify_on_task_complete boolean default false not null,
  brokerage_agent_id uuid,
  source text
);

create table public.documents (
  id uuid default gen_random_uuid() not null,
  transaction_id uuid not null,
  task_id uuid,
  file_name text not null,
  storage_path text not null,
  content_type text,
  file_size bigint,
  uploaded_by uuid,
  created_at timestamp with time zone default now() not null,
  category text,
  document_type text,
  is_signed boolean default false not null,
  requires_signature boolean default true not null,
  source text default 'upload'::text not null,
  source_email_id uuid,
  search_vector tsvector generated always as (to_tsvector('english'::regconfig, ((((COALESCE(file_name, ''::text) || ' '::text) || COALESCE(document_type, ''::text)) || ' '::text) || COALESCE(category, ''::text)))) stored,
  client_visible boolean default false not null
);

create table public.stripe_customers (
  user_id uuid not null,
  stripe_customer_id text not null,
  stripe_subscription_id text,
  plan text,
  subscription_status text,
  current_period_end timestamp with time zone,
  updated_at timestamp with time zone default now()
);

create table public.teams (
  id uuid default gen_random_uuid() not null,
  owner_id uuid not null,
  name text default 'My Team'::text not null,
  created_at timestamp with time zone default now() not null,
  default_checklist_template_id uuid
);

create table public.team_members (
  team_id uuid not null,
  user_id uuid not null,
  role text default 'member'::text not null,
  joined_at timestamp with time zone default now() not null
);

create table public.team_invites (
  id uuid default gen_random_uuid() not null,
  team_id uuid not null,
  email text not null,
  invited_by uuid not null,
  status text default 'pending'::text not null,
  created_at timestamp with time zone default now() not null
);

create table public.payment_accounts (
  id uuid default gen_random_uuid() not null,
  tc_user_id uuid not null,
  provider text default 'helcim'::text not null,
  connected_account_id text not null,
  api_token text,
  dba_subdomain text,
  status text default 'pending'::text not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table public.checklist_templates (
  id uuid default gen_random_uuid() not null,
  tc_user_id uuid not null,
  name text not null,
  steps jsonb not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  team_id uuid
);

create table public.calendar_connections (
  id uuid default gen_random_uuid() not null,
  tc_user_id uuid not null,
  provider text default 'google'::text not null,
  refresh_token text not null,
  google_email text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  last_synced_at timestamp with time zone,
  login_email text
);

create table public.signing_requests (
  id uuid default gen_random_uuid() not null,
  transaction_id uuid,
  document_id uuid,
  requested_by uuid not null,
  signer_name text not null,
  signer_email text not null,
  source_storage_path text not null,
  source_file_name text not null,
  document_hash text not null,
  signed_storage_path text,
  signed_document_id uuid,
  token text not null,
  status text default 'pending'::text not null,
  signature_type text,
  signed_at timestamp with time zone,
  signer_ip text,
  signer_user_agent text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  expires_at timestamp with time zone,
  voided_at timestamp with time zone,
  declined_at timestamp with time zone,
  decline_reason text,
  distribute_to jsonb default '[]'::jsonb not null,
  distribute_subject text,
  distribute_message text,
  distributed_at timestamp with time zone,
  distribution_error text,
  fields jsonb,
  group_id uuid,
  signing_order integer default 1 not null,
  awaiting_turn boolean default false not null,
  listing_id uuid,
  listing_document_id uuid,
  signed_listing_document_id uuid
);

create table public.transaction_contacts (
  id uuid default gen_random_uuid() not null,
  transaction_id uuid not null,
  role character varying(255),
  email character varying(255),
  phone character varying(20),
  "position" integer default 0 not null,
  created_at timestamp without time zone default CURRENT_TIMESTAMP,
  name character varying(255)
);

create table public.rate_limits (
  key text not null,
  count integer default 1 not null,
  window_start timestamp with time zone default now() not null
);

create table public.transaction_agents (
  id uuid default gen_random_uuid() not null,
  transaction_id uuid not null,
  agent_user_id uuid not null,
  invited_by uuid not null,
  created_at timestamp without time zone default CURRENT_TIMESTAMP,
  notice_seen boolean default false not null
);

create table public.agent_invites (
  id uuid default gen_random_uuid() not null,
  transaction_id uuid not null,
  email character varying(255) not null,
  invited_by uuid not null,
  status character varying(20) default 'pending'::character varying not null,
  created_at timestamp without time zone default CURRENT_TIMESTAMP,
  accepted_at timestamp without time zone
);

create table public.messages (
  id uuid default gen_random_uuid() not null,
  transaction_id uuid not null,
  sender_id uuid not null,
  sender_role character varying(10) not null,
  body text not null,
  created_at timestamp without time zone default CURRENT_TIMESTAMP,
  attachment_document_id uuid,
  search_vector tsvector generated always as (to_tsvector('english'::regconfig, COALESCE(body, ''::text))) stored
);

create table public.transaction_emails (
  id uuid default gen_random_uuid() not null,
  transaction_id uuid not null,
  resend_email_id text not null,
  from_email text not null,
  from_name text,
  to_email text not null,
  subject text,
  body_text text,
  body_html text,
  received_at timestamp with time zone not null,
  created_at timestamp with time zone default now() not null
);

create table public.external_access_links (
  id uuid default gen_random_uuid() not null,
  transaction_id uuid not null,
  created_by uuid not null,
  token text not null,
  scope text not null,
  document_id uuid,
  recipient_label text,
  expires_at timestamp with time zone not null,
  revoked_at timestamp with time zone,
  last_accessed_at timestamp with time zone,
  access_count integer default 0 not null,
  created_at timestamp with time zone default now(),
  client_name text,
  client_note text,
  client_email text
);

create table public.brokerage_agents (
  id uuid default gen_random_uuid() not null,
  team_id uuid not null,
  name text not null,
  email text,
  phone text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table public.team_messages (
  id uuid default gen_random_uuid() not null,
  team_id uuid not null,
  sender_id uuid not null,
  recipient_id uuid,
  body text not null,
  created_at timestamp with time zone default now() not null
);

create table public.team_message_reads (
  user_id uuid not null,
  team_id uuid not null,
  thread text not null,
  last_read_at timestamp with time zone not null
);

create table public.transaction_key_dates (
  id uuid default gen_random_uuid() not null,
  transaction_id uuid not null,
  kind text default 'custom'::text not null,
  label text not null,
  due_date date not null,
  completed boolean default false not null,
  source text default 'manual'::text not null,
  notify_agent boolean default false not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.key_date_calendar_events (
  id uuid default gen_random_uuid() not null,
  key_date_id uuid not null,
  user_id uuid not null,
  google_event_id text not null,
  created_at timestamp with time zone default now() not null
);

create table public.calendar_feed_tokens (
  user_id uuid not null,
  token text not null,
  created_at timestamp with time zone default now() not null
);

create table public.step_email_templates (
  id uuid default gen_random_uuid() not null,
  tc_user_id uuid not null,
  step_key text not null,
  subject text not null,
  body text not null,
  updated_at timestamp with time zone default now() not null,
  name text
);

create table public.contacts (
  id uuid default gen_random_uuid() not null,
  tc_user_id uuid not null,
  name text default ''::text not null,
  email text,
  phone text,
  company text,
  role text,
  notes text,
  tags text[] default '{}'::text[] not null,
  newsletter boolean default false not null,
  source text default 'manual'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  contact_type text default 'person'::text not null,
  organization_id uuid,
  agent_id uuid,
  team_id uuid,
  shared_at timestamp with time zone
);

create table public.listings (
  id uuid default gen_random_uuid() not null,
  tc_user_id uuid not null,
  agent_id uuid,
  property_address text not null,
  seller_name text,
  seller_email text,
  seller_phone text,
  list_price numeric,
  planned_list_date date,
  expiration_date date,
  mls_number text,
  mls_url text,
  status text default 'preparing'::text not null,
  notes text,
  converted_transaction_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  share_with_agent boolean default true not null,
  google_expiration_event_id text,
  listed_on date,
  notify_agent boolean default false not null,
  inbound_token text default (replace((gen_random_uuid())::text, '-'::text, ''::text) || substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 8)),
  docs_not_needed text[] default '{}'::text[] not null
);

create table public.listing_tasks (
  id uuid default gen_random_uuid() not null,
  listing_id uuid not null,
  name text not null,
  offset_days integer,
  due_date date,
  completed boolean default false not null,
  completed_at timestamp with time zone,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  google_event_id text
);

create table public.listing_offers (
  id uuid default gen_random_uuid() not null,
  listing_id uuid not null,
  buyer_name text,
  buyer_agent text,
  offer_price numeric,
  terms text,
  status text default 'received'::text not null,
  received_on date,
  created_at timestamp with time zone default now() not null,
  financing text,
  earnest_money numeric,
  option_days integer,
  closing_date date,
  seller_concessions numeric,
  offer_expires_at text,
  possession text,
  contingencies text,
  current_version integer default 1 not null
);

create table public.listing_contacts (
  id uuid default gen_random_uuid() not null,
  listing_id uuid not null,
  role text,
  name text,
  email text,
  phone text,
  "position" integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  added_by_agent boolean default false not null
);

create table public.listing_dates (
  id uuid default gen_random_uuid() not null,
  listing_id uuid not null,
  label text not null,
  due_date date not null,
  created_at timestamp with time zone default now() not null,
  google_event_id text
);

create table public.listing_template_steps (
  id uuid default gen_random_uuid() not null,
  tc_user_id uuid not null,
  name text not null,
  offset_days integer default 0 not null,
  sort_order integer default 0 not null,
  template_name text default 'Standard'::text not null
);

create table public.listing_documents (
  id uuid default gen_random_uuid() not null,
  listing_id uuid not null,
  file_name text not null,
  storage_path text not null,
  content_type text,
  file_size bigint,
  document_type text default 'General'::text not null,
  uploaded_by uuid,
  created_at timestamp with time zone default now() not null,
  is_signed boolean default false not null
);

create table public.listing_showings (
  id uuid default gen_random_uuid() not null,
  listing_id uuid not null,
  showing_date date not null,
  kind text default 'showing'::text not null,
  visitor text,
  interest text,
  feedback text,
  created_at timestamp with time zone default now() not null
);

create table public.listing_price_changes (
  id uuid default gen_random_uuid() not null,
  listing_id uuid not null,
  old_price numeric,
  new_price numeric not null,
  changed_on date default CURRENT_DATE not null,
  note text,
  created_at timestamp with time zone default now() not null
);

create table public.listing_activity (
  id uuid default gen_random_uuid() not null,
  listing_id uuid not null,
  actor_label text,
  summary text not null,
  created_at timestamp with time zone default now() not null
);

create table public.listing_offer_versions (
  id uuid default gen_random_uuid() not null,
  offer_id uuid not null,
  listing_id uuid not null,
  version_number integer not null,
  kind text default 'original'::text not null,
  label text,
  terms jsonb default '{}'::jsonb not null,
  summary text,
  created_by_label text,
  created_at timestamp with time zone default now() not null
);

create table public.listing_offer_documents (
  id uuid default gen_random_uuid() not null,
  offer_id uuid not null,
  listing_id uuid not null,
  version_id uuid,
  file_name text not null,
  storage_path text not null,
  content_type text,
  file_size bigint,
  doc_kind text default 'other'::text not null,
  received_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null
);

create table public.listing_inbound_offers (
  id uuid default gen_random_uuid() not null,
  listing_id uuid not null,
  resend_email_id text,
  from_email text,
  from_name text,
  subject text,
  snippet text,
  attachments jsonb default '[]'::jsonb not null,
  status text default 'pending'::text not null,
  received_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null
);

create table public.listing_comments (
  id uuid default gen_random_uuid() not null,
  listing_id uuid not null,
  author_user_id uuid not null,
  author_role text not null,
  author_label text,
  body text not null,
  created_at timestamp with time zone default now() not null,
  attachment_document_id uuid
);

create table public.listing_agent_calendar_events (
  id uuid default gen_random_uuid() not null,
  listing_id uuid not null,
  user_id uuid not null,
  item_key text not null,
  google_event_id text not null,
  created_at timestamp with time zone default now() not null
);

create table public.direct_messages (
  id uuid default gen_random_uuid() not null,
  tc_user_id uuid not null,
  agent_email text not null,
  sender_id uuid not null,
  sender_role text not null,
  body text not null,
  created_at timestamp with time zone default now() not null
);

create table public.calendar_preferences (
  user_id uuid not null,
  critical_dates boolean default true not null,
  closing_date boolean default true not null,
  deal_tasks boolean default true not null,
  listing_steps boolean default true not null,
  listing_dates boolean default true not null,
  updated_at timestamp with time zone default now() not null
);

create table public.quickbooks_connections (
  tc_user_id uuid not null,
  realm_id text not null,
  company_name text,
  environment text default 'production'::text not null,
  refresh_token text not null,
  access_token text,
  access_expires_at timestamp with time zone,
  status text default 'connected'::text not null,
  sync_invoices boolean default true not null,
  sync_payments boolean default true not null,
  item_id text,
  last_synced_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.quickbooks_customers (
  tc_user_id uuid not null,
  agent_id uuid not null,
  qb_customer_id text not null,
  created_at timestamp with time zone default now() not null
);

create table public.transaction_closing_events (
  id uuid default gen_random_uuid() not null,
  transaction_id uuid not null,
  user_id uuid not null,
  google_event_id text not null,
  created_at timestamp with time zone default now() not null
);

create table public.contact_activity (
  id uuid default gen_random_uuid() not null,
  contact_id uuid not null,
  tc_user_id uuid not null,
  kind text default 'note'::text not null,
  body text not null,
  occurred_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null
);

create table public.contact_reminders (
  id uuid default gen_random_uuid() not null,
  contact_id uuid not null,
  tc_user_id uuid not null,
  due_on date not null,
  note text,
  done_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table public.attention_dismissals (
  tc_user_id uuid not null,
  item_key text not null,
  dismissed_at timestamp with time zone default now() not null
);

create table public.notifications (
  id uuid default gen_random_uuid() not null,
  recipient_user_id uuid not null,
  actor_user_id uuid,
  transaction_id uuid,
  event_type text not null,
  title text not null,
  body text,
  link text,
  event_count integer default 1 not null,
  read_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table public.ai_usage (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  user_id uuid not null,
  feature text not null,
  model text,
  input_tokens integer default 0 not null,
  output_tokens integer default 0 not null
);

create table public.client_messages (
  id uuid default gen_random_uuid() not null,
  transaction_id uuid not null,
  link_id uuid,
  channel text not null,
  sender_type text not null,
  sender_user_id uuid,
  sender_name text,
  body text not null,
  created_at timestamp with time zone default now() not null
);

create table public.audit_log (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  actor_id uuid,
  actor_email text,
  action text not null,
  entity_type text,
  entity_id text,
  ip text,
  user_agent text,
  metadata jsonb default '{}'::jsonb not null
);

alter table public.users add constraint users_role_check CHECK (((role)::text = ANY ((ARRAY['TC'::character varying, 'Agent'::character varying])::text[])));

alter table public.users add constraint users_pkey PRIMARY KEY (id);

alter table public.users add constraint users_email_key UNIQUE (email);

alter table public.transactions add constraint transactions_pkey PRIMARY KEY (id);

alter table public.tasks add constraint tasks_pkey PRIMARY KEY (id);

alter table public.invoices add constraint invoices_pkey PRIMARY KEY (id);

alter table public.invoices add constraint invoices_invoice_number_key UNIQUE (invoice_number);

alter table public.agents add constraint agents_pkey PRIMARY KEY (id);

alter table public.documents add constraint documents_pkey PRIMARY KEY (id);

alter table public.stripe_customers add constraint stripe_customers_pkey PRIMARY KEY (user_id);

alter table public.stripe_customers add constraint stripe_customers_stripe_customer_id_key UNIQUE (stripe_customer_id);

alter table public.teams add constraint teams_pkey PRIMARY KEY (id);

alter table public.team_members add constraint team_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'member'::text])));

alter table public.team_members add constraint team_members_pkey PRIMARY KEY (team_id, user_id);

alter table public.team_members add constraint team_members_user_id_key UNIQUE (user_id);

alter table public.team_invites add constraint team_invites_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'revoked'::text])));

alter table public.team_invites add constraint team_invites_pkey PRIMARY KEY (id);

alter table public.team_invites add constraint team_invites_team_id_email_key UNIQUE (team_id, email);

alter table public.agents add constraint agents_payment_method_check CHECK ((payment_method = ANY (ARRAY['default'::text, 'zelle'::text, 'none'::text])));

alter table public.payment_accounts add constraint payment_accounts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text])));

alter table public.payment_accounts add constraint payment_accounts_pkey PRIMARY KEY (id);

alter table public.payment_accounts add constraint payment_accounts_tc_user_id_provider_key UNIQUE (tc_user_id, provider);

alter table public.checklist_templates add constraint checklist_templates_pkey PRIMARY KEY (id);

alter table public.calendar_connections add constraint calendar_connections_pkey PRIMARY KEY (id);

alter table public.calendar_connections add constraint calendar_connections_tc_user_id_provider_key UNIQUE (tc_user_id, provider);

alter table public.signing_requests add constraint signing_requests_signature_type_check CHECK ((signature_type = ANY (ARRAY['typed'::text, 'drawn'::text])));

alter table public.signing_requests add constraint signing_requests_pkey PRIMARY KEY (id);

alter table public.signing_requests add constraint signing_requests_token_key UNIQUE (token);

alter table public.signing_requests add constraint signing_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'signed'::text, 'voided'::text, 'declined'::text])));

alter table public.transaction_contacts add constraint transaction_contacts_pkey PRIMARY KEY (id);

alter table public.rate_limits add constraint rate_limits_pkey PRIMARY KEY (key);

alter table public.transaction_agents add constraint transaction_agents_pkey PRIMARY KEY (id);

alter table public.transaction_agents add constraint transaction_agents_transaction_id_agent_user_id_key UNIQUE (transaction_id, agent_user_id);

alter table public.agent_invites add constraint agent_invites_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'accepted'::character varying])::text[])));

alter table public.agent_invites add constraint agent_invites_pkey PRIMARY KEY (id);

alter table public.agent_invites add constraint agent_invites_transaction_id_email_key UNIQUE (transaction_id, email);

alter table public.messages add constraint messages_sender_role_check CHECK (((sender_role)::text = ANY ((ARRAY['tc'::character varying, 'agent'::character varying])::text[])));

alter table public.messages add constraint messages_pkey PRIMARY KEY (id);

alter table public.transactions add constraint transactions_inbound_token_key UNIQUE (inbound_token);

alter table public.transaction_emails add constraint transaction_emails_pkey PRIMARY KEY (id);

alter table public.transaction_emails add constraint transaction_emails_resend_email_id_key UNIQUE (resend_email_id);

alter table public.external_access_links add constraint external_access_links_pkey PRIMARY KEY (id);

alter table public.external_access_links add constraint external_access_links_token_key UNIQUE (token);

alter table public.brokerage_agents add constraint brokerage_agents_pkey PRIMARY KEY (id);

alter table public.team_messages add constraint team_messages_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 2000)));

alter table public.team_messages add constraint team_messages_not_self CHECK (((recipient_id IS NULL) OR (recipient_id <> sender_id)));

alter table public.team_messages add constraint team_messages_pkey PRIMARY KEY (id);

alter table public.team_message_reads add constraint team_message_reads_pkey PRIMARY KEY (user_id, team_id, thread);

alter table public.transaction_key_dates add constraint transaction_key_dates_label_check CHECK (((char_length(label) >= 1) AND (char_length(label) <= 100)));

alter table public.transaction_key_dates add constraint transaction_key_dates_pkey PRIMARY KEY (id);

alter table public.key_date_calendar_events add constraint key_date_calendar_events_pkey PRIMARY KEY (id);

alter table public.key_date_calendar_events add constraint key_date_calendar_events_key_date_id_user_id_key UNIQUE (key_date_id, user_id);

alter table public.calendar_feed_tokens add constraint calendar_feed_tokens_pkey PRIMARY KEY (user_id);

alter table public.calendar_feed_tokens add constraint calendar_feed_tokens_token_key UNIQUE (token);

alter table public.step_email_templates add constraint step_email_templates_subject_check CHECK (((char_length(subject) >= 1) AND (char_length(subject) <= 200)));

alter table public.step_email_templates add constraint step_email_templates_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 6000)));

alter table public.step_email_templates add constraint step_email_templates_pkey PRIMARY KEY (id);

alter table public.step_email_templates add constraint step_email_templates_tc_user_id_step_key_key UNIQUE (tc_user_id, step_key);

alter table public.contacts add constraint contacts_name_check CHECK ((char_length(name) <= 120));

alter table public.contacts add constraint contacts_email_check CHECK (((email IS NULL) OR (char_length(email) <= 254)));

alter table public.contacts add constraint contacts_phone_check CHECK (((phone IS NULL) OR (char_length(phone) <= 40)));

alter table public.contacts add constraint contacts_company_check CHECK (((company IS NULL) OR (char_length(company) <= 120)));

alter table public.contacts add constraint contacts_role_check CHECK (((role IS NULL) OR (char_length(role) <= 60)));

alter table public.contacts add constraint contacts_notes_check CHECK (((notes IS NULL) OR (char_length(notes) <= 2000)));

alter table public.contacts add constraint contacts_check CHECK (((name <> ''::text) OR (email IS NOT NULL)));

alter table public.contacts add constraint contacts_pkey PRIMARY KEY (id);

alter table public.listings add constraint listings_property_address_check CHECK (((char_length(property_address) >= 1) AND (char_length(property_address) <= 300)));

alter table public.listings add constraint listings_seller_name_check CHECK (((seller_name IS NULL) OR (char_length(seller_name) <= 200)));

alter table public.listings add constraint listings_seller_email_check CHECK (((seller_email IS NULL) OR (char_length(seller_email) <= 254)));

alter table public.listings add constraint listings_seller_phone_check CHECK (((seller_phone IS NULL) OR (char_length(seller_phone) <= 40)));

alter table public.listings add constraint listings_mls_number_check CHECK (((mls_number IS NULL) OR (char_length(mls_number) <= 60)));

alter table public.listings add constraint listings_mls_url_check CHECK (((mls_url IS NULL) OR (char_length(mls_url) <= 500)));

alter table public.listings add constraint listings_notes_check CHECK (((notes IS NULL) OR (char_length(notes) <= 4000)));

alter table public.listings add constraint listings_pkey PRIMARY KEY (id);

alter table public.listing_tasks add constraint listing_tasks_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 200)));

alter table public.listing_tasks add constraint listing_tasks_pkey PRIMARY KEY (id);

alter table public.listing_offers add constraint listing_offers_buyer_name_check CHECK (((buyer_name IS NULL) OR (char_length(buyer_name) <= 200)));

alter table public.listing_offers add constraint listing_offers_buyer_agent_check CHECK (((buyer_agent IS NULL) OR (char_length(buyer_agent) <= 200)));

alter table public.listing_offers add constraint listing_offers_terms_check CHECK (((terms IS NULL) OR (char_length(terms) <= 2000)));

alter table public.listing_offers add constraint listing_offers_pkey PRIMARY KEY (id);

alter table public.listing_contacts add constraint listing_contacts_role_check CHECK (((role IS NULL) OR (char_length(role) <= 60)));

alter table public.listing_contacts add constraint listing_contacts_name_check CHECK (((name IS NULL) OR (char_length(name) <= 200)));

alter table public.listing_contacts add constraint listing_contacts_email_check CHECK (((email IS NULL) OR (char_length(email) <= 254)));

alter table public.listing_contacts add constraint listing_contacts_phone_check CHECK (((phone IS NULL) OR (char_length(phone) <= 40)));

alter table public.listing_contacts add constraint listing_contacts_pkey PRIMARY KEY (id);

alter table public.listing_dates add constraint listing_dates_label_check CHECK (((char_length(label) >= 1) AND (char_length(label) <= 120)));

alter table public.listing_dates add constraint listing_dates_pkey PRIMARY KEY (id);

alter table public.listing_template_steps add constraint listing_template_steps_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 200)));

alter table public.listing_template_steps add constraint listing_template_steps_pkey PRIMARY KEY (id);

alter table public.listing_documents add constraint listing_documents_file_name_check CHECK (((char_length(file_name) >= 1) AND (char_length(file_name) <= 300)));

alter table public.listing_documents add constraint listing_documents_pkey PRIMARY KEY (id);

alter table public.listing_offers add constraint listing_offers_financing_check CHECK (((financing IS NULL) OR (char_length(financing) <= 60)));

alter table public.listing_showings add constraint listing_showings_visitor_check CHECK (((visitor IS NULL) OR (char_length(visitor) <= 200)));

alter table public.listing_showings add constraint listing_showings_feedback_check CHECK (((feedback IS NULL) OR (char_length(feedback) <= 2000)));

alter table public.listing_showings add constraint listing_showings_pkey PRIMARY KEY (id);

alter table public.listing_price_changes add constraint listing_price_changes_note_check CHECK (((note IS NULL) OR (char_length(note) <= 500)));

alter table public.listing_price_changes add constraint listing_price_changes_pkey PRIMARY KEY (id);

alter table public.listing_activity add constraint listing_activity_summary_check CHECK (((char_length(summary) >= 1) AND (char_length(summary) <= 500)));

alter table public.listing_activity add constraint listing_activity_pkey PRIMARY KEY (id);

alter table public.listing_offers add constraint listing_offers_offer_expires_at_check CHECK (((offer_expires_at IS NULL) OR (char_length(offer_expires_at) <= 80)));

alter table public.listing_offers add constraint listing_offers_possession_check CHECK (((possession IS NULL) OR (char_length(possession) <= 300)));

alter table public.listing_offers add constraint listing_offers_contingencies_check CHECK (((contingencies IS NULL) OR (char_length(contingencies) <= 2000)));

alter table public.listing_offer_versions add constraint listing_offer_versions_label_check CHECK (((label IS NULL) OR (char_length(label) <= 120)));

alter table public.listing_offer_versions add constraint listing_offer_versions_summary_check CHECK (((summary IS NULL) OR (char_length(summary) <= 1000)));

alter table public.listing_offer_versions add constraint listing_offer_versions_pkey PRIMARY KEY (id);

alter table public.listing_offer_versions add constraint listing_offer_versions_offer_id_version_number_key UNIQUE (offer_id, version_number);

alter table public.listing_offer_documents add constraint listing_offer_documents_file_name_check CHECK (((char_length(file_name) >= 1) AND (char_length(file_name) <= 300)));

alter table public.listing_offer_documents add constraint listing_offer_documents_pkey PRIMARY KEY (id);

alter table public.listing_inbound_offers add constraint listing_inbound_offers_subject_check CHECK (((subject IS NULL) OR (char_length(subject) <= 300)));

alter table public.listing_inbound_offers add constraint listing_inbound_offers_snippet_check CHECK (((snippet IS NULL) OR (char_length(snippet) <= 600)));

alter table public.listing_inbound_offers add constraint listing_inbound_offers_pkey PRIMARY KEY (id);

alter table public.listing_inbound_offers add constraint listing_inbound_offers_resend_email_id_key UNIQUE (resend_email_id);

alter table public.listing_comments add constraint listing_comments_author_role_check CHECK ((author_role = ANY (ARRAY['tc'::text, 'agent'::text])));

alter table public.listing_comments add constraint listing_comments_pkey PRIMARY KEY (id);

alter table public.listing_agent_calendar_events add constraint listing_agent_calendar_events_pkey PRIMARY KEY (id);

alter table public.listing_agent_calendar_events add constraint listing_agent_calendar_events_listing_id_user_id_item_key_key UNIQUE (listing_id, user_id, item_key);

alter table public.signing_requests add constraint signing_requests_target_chk CHECK (((transaction_id IS NOT NULL) OR (listing_id IS NOT NULL)));

alter table public.direct_messages add constraint direct_messages_sender_role_check CHECK ((sender_role = ANY (ARRAY['tc'::text, 'agent'::text])));

alter table public.direct_messages add constraint direct_messages_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 4000)));

alter table public.direct_messages add constraint direct_messages_pkey PRIMARY KEY (id);

alter table public.calendar_preferences add constraint calendar_preferences_pkey PRIMARY KEY (user_id);

alter table public.quickbooks_connections add constraint quickbooks_connections_environment_check CHECK ((environment = ANY (ARRAY['production'::text, 'sandbox'::text])));

alter table public.quickbooks_connections add constraint quickbooks_connections_status_check CHECK ((status = ANY (ARRAY['connected'::text, 'needs_reconnect'::text])));

alter table public.quickbooks_connections add constraint quickbooks_connections_pkey PRIMARY KEY (tc_user_id);

alter table public.quickbooks_customers add constraint quickbooks_customers_pkey PRIMARY KEY (tc_user_id, agent_id);

alter table public.transaction_closing_events add constraint transaction_closing_events_pkey PRIMARY KEY (id);

alter table public.transaction_closing_events add constraint transaction_closing_events_transaction_id_user_id_key UNIQUE (transaction_id, user_id);

alter table public.contacts add constraint contacts_type_check CHECK ((contact_type = ANY (ARRAY['person'::text, 'organization'::text])));

alter table public.contacts add constraint contacts_org_not_self CHECK (((organization_id IS NULL) OR (organization_id <> id)));

alter table public.contact_activity add constraint contact_activity_kind_check CHECK ((kind = ANY (ARRAY['note'::text, 'call'::text, 'email'::text, 'text'::text, 'meeting'::text, 'other'::text])));

alter table public.contact_activity add constraint contact_activity_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 4000)));

alter table public.contact_activity add constraint contact_activity_pkey PRIMARY KEY (id);

alter table public.contact_reminders add constraint contact_reminders_note_check CHECK (((note IS NULL) OR (char_length(note) <= 300)));

alter table public.contact_reminders add constraint contact_reminders_pkey PRIMARY KEY (id);

alter table public.attention_dismissals add constraint attention_dismissals_item_key_check CHECK (((char_length(item_key) >= 1) AND (char_length(item_key) <= 200)));

alter table public.attention_dismissals add constraint attention_dismissals_pkey PRIMARY KEY (tc_user_id, item_key);

alter table public.notifications add constraint notifications_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 200)));

alter table public.notifications add constraint notifications_pkey PRIMARY KEY (id);

alter table public.ai_usage add constraint ai_usage_pkey PRIMARY KEY (id);

alter table public.client_messages add constraint client_messages_channel_check CHECK ((channel = ANY (ARRAY['board'::text, 'agent'::text, 'tc'::text])));

alter table public.client_messages add constraint client_messages_sender_type_check CHECK ((sender_type = ANY (ARRAY['client'::text, 'agent'::text, 'tc'::text])));

alter table public.client_messages add constraint client_messages_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 4000)));

alter table public.client_messages add constraint client_messages_check CHECK (((channel = 'board'::text) OR (link_id IS NOT NULL)));

alter table public.client_messages add constraint client_messages_pkey PRIMARY KEY (id);

alter table public.external_access_links add constraint external_access_links_scope_check CHECK ((scope = ANY (ARRAY['document'::text, 'dates'::text, 'progress'::text])));

alter table public.listing_comments add constraint listing_comments_body_check CHECK ((char_length(body) <= 2000));

alter table public.audit_log add constraint audit_log_pkey PRIMARY KEY (id);

alter table public.tasks add constraint tasks_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;

alter table public.invoices add constraint invoices_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;

alter table public.agents add constraint agents_tc_user_id_fkey FOREIGN KEY (tc_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.stripe_customers add constraint stripe_customers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.teams add constraint teams_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.team_members add constraint team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;

alter table public.team_members add constraint team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.team_invites add constraint team_invites_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;

alter table public.team_invites add constraint team_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id);

alter table public.transaction_contacts add constraint transaction_contacts_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;

alter table public.transaction_agents add constraint transaction_agents_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;

alter table public.transaction_agents add constraint transaction_agents_agent_user_id_fkey FOREIGN KEY (agent_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.transaction_agents add constraint transaction_agents_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id);

alter table public.agent_invites add constraint agent_invites_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;

alter table public.agent_invites add constraint agent_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id);

alter table public.messages add constraint messages_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;

alter table public.messages add constraint messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id);

alter table public.messages add constraint messages_attachment_document_id_fkey FOREIGN KEY (attachment_document_id) REFERENCES documents(id) ON DELETE SET NULL;

alter table public.transaction_emails add constraint transaction_emails_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;

alter table public.documents add constraint documents_source_email_id_fkey FOREIGN KEY (source_email_id) REFERENCES transaction_emails(id) ON DELETE SET NULL;

alter table public.external_access_links add constraint external_access_links_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;

alter table public.checklist_templates add constraint checklist_templates_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;

alter table public.teams add constraint teams_default_checklist_template_id_fkey FOREIGN KEY (default_checklist_template_id) REFERENCES checklist_templates(id) ON DELETE SET NULL;

alter table public.brokerage_agents add constraint brokerage_agents_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;

alter table public.agents add constraint agents_brokerage_agent_id_fkey FOREIGN KEY (brokerage_agent_id) REFERENCES brokerage_agents(id) ON DELETE SET NULL;

alter table public.team_messages add constraint team_messages_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;

alter table public.team_messages add constraint team_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.team_messages add constraint team_messages_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.team_message_reads add constraint team_message_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.team_message_reads add constraint team_message_reads_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;

alter table public.transaction_key_dates add constraint transaction_key_dates_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;

alter table public.key_date_calendar_events add constraint key_date_calendar_events_key_date_id_fkey FOREIGN KEY (key_date_id) REFERENCES transaction_key_dates(id) ON DELETE CASCADE;

alter table public.listings add constraint listings_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL;

alter table public.listings add constraint listings_converted_transaction_id_fkey FOREIGN KEY (converted_transaction_id) REFERENCES transactions(id) ON DELETE SET NULL;

alter table public.listing_tasks add constraint listing_tasks_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;

alter table public.listing_offers add constraint listing_offers_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;

alter table public.listing_contacts add constraint listing_contacts_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;

alter table public.listing_dates add constraint listing_dates_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;

alter table public.listing_documents add constraint listing_documents_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;

alter table public.listing_showings add constraint listing_showings_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;

alter table public.listing_price_changes add constraint listing_price_changes_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;

alter table public.listing_activity add constraint listing_activity_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;

alter table public.listing_offer_versions add constraint listing_offer_versions_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES listing_offers(id) ON DELETE CASCADE;

alter table public.listing_offer_versions add constraint listing_offer_versions_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;

alter table public.listing_offer_documents add constraint listing_offer_documents_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES listing_offers(id) ON DELETE CASCADE;

alter table public.listing_offer_documents add constraint listing_offer_documents_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;

alter table public.listing_offer_documents add constraint listing_offer_documents_version_id_fkey FOREIGN KEY (version_id) REFERENCES listing_offer_versions(id) ON DELETE SET NULL;

alter table public.listing_inbound_offers add constraint listing_inbound_offers_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;

alter table public.listing_comments add constraint listing_comments_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;

alter table public.listing_agent_calendar_events add constraint listing_agent_calendar_events_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;

alter table public.signing_requests add constraint signing_requests_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;

alter table public.transaction_closing_events add constraint transaction_closing_events_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;

alter table public.contacts add constraint contacts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES contacts(id) ON DELETE SET NULL;

alter table public.contacts add constraint contacts_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL;

alter table public.contact_activity add constraint contact_activity_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE;

alter table public.contact_reminders add constraint contact_reminders_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE;

alter table public.contacts add constraint contacts_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;

alter table public.notifications add constraint notifications_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public.notifications add constraint notifications_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.notifications add constraint notifications_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;

alter table public.client_messages add constraint client_messages_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;

alter table public.client_messages add constraint client_messages_link_id_fkey FOREIGN KEY (link_id) REFERENCES external_access_links(id) ON DELETE CASCADE;

alter table public.client_messages add constraint client_messages_sender_user_id_fkey FOREIGN KEY (sender_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.listing_comments add constraint listing_comments_attachment_document_id_fkey FOREIGN KEY (attachment_document_id) REFERENCES listing_documents(id) ON DELETE SET NULL;

CREATE INDEX idx_transactions_agent_id ON public.transactions USING btree (agent_id);

CREATE INDEX idx_tasks_transaction_id ON public.tasks USING btree (transaction_id);

CREATE INDEX idx_invoices_agent_id ON public.invoices USING btree (agent_id);

CREATE INDEX idx_invoices_paid ON public.invoices USING btree (paid);

CREATE INDEX idx_agents_tc_user_id ON public.agents USING btree (tc_user_id);

CREATE INDEX documents_transaction_id_idx ON public.documents USING btree (transaction_id);

CREATE INDEX documents_task_id_idx ON public.documents USING btree (task_id);

CREATE INDEX idx_stripe_customers_customer_id ON public.stripe_customers USING btree (stripe_customer_id);

CREATE INDEX idx_stripe_customers_subscription_id ON public.stripe_customers USING btree (stripe_subscription_id);

CREATE INDEX idx_team_members_team_id ON public.team_members USING btree (team_id);

CREATE INDEX idx_team_invites_email ON public.team_invites USING btree (lower(email));

CREATE INDEX idx_payment_accounts_connected_account_id ON public.payment_accounts USING btree (connected_account_id);

CREATE INDEX idx_checklist_templates_tc_user_id ON public.checklist_templates USING btree (tc_user_id);

CREATE INDEX idx_calendar_connections_tc_user_id ON public.calendar_connections USING btree (tc_user_id);

CREATE INDEX idx_signing_requests_transaction_id ON public.signing_requests USING btree (transaction_id);

CREATE UNIQUE INDEX idx_signing_requests_token ON public.signing_requests USING btree (token);

CREATE INDEX idx_invoices_refunded ON public.invoices USING btree (refunded);

CREATE INDEX idx_transaction_contacts_transaction_id ON public.transaction_contacts USING btree (transaction_id);

CREATE INDEX idx_transaction_agents_transaction_id ON public.transaction_agents USING btree (transaction_id);

CREATE INDEX idx_transaction_agents_agent_user_id ON public.transaction_agents USING btree (agent_user_id);

CREATE INDEX idx_agent_invites_transaction_id ON public.agent_invites USING btree (transaction_id);

CREATE INDEX idx_agent_invites_email ON public.agent_invites USING btree (lower((email)::text));

CREATE INDEX idx_messages_transaction_id ON public.messages USING btree (transaction_id, created_at);

CREATE INDEX idx_messages_attachment_document_id ON public.messages USING btree (attachment_document_id);

CREATE INDEX transaction_emails_transaction_id_idx ON public.transaction_emails USING btree (transaction_id);

CREATE INDEX idx_messages_search ON public.messages USING gin (search_vector);

CREATE INDEX idx_documents_search ON public.documents USING gin (search_vector);

CREATE INDEX idx_tasks_search ON public.tasks USING gin (search_vector);

CREATE INDEX idx_transactions_search ON public.transactions USING gin (search_vector);

CREATE INDEX idx_external_access_links_transaction_id ON public.external_access_links USING btree (transaction_id);

CREATE UNIQUE INDEX idx_external_access_links_token ON public.external_access_links USING btree (token);

CREATE INDEX idx_transactions_tc_user_id ON public.transactions USING btree (tc_user_id);

CREATE INDEX idx_checklist_templates_team_id ON public.checklist_templates USING btree (team_id);

CREATE INDEX idx_brokerage_agents_team_id ON public.brokerage_agents USING btree (team_id);

CREATE INDEX idx_agents_brokerage_agent_id ON public.agents USING btree (brokerage_agent_id);

CREATE INDEX idx_team_messages_board ON public.team_messages USING btree (team_id, created_at DESC) WHERE (recipient_id IS NULL);

CREATE INDEX idx_team_messages_dm ON public.team_messages USING btree (team_id, sender_id, recipient_id, created_at DESC) WHERE (recipient_id IS NOT NULL);

CREATE INDEX idx_team_messages_recipient ON public.team_messages USING btree (recipient_id, created_at DESC) WHERE (recipient_id IS NOT NULL);

CREATE INDEX idx_key_dates_transaction ON public.transaction_key_dates USING btree (transaction_id, due_date);

CREATE INDEX idx_key_dates_due_open ON public.transaction_key_dates USING btree (due_date) WHERE (completed = false);

CREATE INDEX idx_signing_requests_group_id ON public.signing_requests USING btree (group_id);

CREATE INDEX idx_kdce_user ON public.key_date_calendar_events USING btree (user_id);

CREATE INDEX idx_step_email_templates_user ON public.step_email_templates USING btree (tc_user_id);

CREATE UNIQUE INDEX contacts_user_email_uniq ON public.contacts USING btree (tc_user_id, lower(email)) WHERE (email IS NOT NULL);

CREATE INDEX idx_contacts_user ON public.contacts USING btree (tc_user_id);

CREATE INDEX idx_contacts_tags ON public.contacts USING gin (tags);

CREATE INDEX idx_listings_tc ON public.listings USING btree (tc_user_id);

CREATE INDEX idx_listings_agent ON public.listings USING btree (agent_id);

CREATE INDEX idx_listing_tasks_listing ON public.listing_tasks USING btree (listing_id);

CREATE INDEX idx_listing_offers_listing ON public.listing_offers USING btree (listing_id);

CREATE INDEX idx_listing_contacts_listing ON public.listing_contacts USING btree (listing_id);

CREATE INDEX idx_listing_dates_listing ON public.listing_dates USING btree (listing_id);

CREATE INDEX idx_listing_template_steps_tc ON public.listing_template_steps USING btree (tc_user_id);

CREATE INDEX idx_listing_documents_listing ON public.listing_documents USING btree (listing_id);

CREATE INDEX idx_listing_showings_listing ON public.listing_showings USING btree (listing_id);

CREATE INDEX idx_listing_price_changes_listing ON public.listing_price_changes USING btree (listing_id);

CREATE INDEX idx_listing_activity_listing ON public.listing_activity USING btree (listing_id, created_at DESC);

CREATE INDEX idx_listing_offer_versions_offer ON public.listing_offer_versions USING btree (offer_id, version_number);

CREATE INDEX idx_listing_offer_documents_offer ON public.listing_offer_documents USING btree (offer_id);

CREATE UNIQUE INDEX idx_listings_inbound_token ON public.listings USING btree (inbound_token);

CREATE INDEX idx_listing_template_steps_name ON public.listing_template_steps USING btree (tc_user_id, template_name);

CREATE INDEX idx_listing_inbound_offers_listing ON public.listing_inbound_offers USING btree (listing_id, status);

CREATE INDEX idx_listing_comments_listing ON public.listing_comments USING btree (listing_id, created_at);

CREATE INDEX idx_calendar_connections_login_email ON public.calendar_connections USING btree (lower(login_email));

CREATE INDEX idx_lace_user ON public.listing_agent_calendar_events USING btree (user_id);

CREATE INDEX idx_signing_requests_listing_id ON public.signing_requests USING btree (listing_id);

CREATE INDEX idx_direct_messages_pair ON public.direct_messages USING btree (tc_user_id, agent_email, created_at);

CREATE INDEX idx_direct_messages_agent ON public.direct_messages USING btree (agent_email, created_at);

CREATE INDEX idx_invoices_qb_status ON public.invoices USING btree (qb_sync_status);

CREATE INDEX idx_tce_user ON public.transaction_closing_events USING btree (user_id);

CREATE INDEX idx_contacts_org ON public.contacts USING btree (organization_id) WHERE (organization_id IS NOT NULL);

CREATE UNIQUE INDEX contacts_agent_uniq ON public.contacts USING btree (tc_user_id, agent_id) WHERE (agent_id IS NOT NULL);

CREATE INDEX idx_contact_activity_contact ON public.contact_activity USING btree (contact_id, occurred_at DESC);

CREATE INDEX idx_contact_activity_user ON public.contact_activity USING btree (tc_user_id);

CREATE INDEX idx_contact_reminders_contact ON public.contact_reminders USING btree (contact_id);

CREATE INDEX idx_contact_reminders_open ON public.contact_reminders USING btree (tc_user_id, due_on) WHERE (done_at IS NULL);

CREATE INDEX idx_contacts_team ON public.contacts USING btree (team_id) WHERE (team_id IS NOT NULL);

CREATE UNIQUE INDEX contacts_team_email_uniq ON public.contacts USING btree (team_id, lower(email)) WHERE ((team_id IS NOT NULL) AND (email IS NOT NULL));

CREATE INDEX idx_notifications_recipient_created ON public.notifications USING btree (recipient_user_id, created_at DESC);

CREATE INDEX idx_notifications_recipient_unread ON public.notifications USING btree (recipient_user_id) WHERE (read_at IS NULL);

CREATE INDEX idx_notifications_transaction ON public.notifications USING btree (transaction_id);

CREATE INDEX idx_ai_usage_user ON public.ai_usage USING btree (user_id, created_at DESC);

CREATE INDEX idx_ai_usage_created_at ON public.ai_usage USING btree (created_at DESC);

CREATE INDEX idx_client_messages_board ON public.client_messages USING btree (transaction_id, channel, created_at);

CREATE INDEX idx_client_messages_link ON public.client_messages USING btree (link_id, channel, created_at);

CREATE INDEX idx_audit_log_created_at ON public.audit_log USING btree (created_at DESC);

CREATE INDEX idx_audit_log_actor ON public.audit_log USING btree (actor_id, created_at DESC);

CREATE INDEX idx_audit_log_entity ON public.audit_log USING btree (entity_type, entity_id);

alter table public.users enable row level security;

alter table public.transactions enable row level security;

alter table public.tasks enable row level security;

alter table public.invoices enable row level security;

alter table public.agents enable row level security;

alter table public.documents enable row level security;

alter table public.stripe_customers enable row level security;

alter table public.teams enable row level security;

alter table public.team_members enable row level security;

alter table public.team_invites enable row level security;

alter table public.payment_accounts enable row level security;

alter table public.checklist_templates enable row level security;

alter table public.calendar_connections enable row level security;

alter table public.signing_requests enable row level security;

alter table public.transaction_contacts enable row level security;

alter table public.rate_limits enable row level security;

alter table public.transaction_agents enable row level security;

alter table public.agent_invites enable row level security;

alter table public.messages enable row level security;

alter table public.transaction_emails enable row level security;

alter table public.external_access_links enable row level security;

alter table public.brokerage_agents enable row level security;

alter table public.team_messages enable row level security;

alter table public.team_message_reads enable row level security;

alter table public.transaction_key_dates enable row level security;

alter table public.key_date_calendar_events enable row level security;

alter table public.calendar_feed_tokens enable row level security;

alter table public.step_email_templates enable row level security;

alter table public.contacts enable row level security;

alter table public.listings enable row level security;

alter table public.listing_tasks enable row level security;

alter table public.listing_offers enable row level security;

alter table public.listing_contacts enable row level security;

alter table public.listing_dates enable row level security;

alter table public.listing_template_steps enable row level security;

alter table public.listing_documents enable row level security;

alter table public.listing_showings enable row level security;

alter table public.listing_price_changes enable row level security;

alter table public.listing_activity enable row level security;

alter table public.listing_offer_versions enable row level security;

alter table public.listing_offer_documents enable row level security;

alter table public.listing_inbound_offers enable row level security;

alter table public.listing_comments enable row level security;

alter table public.listing_agent_calendar_events enable row level security;

alter table public.direct_messages enable row level security;

alter table public.calendar_preferences enable row level security;

alter table public.quickbooks_connections enable row level security;

alter table public.quickbooks_customers enable row level security;

alter table public.transaction_closing_events enable row level security;

alter table public.contact_activity enable row level security;

alter table public.contact_reminders enable row level security;

alter table public.attention_dismissals enable row level security;

alter table public.notifications enable row level security;

alter table public.ai_usage enable row level security;

alter table public.client_messages enable row level security;

alter table public.audit_log enable row level security;


create policy "Users can manage their own agents" on public.agents as permissive for all to public using ((tc_user_id = auth.uid())) with check ((tc_user_id = auth.uid()));


create policy "TC can see contacts for their own transactions" on public.transaction_contacts as permissive for select to public using ((transaction_id IN ( SELECT t.id
   FROM (transactions t
     JOIN agents a ON ((t.agent_id = a.id)))
  WHERE (a.tc_user_id = auth.uid()))));

create policy "TC can see invites for their own transactions" on public.agent_invites as permissive for select to public using ((transaction_id IN ( SELECT t.id
   FROM (transactions t
     JOIN agents a ON ((t.agent_id = a.id)))
  WHERE (a.tc_user_id = auth.uid()))));

create policy "Agent can see their own transaction access" on public.transaction_agents as permissive for select to public using ((agent_user_id = auth.uid()));

create policy "TC can see agents on their own transactions" on public.transaction_agents as permissive for select to public using ((transaction_id IN ( SELECT t.id
   FROM (transactions t
     JOIN agents a ON ((t.agent_id = a.id)))
  WHERE (a.tc_user_id = auth.uid()))));

create policy "Agent can see messages on their own transactions" on public.messages as permissive for select to public using ((transaction_id IN ( SELECT transaction_agents.transaction_id
   FROM transaction_agents
  WHERE (transaction_agents.agent_user_id = auth.uid()))));

create policy "TC can see messages on their own transactions" on public.messages as permissive for select to public using ((transaction_id IN ( SELECT t.id
   FROM (transactions t
     JOIN agents a ON ((t.agent_id = a.id)))
  WHERE (a.tc_user_id = auth.uid()))));


revoke all on table public.users from anon, authenticated, service_role;

revoke all on table public.transactions from anon, authenticated, service_role;

revoke all on table public.tasks from anon, authenticated, service_role;

revoke all on table public.invoices from anon, authenticated, service_role;

revoke all on table public.agents from anon, authenticated, service_role;

revoke all on table public.documents from anon, authenticated, service_role;

revoke all on table public.stripe_customers from anon, authenticated, service_role;

revoke all on table public.teams from anon, authenticated, service_role;

revoke all on table public.team_members from anon, authenticated, service_role;

revoke all on table public.team_invites from anon, authenticated, service_role;

revoke all on table public.payment_accounts from anon, authenticated, service_role;

revoke all on table public.checklist_templates from anon, authenticated, service_role;

revoke all on table public.calendar_connections from anon, authenticated, service_role;

revoke all on table public.signing_requests from anon, authenticated, service_role;

revoke all on table public.transaction_contacts from anon, authenticated, service_role;

revoke all on table public.rate_limits from anon, authenticated, service_role;

revoke all on table public.transaction_agents from anon, authenticated, service_role;

revoke all on table public.agent_invites from anon, authenticated, service_role;

revoke all on table public.messages from anon, authenticated, service_role;

revoke all on table public.transaction_emails from anon, authenticated, service_role;

revoke all on table public.external_access_links from anon, authenticated, service_role;

revoke all on table public.brokerage_agents from anon, authenticated, service_role;

revoke all on table public.team_messages from anon, authenticated, service_role;

revoke all on table public.team_message_reads from anon, authenticated, service_role;

revoke all on table public.transaction_key_dates from anon, authenticated, service_role;

revoke all on table public.key_date_calendar_events from anon, authenticated, service_role;

revoke all on table public.calendar_feed_tokens from anon, authenticated, service_role;

revoke all on table public.step_email_templates from anon, authenticated, service_role;

revoke all on table public.contacts from anon, authenticated, service_role;

revoke all on table public.listings from anon, authenticated, service_role;

revoke all on table public.listing_tasks from anon, authenticated, service_role;

revoke all on table public.listing_offers from anon, authenticated, service_role;

revoke all on table public.listing_contacts from anon, authenticated, service_role;

revoke all on table public.listing_dates from anon, authenticated, service_role;

revoke all on table public.listing_template_steps from anon, authenticated, service_role;

revoke all on table public.listing_documents from anon, authenticated, service_role;

revoke all on table public.listing_showings from anon, authenticated, service_role;

revoke all on table public.listing_price_changes from anon, authenticated, service_role;

revoke all on table public.listing_activity from anon, authenticated, service_role;

revoke all on table public.listing_offer_versions from anon, authenticated, service_role;

revoke all on table public.listing_offer_documents from anon, authenticated, service_role;

revoke all on table public.listing_inbound_offers from anon, authenticated, service_role;

revoke all on table public.listing_comments from anon, authenticated, service_role;

revoke all on table public.listing_agent_calendar_events from anon, authenticated, service_role;

revoke all on table public.direct_messages from anon, authenticated, service_role;

revoke all on table public.calendar_preferences from anon, authenticated, service_role;

revoke all on table public.quickbooks_connections from anon, authenticated, service_role;

revoke all on table public.quickbooks_customers from anon, authenticated, service_role;

revoke all on table public.transaction_closing_events from anon, authenticated, service_role;

revoke all on table public.contact_activity from anon, authenticated, service_role;

revoke all on table public.contact_reminders from anon, authenticated, service_role;

revoke all on table public.attention_dismissals from anon, authenticated, service_role;

revoke all on table public.notifications from anon, authenticated, service_role;

revoke all on table public.ai_usage from anon, authenticated, service_role;

revoke all on table public.client_messages from anon, authenticated, service_role;

revoke all on table public.audit_log from anon, authenticated, service_role;

grant DELETE on table public.agent_invites to service_role;

grant INSERT on table public.agent_invites to service_role;

grant MAINTAIN on table public.agent_invites to service_role;

grant REFERENCES on table public.agent_invites to service_role;

grant SELECT on table public.agent_invites to service_role;

grant TRIGGER on table public.agent_invites to service_role;

grant TRUNCATE on table public.agent_invites to service_role;

grant UPDATE on table public.agent_invites to service_role;

grant DELETE on table public.agents to service_role;

grant INSERT on table public.agents to service_role;

grant MAINTAIN on table public.agents to service_role;

grant REFERENCES on table public.agents to service_role;

grant SELECT on table public.agents to service_role;

grant TRIGGER on table public.agents to service_role;

grant TRUNCATE on table public.agents to service_role;

grant UPDATE on table public.agents to service_role;

grant DELETE on table public.ai_usage to service_role;

grant INSERT on table public.ai_usage to service_role;

grant MAINTAIN on table public.ai_usage to service_role;

grant REFERENCES on table public.ai_usage to service_role;

grant SELECT on table public.ai_usage to service_role;

grant TRIGGER on table public.ai_usage to service_role;

grant TRUNCATE on table public.ai_usage to service_role;

grant UPDATE on table public.ai_usage to service_role;

grant DELETE on table public.attention_dismissals to service_role;

grant INSERT on table public.attention_dismissals to service_role;

grant MAINTAIN on table public.attention_dismissals to service_role;

grant REFERENCES on table public.attention_dismissals to service_role;

grant SELECT on table public.attention_dismissals to service_role;

grant TRIGGER on table public.attention_dismissals to service_role;

grant TRUNCATE on table public.attention_dismissals to service_role;

grant UPDATE on table public.attention_dismissals to service_role;

grant DELETE on table public.audit_log to service_role;

grant INSERT on table public.audit_log to service_role;

grant MAINTAIN on table public.audit_log to service_role;

grant REFERENCES on table public.audit_log to service_role;

grant SELECT on table public.audit_log to service_role;

grant TRIGGER on table public.audit_log to service_role;

grant TRUNCATE on table public.audit_log to service_role;

grant UPDATE on table public.audit_log to service_role;

grant DELETE on table public.brokerage_agents to service_role;

grant INSERT on table public.brokerage_agents to service_role;

grant MAINTAIN on table public.brokerage_agents to service_role;

grant REFERENCES on table public.brokerage_agents to service_role;

grant SELECT on table public.brokerage_agents to service_role;

grant TRIGGER on table public.brokerage_agents to service_role;

grant TRUNCATE on table public.brokerage_agents to service_role;

grant UPDATE on table public.brokerage_agents to service_role;

grant DELETE on table public.calendar_connections to service_role;

grant INSERT on table public.calendar_connections to service_role;

grant MAINTAIN on table public.calendar_connections to service_role;

grant REFERENCES on table public.calendar_connections to service_role;

grant SELECT on table public.calendar_connections to service_role;

grant TRIGGER on table public.calendar_connections to service_role;

grant TRUNCATE on table public.calendar_connections to service_role;

grant UPDATE on table public.calendar_connections to service_role;

grant DELETE on table public.calendar_feed_tokens to service_role;

grant INSERT on table public.calendar_feed_tokens to service_role;

grant MAINTAIN on table public.calendar_feed_tokens to service_role;

grant REFERENCES on table public.calendar_feed_tokens to service_role;

grant SELECT on table public.calendar_feed_tokens to service_role;

grant TRIGGER on table public.calendar_feed_tokens to service_role;

grant TRUNCATE on table public.calendar_feed_tokens to service_role;

grant UPDATE on table public.calendar_feed_tokens to service_role;

grant DELETE on table public.calendar_preferences to service_role;

grant INSERT on table public.calendar_preferences to service_role;

grant MAINTAIN on table public.calendar_preferences to service_role;

grant REFERENCES on table public.calendar_preferences to service_role;

grant SELECT on table public.calendar_preferences to service_role;

grant TRIGGER on table public.calendar_preferences to service_role;

grant TRUNCATE on table public.calendar_preferences to service_role;

grant UPDATE on table public.calendar_preferences to service_role;

grant DELETE on table public.checklist_templates to service_role;

grant INSERT on table public.checklist_templates to service_role;

grant MAINTAIN on table public.checklist_templates to service_role;

grant REFERENCES on table public.checklist_templates to service_role;

grant SELECT on table public.checklist_templates to service_role;

grant TRIGGER on table public.checklist_templates to service_role;

grant TRUNCATE on table public.checklist_templates to service_role;

grant UPDATE on table public.checklist_templates to service_role;

grant DELETE on table public.client_messages to service_role;

grant INSERT on table public.client_messages to service_role;

grant MAINTAIN on table public.client_messages to service_role;

grant REFERENCES on table public.client_messages to service_role;

grant SELECT on table public.client_messages to service_role;

grant TRIGGER on table public.client_messages to service_role;

grant TRUNCATE on table public.client_messages to service_role;

grant UPDATE on table public.client_messages to service_role;

grant DELETE on table public.contact_activity to service_role;

grant INSERT on table public.contact_activity to service_role;

grant MAINTAIN on table public.contact_activity to service_role;

grant REFERENCES on table public.contact_activity to service_role;

grant SELECT on table public.contact_activity to service_role;

grant TRIGGER on table public.contact_activity to service_role;

grant TRUNCATE on table public.contact_activity to service_role;

grant UPDATE on table public.contact_activity to service_role;

grant DELETE on table public.contact_reminders to service_role;

grant INSERT on table public.contact_reminders to service_role;

grant MAINTAIN on table public.contact_reminders to service_role;

grant REFERENCES on table public.contact_reminders to service_role;

grant SELECT on table public.contact_reminders to service_role;

grant TRIGGER on table public.contact_reminders to service_role;

grant TRUNCATE on table public.contact_reminders to service_role;

grant UPDATE on table public.contact_reminders to service_role;

grant DELETE on table public.contacts to service_role;

grant INSERT on table public.contacts to service_role;

grant MAINTAIN on table public.contacts to service_role;

grant REFERENCES on table public.contacts to service_role;

grant SELECT on table public.contacts to service_role;

grant TRIGGER on table public.contacts to service_role;

grant TRUNCATE on table public.contacts to service_role;

grant UPDATE on table public.contacts to service_role;

grant DELETE on table public.direct_messages to service_role;

grant INSERT on table public.direct_messages to service_role;

grant MAINTAIN on table public.direct_messages to service_role;

grant REFERENCES on table public.direct_messages to service_role;

grant SELECT on table public.direct_messages to service_role;

grant TRIGGER on table public.direct_messages to service_role;

grant TRUNCATE on table public.direct_messages to service_role;

grant UPDATE on table public.direct_messages to service_role;

grant DELETE on table public.documents to service_role;

grant INSERT on table public.documents to service_role;

grant MAINTAIN on table public.documents to service_role;

grant REFERENCES on table public.documents to service_role;

grant SELECT on table public.documents to service_role;

grant TRIGGER on table public.documents to service_role;

grant TRUNCATE on table public.documents to service_role;

grant UPDATE on table public.documents to service_role;

grant DELETE on table public.external_access_links to service_role;

grant INSERT on table public.external_access_links to service_role;

grant MAINTAIN on table public.external_access_links to service_role;

grant REFERENCES on table public.external_access_links to service_role;

grant SELECT on table public.external_access_links to service_role;

grant TRIGGER on table public.external_access_links to service_role;

grant TRUNCATE on table public.external_access_links to service_role;

grant UPDATE on table public.external_access_links to service_role;

grant DELETE on table public.invoices to service_role;

grant INSERT on table public.invoices to service_role;

grant MAINTAIN on table public.invoices to service_role;

grant REFERENCES on table public.invoices to service_role;

grant SELECT on table public.invoices to service_role;

grant TRIGGER on table public.invoices to service_role;

grant TRUNCATE on table public.invoices to service_role;

grant UPDATE on table public.invoices to service_role;

grant DELETE on table public.key_date_calendar_events to service_role;

grant INSERT on table public.key_date_calendar_events to service_role;

grant MAINTAIN on table public.key_date_calendar_events to service_role;

grant REFERENCES on table public.key_date_calendar_events to service_role;

grant SELECT on table public.key_date_calendar_events to service_role;

grant TRIGGER on table public.key_date_calendar_events to service_role;

grant TRUNCATE on table public.key_date_calendar_events to service_role;

grant UPDATE on table public.key_date_calendar_events to service_role;

grant DELETE on table public.listing_activity to service_role;

grant INSERT on table public.listing_activity to service_role;

grant MAINTAIN on table public.listing_activity to service_role;

grant REFERENCES on table public.listing_activity to service_role;

grant SELECT on table public.listing_activity to service_role;

grant TRIGGER on table public.listing_activity to service_role;

grant TRUNCATE on table public.listing_activity to service_role;

grant UPDATE on table public.listing_activity to service_role;

grant DELETE on table public.listing_agent_calendar_events to service_role;

grant INSERT on table public.listing_agent_calendar_events to service_role;

grant MAINTAIN on table public.listing_agent_calendar_events to service_role;

grant REFERENCES on table public.listing_agent_calendar_events to service_role;

grant SELECT on table public.listing_agent_calendar_events to service_role;

grant TRIGGER on table public.listing_agent_calendar_events to service_role;

grant TRUNCATE on table public.listing_agent_calendar_events to service_role;

grant UPDATE on table public.listing_agent_calendar_events to service_role;

grant DELETE on table public.listing_comments to service_role;

grant INSERT on table public.listing_comments to service_role;

grant MAINTAIN on table public.listing_comments to service_role;

grant REFERENCES on table public.listing_comments to service_role;

grant SELECT on table public.listing_comments to service_role;

grant TRIGGER on table public.listing_comments to service_role;

grant TRUNCATE on table public.listing_comments to service_role;

grant UPDATE on table public.listing_comments to service_role;

grant DELETE on table public.listing_contacts to service_role;

grant INSERT on table public.listing_contacts to service_role;

grant MAINTAIN on table public.listing_contacts to service_role;

grant REFERENCES on table public.listing_contacts to service_role;

grant SELECT on table public.listing_contacts to service_role;

grant TRIGGER on table public.listing_contacts to service_role;

grant TRUNCATE on table public.listing_contacts to service_role;

grant UPDATE on table public.listing_contacts to service_role;

grant DELETE on table public.listing_dates to service_role;

grant INSERT on table public.listing_dates to service_role;

grant MAINTAIN on table public.listing_dates to service_role;

grant REFERENCES on table public.listing_dates to service_role;

grant SELECT on table public.listing_dates to service_role;

grant TRIGGER on table public.listing_dates to service_role;

grant TRUNCATE on table public.listing_dates to service_role;

grant UPDATE on table public.listing_dates to service_role;

grant DELETE on table public.listing_documents to service_role;

grant INSERT on table public.listing_documents to service_role;

grant MAINTAIN on table public.listing_documents to service_role;

grant REFERENCES on table public.listing_documents to service_role;

grant SELECT on table public.listing_documents to service_role;

grant TRIGGER on table public.listing_documents to service_role;

grant TRUNCATE on table public.listing_documents to service_role;

grant UPDATE on table public.listing_documents to service_role;

grant DELETE on table public.listing_inbound_offers to service_role;

grant INSERT on table public.listing_inbound_offers to service_role;

grant MAINTAIN on table public.listing_inbound_offers to service_role;

grant REFERENCES on table public.listing_inbound_offers to service_role;

grant SELECT on table public.listing_inbound_offers to service_role;

grant TRIGGER on table public.listing_inbound_offers to service_role;

grant TRUNCATE on table public.listing_inbound_offers to service_role;

grant UPDATE on table public.listing_inbound_offers to service_role;

grant DELETE on table public.listing_offer_documents to service_role;

grant INSERT on table public.listing_offer_documents to service_role;

grant MAINTAIN on table public.listing_offer_documents to service_role;

grant REFERENCES on table public.listing_offer_documents to service_role;

grant SELECT on table public.listing_offer_documents to service_role;

grant TRIGGER on table public.listing_offer_documents to service_role;

grant TRUNCATE on table public.listing_offer_documents to service_role;

grant UPDATE on table public.listing_offer_documents to service_role;

grant DELETE on table public.listing_offer_versions to service_role;

grant INSERT on table public.listing_offer_versions to service_role;

grant MAINTAIN on table public.listing_offer_versions to service_role;

grant REFERENCES on table public.listing_offer_versions to service_role;

grant SELECT on table public.listing_offer_versions to service_role;

grant TRIGGER on table public.listing_offer_versions to service_role;

grant TRUNCATE on table public.listing_offer_versions to service_role;

grant UPDATE on table public.listing_offer_versions to service_role;

grant DELETE on table public.listing_offers to service_role;

grant INSERT on table public.listing_offers to service_role;

grant MAINTAIN on table public.listing_offers to service_role;

grant REFERENCES on table public.listing_offers to service_role;

grant SELECT on table public.listing_offers to service_role;

grant TRIGGER on table public.listing_offers to service_role;

grant TRUNCATE on table public.listing_offers to service_role;

grant UPDATE on table public.listing_offers to service_role;

grant DELETE on table public.listing_price_changes to service_role;

grant INSERT on table public.listing_price_changes to service_role;

grant MAINTAIN on table public.listing_price_changes to service_role;

grant REFERENCES on table public.listing_price_changes to service_role;

grant SELECT on table public.listing_price_changes to service_role;

grant TRIGGER on table public.listing_price_changes to service_role;

grant TRUNCATE on table public.listing_price_changes to service_role;

grant UPDATE on table public.listing_price_changes to service_role;

grant DELETE on table public.listing_showings to service_role;

grant INSERT on table public.listing_showings to service_role;

grant MAINTAIN on table public.listing_showings to service_role;

grant REFERENCES on table public.listing_showings to service_role;

grant SELECT on table public.listing_showings to service_role;

grant TRIGGER on table public.listing_showings to service_role;

grant TRUNCATE on table public.listing_showings to service_role;

grant UPDATE on table public.listing_showings to service_role;

grant DELETE on table public.listing_tasks to service_role;

grant INSERT on table public.listing_tasks to service_role;

grant MAINTAIN on table public.listing_tasks to service_role;

grant REFERENCES on table public.listing_tasks to service_role;

grant SELECT on table public.listing_tasks to service_role;

grant TRIGGER on table public.listing_tasks to service_role;

grant TRUNCATE on table public.listing_tasks to service_role;

grant UPDATE on table public.listing_tasks to service_role;

grant DELETE on table public.listing_template_steps to service_role;

grant INSERT on table public.listing_template_steps to service_role;

grant MAINTAIN on table public.listing_template_steps to service_role;

grant REFERENCES on table public.listing_template_steps to service_role;

grant SELECT on table public.listing_template_steps to service_role;

grant TRIGGER on table public.listing_template_steps to service_role;

grant TRUNCATE on table public.listing_template_steps to service_role;

grant UPDATE on table public.listing_template_steps to service_role;

grant DELETE on table public.listings to service_role;

grant INSERT on table public.listings to service_role;

grant MAINTAIN on table public.listings to service_role;

grant REFERENCES on table public.listings to service_role;

grant SELECT on table public.listings to service_role;

grant TRIGGER on table public.listings to service_role;

grant TRUNCATE on table public.listings to service_role;

grant UPDATE on table public.listings to service_role;

grant DELETE on table public.messages to service_role;

grant INSERT on table public.messages to service_role;

grant MAINTAIN on table public.messages to service_role;

grant REFERENCES on table public.messages to service_role;

grant SELECT on table public.messages to service_role;

grant TRIGGER on table public.messages to service_role;

grant TRUNCATE on table public.messages to service_role;

grant UPDATE on table public.messages to service_role;

grant DELETE on table public.notifications to service_role;

grant INSERT on table public.notifications to service_role;

grant MAINTAIN on table public.notifications to service_role;

grant REFERENCES on table public.notifications to service_role;

grant SELECT on table public.notifications to service_role;

grant TRIGGER on table public.notifications to service_role;

grant TRUNCATE on table public.notifications to service_role;

grant UPDATE on table public.notifications to service_role;

grant DELETE on table public.payment_accounts to service_role;

grant INSERT on table public.payment_accounts to service_role;

grant MAINTAIN on table public.payment_accounts to service_role;

grant REFERENCES on table public.payment_accounts to service_role;

grant SELECT on table public.payment_accounts to service_role;

grant TRIGGER on table public.payment_accounts to service_role;

grant TRUNCATE on table public.payment_accounts to service_role;

grant UPDATE on table public.payment_accounts to service_role;

grant DELETE on table public.quickbooks_connections to service_role;

grant INSERT on table public.quickbooks_connections to service_role;

grant MAINTAIN on table public.quickbooks_connections to service_role;

grant REFERENCES on table public.quickbooks_connections to service_role;

grant SELECT on table public.quickbooks_connections to service_role;

grant TRIGGER on table public.quickbooks_connections to service_role;

grant TRUNCATE on table public.quickbooks_connections to service_role;

grant UPDATE on table public.quickbooks_connections to service_role;

grant DELETE on table public.quickbooks_customers to service_role;

grant INSERT on table public.quickbooks_customers to service_role;

grant MAINTAIN on table public.quickbooks_customers to service_role;

grant REFERENCES on table public.quickbooks_customers to service_role;

grant SELECT on table public.quickbooks_customers to service_role;

grant TRIGGER on table public.quickbooks_customers to service_role;

grant TRUNCATE on table public.quickbooks_customers to service_role;

grant UPDATE on table public.quickbooks_customers to service_role;

grant DELETE on table public.rate_limits to service_role;

grant INSERT on table public.rate_limits to service_role;

grant MAINTAIN on table public.rate_limits to service_role;

grant REFERENCES on table public.rate_limits to service_role;

grant SELECT on table public.rate_limits to service_role;

grant TRIGGER on table public.rate_limits to service_role;

grant TRUNCATE on table public.rate_limits to service_role;

grant UPDATE on table public.rate_limits to service_role;

grant DELETE on table public.signing_requests to service_role;

grant INSERT on table public.signing_requests to service_role;

grant MAINTAIN on table public.signing_requests to service_role;

grant REFERENCES on table public.signing_requests to service_role;

grant SELECT on table public.signing_requests to service_role;

grant TRIGGER on table public.signing_requests to service_role;

grant TRUNCATE on table public.signing_requests to service_role;

grant UPDATE on table public.signing_requests to service_role;

grant DELETE on table public.step_email_templates to service_role;

grant INSERT on table public.step_email_templates to service_role;

grant MAINTAIN on table public.step_email_templates to service_role;

grant REFERENCES on table public.step_email_templates to service_role;

grant SELECT on table public.step_email_templates to service_role;

grant TRIGGER on table public.step_email_templates to service_role;

grant TRUNCATE on table public.step_email_templates to service_role;

grant UPDATE on table public.step_email_templates to service_role;

grant DELETE on table public.stripe_customers to service_role;

grant INSERT on table public.stripe_customers to service_role;

grant MAINTAIN on table public.stripe_customers to service_role;

grant REFERENCES on table public.stripe_customers to service_role;

grant SELECT on table public.stripe_customers to service_role;

grant TRIGGER on table public.stripe_customers to service_role;

grant TRUNCATE on table public.stripe_customers to service_role;

grant UPDATE on table public.stripe_customers to service_role;

grant DELETE on table public.tasks to service_role;

grant INSERT on table public.tasks to service_role;

grant MAINTAIN on table public.tasks to service_role;

grant REFERENCES on table public.tasks to service_role;

grant SELECT on table public.tasks to service_role;

grant TRIGGER on table public.tasks to service_role;

grant TRUNCATE on table public.tasks to service_role;

grant UPDATE on table public.tasks to service_role;

grant DELETE on table public.team_invites to service_role;

grant INSERT on table public.team_invites to service_role;

grant MAINTAIN on table public.team_invites to service_role;

grant REFERENCES on table public.team_invites to service_role;

grant SELECT on table public.team_invites to service_role;

grant TRIGGER on table public.team_invites to service_role;

grant TRUNCATE on table public.team_invites to service_role;

grant UPDATE on table public.team_invites to service_role;

grant DELETE on table public.team_members to service_role;

grant INSERT on table public.team_members to service_role;

grant MAINTAIN on table public.team_members to service_role;

grant REFERENCES on table public.team_members to service_role;

grant SELECT on table public.team_members to service_role;

grant TRIGGER on table public.team_members to service_role;

grant TRUNCATE on table public.team_members to service_role;

grant UPDATE on table public.team_members to service_role;

grant DELETE on table public.team_message_reads to service_role;

grant INSERT on table public.team_message_reads to service_role;

grant MAINTAIN on table public.team_message_reads to service_role;

grant REFERENCES on table public.team_message_reads to service_role;

grant SELECT on table public.team_message_reads to service_role;

grant TRIGGER on table public.team_message_reads to service_role;

grant TRUNCATE on table public.team_message_reads to service_role;

grant UPDATE on table public.team_message_reads to service_role;

grant DELETE on table public.team_messages to service_role;

grant INSERT on table public.team_messages to service_role;

grant MAINTAIN on table public.team_messages to service_role;

grant REFERENCES on table public.team_messages to service_role;

grant SELECT on table public.team_messages to service_role;

grant TRIGGER on table public.team_messages to service_role;

grant TRUNCATE on table public.team_messages to service_role;

grant UPDATE on table public.team_messages to service_role;

grant DELETE on table public.teams to service_role;

grant INSERT on table public.teams to service_role;

grant MAINTAIN on table public.teams to service_role;

grant REFERENCES on table public.teams to service_role;

grant SELECT on table public.teams to service_role;

grant TRIGGER on table public.teams to service_role;

grant TRUNCATE on table public.teams to service_role;

grant UPDATE on table public.teams to service_role;

grant DELETE on table public.transaction_agents to service_role;

grant INSERT on table public.transaction_agents to service_role;

grant MAINTAIN on table public.transaction_agents to service_role;

grant REFERENCES on table public.transaction_agents to service_role;

grant SELECT on table public.transaction_agents to service_role;

grant TRIGGER on table public.transaction_agents to service_role;

grant TRUNCATE on table public.transaction_agents to service_role;

grant UPDATE on table public.transaction_agents to service_role;

grant DELETE on table public.transaction_closing_events to service_role;

grant INSERT on table public.transaction_closing_events to service_role;

grant MAINTAIN on table public.transaction_closing_events to service_role;

grant REFERENCES on table public.transaction_closing_events to service_role;

grant SELECT on table public.transaction_closing_events to service_role;

grant TRIGGER on table public.transaction_closing_events to service_role;

grant TRUNCATE on table public.transaction_closing_events to service_role;

grant UPDATE on table public.transaction_closing_events to service_role;

grant DELETE on table public.transaction_contacts to service_role;

grant INSERT on table public.transaction_contacts to service_role;

grant MAINTAIN on table public.transaction_contacts to service_role;

grant REFERENCES on table public.transaction_contacts to service_role;

grant SELECT on table public.transaction_contacts to service_role;

grant TRIGGER on table public.transaction_contacts to service_role;

grant TRUNCATE on table public.transaction_contacts to service_role;

grant UPDATE on table public.transaction_contacts to service_role;

grant DELETE on table public.transaction_emails to service_role;

grant INSERT on table public.transaction_emails to service_role;

grant MAINTAIN on table public.transaction_emails to service_role;

grant REFERENCES on table public.transaction_emails to service_role;

grant SELECT on table public.transaction_emails to service_role;

grant TRIGGER on table public.transaction_emails to service_role;

grant TRUNCATE on table public.transaction_emails to service_role;

grant UPDATE on table public.transaction_emails to service_role;

grant DELETE on table public.transaction_key_dates to service_role;

grant INSERT on table public.transaction_key_dates to service_role;

grant MAINTAIN on table public.transaction_key_dates to service_role;

grant REFERENCES on table public.transaction_key_dates to service_role;

grant SELECT on table public.transaction_key_dates to service_role;

grant TRIGGER on table public.transaction_key_dates to service_role;

grant TRUNCATE on table public.transaction_key_dates to service_role;

grant UPDATE on table public.transaction_key_dates to service_role;

grant DELETE on table public.transactions to service_role;

grant INSERT on table public.transactions to service_role;

grant MAINTAIN on table public.transactions to service_role;

grant REFERENCES on table public.transactions to service_role;

grant SELECT on table public.transactions to service_role;

grant TRIGGER on table public.transactions to service_role;

grant TRUNCATE on table public.transactions to service_role;

grant UPDATE on table public.transactions to service_role;

grant DELETE on table public.users to service_role;

grant INSERT on table public.users to service_role;

grant MAINTAIN on table public.users to service_role;

grant REFERENCES on table public.users to service_role;

grant SELECT on table public.users to service_role;

grant TRIGGER on table public.users to service_role;

grant TRUNCATE on table public.users to service_role;

grant UPDATE on table public.users to service_role;
