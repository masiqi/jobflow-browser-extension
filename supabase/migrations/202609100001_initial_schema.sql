create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_verification_status text not null default 'unverified'
    check (email_verification_status in ('unverified', 'verified')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.resume_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version integer not null check (version > 0),
  state text not null check (state in ('draft', 'active', 'stale')),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  source_name text not null,
  source_kind text not null check (source_kind in ('pdf', 'docx', 'text', 'markdown', 'pasted')),
  summary text not null,
  target_roles jsonb not null default '[]'::jsonb,
  skills jsonb not null default '[]'::jsonb,
  constraints jsonb not null default '[]'::jsonb,
  analyzed_at timestamptz not null,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, source_hash, version)
);

create unique index resume_profiles_one_active_per_user
  on public.resume_profiles(user_id)
  where state = 'active';

create table public.resume_facts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.resume_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  fact_key text not null,
  text text not null,
  keywords jsonb not null default '[]'::jsonb,
  evidence text not null,
  approved boolean not null default false,
  sort_order integer not null default 0,
  unique (profile_id, fact_key)
);

create table public.filter_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version integer not null check (version > 0),
  catalog_version integer not null default 1,
  config jsonb not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, version)
);

create unique index filter_configs_one_active_per_user
  on public.filter_configs(user_id)
  where active;

create table public.job_opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform = 'liepin'),
  platform_job_id text not null,
  canonical_url text not null,
  title text not null default '',
  company text not null default '',
  location text not null default '',
  salary text not null default '',
  experience text not null default '',
  education text not null default '',
  card_text text not null default '',
  description text,
  recruiter text,
  recruiter_title text,
  jd_hash text,
  current_status text not null default 'discovered'
    check (current_status in (
      'discovered', 'queued', 'extracting', 'deterministic_excluded',
      'evaluating', 'model_excluded', 'review_required', 'generating',
      'draft_ready', 'user_excluded', 'failed'
    )),
  latest_reason text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, platform, platform_job_id)
);

create table public.opportunity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references public.job_opportunities(id) on delete cascade,
  kind text not null check (kind in (
    'opportunity_observed', 'details_captured', 'deterministic_excluded',
    'evaluation_started', 'evaluation_completed', 'review_requested',
    'user_excluded', 'user_override', 'generation_started',
    'generation_completed', 'draft_edited', 'processing_failed'
  )),
  schema_version integer not null default 1,
  actor text not null check (actor in ('system', 'model', 'user')),
  payload jsonb not null default '{}'::jsonb,
  request_id uuid,
  created_at timestamptz not null default now()
);

create index opportunity_events_replay_idx
  on public.opportunity_events(opportunity_id, created_at, id);
create unique index opportunity_events_request_once
  on public.opportunity_events(opportunity_id, request_id, kind)
  where request_id is not null;

create table public.evaluations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references public.job_opportunities(id) on delete cascade,
  outcome text not null check (outcome in ('proceed', 'review', 'exclude')),
  score numeric,
  reasons jsonb not null,
  jd_evidence jsonb not null,
  fact_ids jsonb not null,
  jd_hash text,
  profile_id uuid not null references public.resume_profiles(id),
  rule_version integer not null,
  prompt_version text not null,
  model_route text not null check (model_route in ('managed', 'byok')),
  provider text not null,
  model text not null,
  created_at timestamptz not null default now(),
  unique (opportunity_id)
);

create table public.message_drafts (
  opportunity_id uuid primary key references public.job_opportunities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  current_text text not null check (char_length(current_text) between 1 and 200),
  updated_at timestamptz not null default now()
);

create table public.draft_revisions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references public.job_opportunities(id) on delete cascade,
  kind text not null check (kind in ('generated', 'user_edit')),
  text text not null check (char_length(text) between 1 and 200),
  jd_evidence jsonb not null default '[]'::jsonb,
  fact_ids jsonb not null default '[]'::jsonb,
  model_metadata jsonb,
  created_at timestamptz not null default now()
);

create table public.batch_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform = 'liepin'),
  status text not null check (status in ('queued', 'running', 'paused', 'completed', 'cancelled', 'failed')),
  source_url text not null,
  current_index integer not null default 0,
  draft_count integer not null default 0,
  excluded_count integer not null default 0,
  review_count integer not null default 0,
  failed_count integer not null default 0,
  profile_id uuid not null references public.resume_profiles(id),
  rule_config_id uuid references public.filter_configs(id),
  model_metadata jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.batch_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null references public.batch_runs(id) on delete cascade,
  opportunity_id uuid not null references public.job_opportunities(id) on delete cascade,
  sort_order integer not null,
  status text not null check (status in (
    'queued', 'opening', 'extracting', 'evaluating', 'generating',
    'draft_ready', 'excluded', 'review_required', 'failed'
  )),
  attempt integer not null default 0,
  lease_id uuid,
  tab_id integer,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  unique (batch_id, opportunity_id),
  unique (batch_id, sort_order)
);

create table private.user_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  managed_model_enabled boolean not null default false,
  daily_request_limit integer not null default 0 check (daily_request_limit >= 0),
  updated_at timestamptz not null default now()
);

create table private.managed_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_day date not null,
  request_id uuid not null,
  operation text not null,
  reserved boolean not null default true,
  provider_units bigint,
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);

create table private.endpoint_policy (
  provider text primary key,
  endpoint_origin text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into private.endpoint_policy(provider, endpoint_origin) values
  ('openai', 'https://api.openai.com'),
  ('deepseek', 'https://api.deepseek.com'),
  ('openrouter', 'https://openrouter.ai')
on conflict (provider) do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(user_id) values (new.id);
  insert into private.user_entitlements(user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.get_my_entitlement()
returns table(managed_model_enabled boolean, daily_request_limit integer)
language sql
stable
security definer
set search_path = ''
as $$
  select e.managed_model_enabled, e.daily_request_limit
  from private.user_entitlements e
  where e.user_id = auth.uid();
$$;

create or replace function public.reserve_managed_model_request(
  target_request_id uuid,
  operation_name text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  limit_value integer;
  used_count integer;
  usage_date date := (now() at time zone 'Asia/Shanghai')::date;
begin
  select e.daily_request_limit into limit_value
  from private.user_entitlements e
  where e.user_id = auth.uid() and e.managed_model_enabled;
  if limit_value is null or limit_value <= 0 then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text || usage_date::text));
  select count(*) into used_count
  from private.managed_usage u
  where u.user_id = auth.uid() and u.usage_day = usage_date;
  if used_count >= limit_value then
    return false;
  end if;
  insert into private.managed_usage(user_id, usage_day, request_id, operation)
  values (auth.uid(), usage_date, target_request_id, operation_name)
  on conflict (user_id, request_id) do nothing;
  return true;
end;
$$;

create or replace function public.settle_managed_model_request(
  target_request_id uuid,
  target_provider_units bigint default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.managed_usage
  set reserved = false,
      provider_units = target_provider_units
  where user_id = auth.uid() and managed_usage.request_id = target_request_id;
$$;

create or replace function public.activate_resume_profile(target_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
begin
  select p.user_id into owner_id
  from public.resume_profiles p
  where p.id = target_profile_id;
  if owner_id is null or owner_id <> auth.uid() then
    raise exception 'profile_not_found' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.resume_facts f
    where f.profile_id = target_profile_id and f.user_id = auth.uid() and f.approved
  ) then
    raise exception 'approved_fact_required' using errcode = '23514';
  end if;
  update public.resume_profiles
  set state = 'stale'
  where user_id = auth.uid() and state = 'active' and id <> target_profile_id;
  update public.resume_profiles
  set state = 'active', activated_at = now()
  where id = target_profile_id and user_id = auth.uid();
end;
$$;

create or replace function public.save_draft_resume_profile(profile jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_id uuid := (profile ->> 'id')::uuid;
  fact jsonb;
  fact_index integer := 0;
begin
  if auth.uid() is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  if profile ->> 'state' <> 'draft' then raise exception 'draft_required' using errcode = '23514'; end if;
  if exists (
    select 1 from public.resume_profiles p
    where p.user_id = auth.uid()
      and p.source_hash = profile ->> 'sourceHash'
  ) then
    return (
      select p.id from public.resume_profiles p
      where p.user_id = auth.uid() and p.source_hash = profile ->> 'sourceHash'
      order by p.version desc limit 1
    );
  end if;
  update public.resume_profiles
  set state = 'stale'
  where user_id = auth.uid() and state = 'active';
  insert into public.resume_profiles(
    id, user_id, version, state, source_hash, source_name, source_kind,
    summary, target_roles, skills, constraints, analyzed_at
  ) values (
    profile_id, auth.uid(), (profile ->> 'version')::integer, 'draft',
    profile ->> 'sourceHash', profile ->> 'sourceName', profile ->> 'sourceKind',
    profile ->> 'summary', profile -> 'targetRoles', profile -> 'skills',
    profile -> 'constraints', (profile ->> 'analyzedAt')::timestamptz
  );
  for fact in select value from jsonb_array_elements(profile -> 'facts') loop
    insert into public.resume_facts(
      profile_id, user_id, fact_key, text, keywords, evidence, approved, sort_order
    ) values (
      profile_id, auth.uid(), fact ->> 'id', fact ->> 'text',
      fact -> 'keywords', fact ->> 'evidence',
      coalesce((fact ->> 'approved')::boolean, false), fact_index
    );
    fact_index := fact_index + 1;
  end loop;
  return profile_id;
end;
$$;

create or replace function public.save_filter_config(filter_config jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_version integer;
  config_id uuid;
begin
  if auth.uid() is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  select coalesce(max(version), 0) + 1 into next_version
  from public.filter_configs
  where user_id = auth.uid();
  update public.filter_configs set active = false
  where user_id = auth.uid() and active;
  insert into public.filter_configs(user_id, version, catalog_version, config, active)
  values (auth.uid(), next_version, 1, filter_config, true)
  returning id into config_id;
  return config_id;
end;
$$;

create or replace function public.delete_my_product_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  delete from public.batch_items where user_id = auth.uid();
  delete from public.batch_runs where user_id = auth.uid();
  delete from public.job_opportunities where user_id = auth.uid();
  delete from public.filter_configs where user_id = auth.uid();
  delete from public.resume_profiles where user_id = auth.uid();
  delete from private.managed_usage where user_id = auth.uid();
end;
$$;

create or replace function public.append_user_opportunity_event(
  target_opportunity_id uuid,
  event_kind text,
  event_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_id uuid;
  next_status text;
  previous_status text;
begin
  select o.current_status into previous_status
  from public.job_opportunities o
  where o.id = target_opportunity_id and o.user_id = auth.uid();
  if previous_status is null then
    raise exception 'opportunity_not_found' using errcode = '42501';
  end if;
  if event_kind = 'user_override'
    and previous_status not in ('deterministic_excluded', 'model_excluded', 'user_excluded') then
    raise exception 'override_not_allowed' using errcode = '23514';
  end if;
  if event_kind = 'user_excluded' and previous_status <> 'review_required' then
    raise exception 'exclusion_not_allowed' using errcode = '23514';
  end if;
  if event_kind = 'draft_edited' and previous_status <> 'draft_ready' then
    raise exception 'draft_edit_not_allowed' using errcode = '23514';
  end if;
  next_status := case event_kind
    when 'user_excluded' then 'user_excluded'
    when 'user_override' then 'generating'
    when 'draft_edited' then 'draft_ready'
    else null
  end;
  if next_status is null then
    raise exception 'event_not_allowed' using errcode = '42501';
  end if;
  insert into public.opportunity_events(user_id, opportunity_id, kind, actor, payload)
  values (auth.uid(), target_opportunity_id, event_kind, 'user', event_payload)
  returning id into event_id;
  update public.job_opportunities
  set current_status = next_status,
      latest_reason = coalesce(event_payload ->> 'reason', latest_reason),
      last_seen_at = now()
  where id = target_opportunity_id and user_id = auth.uid();
  return event_id;
end;
$$;

create or replace function public.observe_job_opportunities(observations jsonb)
returns setof public.job_opportunities
language sql
security definer
set search_path = ''
as $$
  insert into public.job_opportunities (
    user_id, platform, platform_job_id, canonical_url, title, company,
    location, salary, experience, education, card_text, last_seen_at
  )
  select
    auth.uid(),
    'liepin',
    item ->> 'platform_job_id',
    item ->> 'canonical_url',
    coalesce(item ->> 'title', ''),
    coalesce(item ->> 'company', ''),
    coalesce(item ->> 'location', ''),
    coalesce(item ->> 'salary', ''),
    coalesce(item ->> 'experience', ''),
    coalesce(item ->> 'education', ''),
    coalesce(item ->> 'card_text', ''),
    now()
  from jsonb_array_elements(observations) item
  where auth.uid() is not null
    and item ->> 'platform' = 'liepin'
    and coalesce(item ->> 'platform_job_id', '') <> ''
  on conflict (user_id, platform, platform_job_id)
  do update set
    canonical_url = excluded.canonical_url,
    title = excluded.title,
    company = excluded.company,
    location = excluded.location,
    salary = excluded.salary,
    experience = excluded.experience,
    education = excluded.education,
    card_text = excluded.card_text,
    last_seen_at = now()
  returning *;
$$;

create or replace function public.record_filter_result(
  target_opportunity_id uuid,
  target_request_id uuid,
  job jsonb,
  filter_result jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_status text;
  event_kind text;
  reason text;
  previous_status text;
begin
  select o.current_status into previous_status
  from public.job_opportunities o
  where o.id = target_opportunity_id
    and o.user_id = auth.uid()
    and o.platform = job ->> 'platform'
    and o.platform_job_id = job ->> 'jobId';
  if previous_status is null then
    raise exception 'opportunity_not_found' using errcode = '42501';
  end if;
  if previous_status in (
    'deterministic_excluded', 'model_excluded', 'review_required',
    'draft_ready', 'user_excluded'
  ) then
    return;
  end if;
  next_status := case filter_result ->> 'outcome'
    when 'exclude' then 'deterministic_excluded'
    when 'review' then 'review_required'
    else null
  end;
  if next_status is null then raise exception 'invalid_filter_outcome' using errcode = '23514'; end if;
  event_kind := case next_status when 'deterministic_excluded' then 'deterministic_excluded' else 'review_requested' end;
  select string_agg(value ->> 'reason', '；') into reason
  from jsonb_array_elements(filter_result -> 'decisions') value;
  update public.job_opportunities
  set description = job ->> 'description',
      recruiter = coalesce(job ->> 'recruiter', ''),
      recruiter_title = coalesce(job ->> 'recruiterTitle', ''),
      current_status = next_status,
      latest_reason = reason,
      last_seen_at = now()
  where id = target_opportunity_id and user_id = auth.uid();
  insert into public.opportunity_events(user_id, opportunity_id, kind, actor, payload, request_id)
  values (auth.uid(), target_opportunity_id, event_kind, 'system', jsonb_build_object('reason', reason, 'filter', filter_result), target_request_id)
  on conflict (opportunity_id, request_id, kind) where request_id is not null do nothing;
end;
$$;

create or replace function public.record_evaluation_result(
  target_opportunity_id uuid,
  target_request_id uuid,
  job jsonb,
  profile_id uuid,
  output jsonb,
  route text,
  provider_name text,
  model_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_status text;
  reason text;
begin
  if not exists (
    select 1 from public.job_opportunities o
    where o.id = target_opportunity_id
      and o.user_id = auth.uid()
      and o.platform = job ->> 'platform'
      and o.platform_job_id = job ->> 'jobId'
  ) or not exists (
    select 1 from public.resume_profiles p
    where p.id = profile_id and p.user_id = auth.uid() and p.state = 'active'
  ) then
    raise exception 'owned_input_not_found' using errcode = '42501';
  end if;
  next_status := case output ->> 'outcome'
    when 'exclude' then 'model_excluded'
    when 'review' then 'review_required'
    when 'proceed' then 'generating'
    else null
  end;
  if next_status is null then raise exception 'invalid_model_outcome' using errcode = '23514'; end if;
  if exists (
    select 1 from public.evaluations e where e.opportunity_id = target_opportunity_id
  ) then
    return;
  end if;
  select string_agg(value #>> '{}', '；') into reason
  from jsonb_array_elements(output -> 'reasons') value;
  insert into public.evaluations(
    request_id, user_id, opportunity_id, outcome, score, reasons,
    jd_evidence, fact_ids, profile_id, rule_version, prompt_version,
    model_route, provider, model
  ) values (
    target_request_id, auth.uid(), target_opportunity_id, output ->> 'outcome',
    nullif(output ->> 'score', '')::numeric, output -> 'reasons',
    output -> 'jdEvidence', output -> 'factIds', profile_id, 1,
    'job-suitability-v2', route, provider_name, model_name
  )
  on conflict (opportunity_id) do nothing;
  update public.job_opportunities
  set description = job ->> 'description',
      recruiter = coalesce(job ->> 'recruiter', ''),
      recruiter_title = coalesce(job ->> 'recruiterTitle', ''),
      current_status = next_status,
      latest_reason = reason,
      last_seen_at = now()
  where id = target_opportunity_id and user_id = auth.uid();
  insert into public.opportunity_events(user_id, opportunity_id, kind, actor, payload, request_id)
  values (auth.uid(), target_opportunity_id, 'evaluation_completed', 'model', output, target_request_id)
  on conflict (opportunity_id, request_id, kind) where request_id is not null do nothing;
end;
$$;

create or replace function public.record_greeting_result(
  target_opportunity_id uuid,
  target_request_id uuid,
  profile_id uuid,
  output jsonb,
  route text,
  provider_name text,
  model_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.job_opportunities o
    where o.id = target_opportunity_id and o.user_id = auth.uid()
  ) or not exists (
    select 1 from public.resume_profiles p
    where p.id = profile_id and p.user_id = auth.uid() and p.state = 'active'
  ) then
    raise exception 'owned_input_not_found' using errcode = '42501';
  end if;
  insert into public.message_drafts(opportunity_id, user_id, current_text)
  values (target_opportunity_id, auth.uid(), output ->> 'greeting')
  on conflict (opportunity_id) do update
  set current_text = excluded.current_text, updated_at = now()
  where message_drafts.user_id = auth.uid();
  insert into public.draft_revisions(
    request_id, user_id, opportunity_id, kind, text, jd_evidence, fact_ids, model_metadata
  ) values (
    target_request_id, auth.uid(), target_opportunity_id, 'generated', output ->> 'greeting',
    output -> 'jdEvidence', output -> 'factIds',
    jsonb_build_object('route', route, 'provider', provider_name, 'model', model_name, 'promptVersion', 'greeting-v2')
  ) on conflict (request_id) do nothing;
  update public.job_opportunities
  set current_status = 'draft_ready', latest_reason = '招呼语草稿已生成', last_seen_at = now()
  where id = target_opportunity_id and user_id = auth.uid();
  insert into public.opportunity_events(user_id, opportunity_id, kind, actor, payload, request_id)
  values (
    auth.uid(), target_opportunity_id, 'generation_completed', 'model',
    jsonb_build_object('factIds', output -> 'factIds', 'jdEvidence', output -> 'jdEvidence'),
    target_request_id
  ) on conflict (opportunity_id, request_id, kind) where request_id is not null do nothing;
end;
$$;

create or replace function public.edit_my_draft(
  target_opportunity_id uuid,
  target_request_id uuid,
  draft_text text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if char_length(draft_text) not between 1 and 200 then
    raise exception 'invalid_draft_length' using errcode = '23514';
  end if;
  update public.message_drafts
  set current_text = draft_text, updated_at = now()
  where opportunity_id = target_opportunity_id and user_id = auth.uid();
  if not found then raise exception 'draft_not_found' using errcode = '42501'; end if;
  insert into public.draft_revisions(request_id, user_id, opportunity_id, kind, text)
  values (target_request_id, auth.uid(), target_opportunity_id, 'user_edit', draft_text)
  on conflict (request_id) do nothing;
  insert into public.opportunity_events(user_id, opportunity_id, kind, actor, payload, request_id)
  values (auth.uid(), target_opportunity_id, 'draft_edited', 'user', '{}'::jsonb, target_request_id)
  on conflict (opportunity_id, request_id, kind) where request_id is not null do nothing;
end;
$$;

create or replace function public.record_processing_failure(
  target_opportunity_id uuid,
  target_request_id uuid,
  error_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_status text;
begin
  select o.current_status into previous_status
  from public.job_opportunities o
  where o.id = target_opportunity_id and o.user_id = auth.uid();
  if previous_status is null then raise exception 'opportunity_not_found' using errcode = '42501'; end if;
  if previous_status in (
    'deterministic_excluded', 'model_excluded', 'review_required',
    'draft_ready', 'user_excluded'
  ) then
    return;
  end if;
  update public.job_opportunities
  set current_status = 'failed', latest_reason = left(error_code, 200), last_seen_at = now()
  where id = target_opportunity_id and user_id = auth.uid();
  insert into public.opportunity_events(user_id, opportunity_id, kind, actor, payload, request_id)
  values (
    auth.uid(), target_opportunity_id, 'processing_failed', 'system',
    jsonb_build_object('errorCode', left(error_code, 200)), target_request_id
  ) on conflict (opportunity_id, request_id, kind) where request_id is not null do nothing;
end;
$$;

grant usage on schema public to authenticated;
grant select on public.profiles, public.resume_profiles, public.resume_facts,
  public.filter_configs, public.job_opportunities, public.opportunity_events,
  public.evaluations, public.message_drafts, public.draft_revisions,
  public.batch_runs, public.batch_items to authenticated;
grant update (summary, target_roles, skills, constraints)
  on public.resume_profiles to authenticated;
grant update (text, keywords, approved, sort_order)
  on public.resume_facts to authenticated;
grant execute on function public.get_my_entitlement() to authenticated;
grant execute on function public.reserve_managed_model_request(uuid, text) to authenticated;
grant execute on function public.settle_managed_model_request(uuid, bigint) to authenticated;
grant execute on function public.activate_resume_profile(uuid) to authenticated;
grant execute on function public.save_draft_resume_profile(jsonb) to authenticated;
grant execute on function public.save_filter_config(jsonb) to authenticated;
grant execute on function public.delete_my_product_data() to authenticated;
grant execute on function public.append_user_opportunity_event(uuid, text, jsonb) to authenticated;
grant execute on function public.observe_job_opportunities(jsonb) to authenticated;
grant execute on function public.record_filter_result(uuid, uuid, jsonb, jsonb) to authenticated;
grant execute on function public.record_evaluation_result(uuid, uuid, jsonb, uuid, jsonb, text, text, text) to authenticated;
grant execute on function public.record_greeting_result(uuid, uuid, uuid, jsonb, text, text, text) to authenticated;
grant execute on function public.edit_my_draft(uuid, uuid, text) to authenticated;
grant execute on function public.record_processing_failure(uuid, uuid, text) to authenticated;

alter table public.profiles enable row level security;
alter table public.resume_profiles enable row level security;
alter table public.resume_facts enable row level security;
alter table public.filter_configs enable row level security;
alter table public.job_opportunities enable row level security;
alter table public.opportunity_events enable row level security;
alter table public.evaluations enable row level security;
alter table public.message_drafts enable row level security;
alter table public.draft_revisions enable row level security;
alter table public.batch_runs enable row level security;
alter table public.batch_items enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);

create policy resume_profiles_select_own on public.resume_profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy resume_profiles_insert_own on public.resume_profiles
  for insert to authenticated with check ((select auth.uid()) = user_id and state = 'draft');
create policy resume_profiles_update_own_draft on public.resume_profiles
  for update to authenticated using ((select auth.uid()) = user_id and state = 'draft')
  with check ((select auth.uid()) = user_id and state = 'draft');

create policy resume_facts_select_own on public.resume_facts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy resume_facts_insert_own on public.resume_facts
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.resume_profiles p
      where p.id = profile_id and p.user_id = (select auth.uid()) and p.state = 'draft'
    )
  );
create policy resume_facts_update_own_draft on public.resume_facts
  for update to authenticated using (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.resume_profiles p
      where p.id = profile_id and p.user_id = (select auth.uid()) and p.state = 'draft'
    )
  ) with check ((select auth.uid()) = user_id);

create policy filter_configs_select_own on public.filter_configs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy filter_configs_insert_own on public.filter_configs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy filter_configs_update_own on public.filter_configs
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy opportunities_select_own on public.job_opportunities
  for select to authenticated using ((select auth.uid()) = user_id);
create policy opportunities_insert_own on public.job_opportunities
  for insert to authenticated with check ((select auth.uid()) = user_id and current_status = 'discovered');
create policy opportunities_update_observation on public.job_opportunities
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy opportunity_events_select_own on public.opportunity_events
  for select to authenticated using ((select auth.uid()) = user_id);
create policy evaluations_select_own on public.evaluations
  for select to authenticated using ((select auth.uid()) = user_id);
create policy message_drafts_select_own on public.message_drafts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy draft_revisions_select_own on public.draft_revisions
  for select to authenticated using ((select auth.uid()) = user_id);

create policy batch_runs_select_own on public.batch_runs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy batch_runs_insert_own on public.batch_runs
  for insert to authenticated with check ((select auth.uid()) = user_id and status = 'queued');
create policy batch_items_select_own on public.batch_items
  for select to authenticated using ((select auth.uid()) = user_id);
create policy batch_items_insert_own on public.batch_items
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.batch_runs b
      where b.id = batch_id and b.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.job_opportunities o
      where o.id = opportunity_id and o.user_id = (select auth.uid())
    )
  );
