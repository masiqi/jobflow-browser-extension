create table public.delivery_records (
  opportunity_id uuid primary key references public.job_opportunities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform = 'liepin'),
  platform_job_id text not null,
  resume_mode text not null default 'platform_default' check (resume_mode = 'platform_default'),
  overall_status text not null default 'ready'
    check (overall_status in ('ready', 'preflighting', 'awaiting_confirmation', 'in_progress', 'partial', 'succeeded', 'failed', 'review_required')),
  application_status text not null default 'pending'
    check (application_status in ('pending', 'attempted', 'verified', 'failed')),
  greeting_status text not null default 'pending'
    check (greeting_status in ('pending', 'attempted', 'verified', 'failed')),
  draft_revision_id uuid references public.draft_revisions(id),
  draft_sha256 text check (draft_sha256 is null or draft_sha256 ~ '^[a-f0-9]{64}$'),
  reservation_id uuid,
  latest_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform, platform_job_id)
);

create table public.delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references public.job_opportunities(id) on delete cascade,
  event_kind text not null,
  component_name text check (component_name is null or component_name in ('application', 'greeting')),
  component_status text check (component_status is null or component_status in ('pending', 'attempted', 'verified', 'failed')),
  evidence_code text not null check (char_length(evidence_code) between 1 and 80),
  evidence jsonb not null default '{}'::jsonb,
  draft_revision_id uuid references public.draft_revisions(id),
  draft_sha256 text check (draft_sha256 is null or draft_sha256 ~ '^[a-f0-9]{64}$'),
  reservation_id uuid,
  created_at timestamptz not null default now()
);

create table private.delivery_daily_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform = 'liepin'),
  opportunity_id uuid not null references public.job_opportunities(id) on delete cascade,
  quota_day date not null,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, platform, opportunity_id),
  unique (user_id, request_id)
);

create index delivery_attempts_replay_idx
  on public.delivery_attempts(opportunity_id, created_at, id);
create index delivery_daily_reservations_day_idx
  on private.delivery_daily_reservations(user_id, platform, quota_day);

alter table public.delivery_records enable row level security;
alter table public.delivery_attempts enable row level security;

create policy delivery_records_select_own on public.delivery_records
  for select to authenticated using ((select auth.uid()) = user_id);
create policy delivery_attempts_select_own on public.delivery_attempts
  for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.prepare_reviewed_delivery(
  target_opportunity_id uuid,
  target_draft_revision_id uuid,
  target_draft_sha256 text
)
returns public.delivery_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  opportunity public.job_opportunities%rowtype;
  draft_text text;
  revision_text text;
  record public.delivery_records%rowtype;
begin
  if auth.uid() is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  if target_draft_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_draft_hash' using errcode = '23514';
  end if;
  select * into opportunity
  from public.job_opportunities o
  where o.id = target_opportunity_id and o.user_id = auth.uid();
  if opportunity.id is null then raise exception 'opportunity_not_found' using errcode = '42501'; end if;
  if opportunity.platform <> 'liepin' or opportunity.current_status <> 'draft_ready' then
    raise exception 'draft_ready_required' using errcode = '23514';
  end if;
  select d.current_text into draft_text
  from public.message_drafts d
  where d.opportunity_id = target_opportunity_id and d.user_id = auth.uid();
  select r.text into revision_text
  from public.draft_revisions r
  where r.id = target_draft_revision_id
    and r.opportunity_id = target_opportunity_id
    and r.user_id = auth.uid();
  if draft_text is null or revision_text is null or draft_text <> revision_text then
    raise exception 'stale_draft_revision' using errcode = '23514';
  end if;
  if encode(extensions.digest(draft_text, 'sha256'), 'hex') <> target_draft_sha256 then
    raise exception 'stale_draft_hash' using errcode = '23514';
  end if;

  insert into public.delivery_records(
    opportunity_id, user_id, platform, platform_job_id, resume_mode,
    overall_status, draft_revision_id, draft_sha256, updated_at
  ) values (
    target_opportunity_id, auth.uid(), opportunity.platform, opportunity.platform_job_id,
    'platform_default', 'ready', target_draft_revision_id, target_draft_sha256, now()
  )
  on conflict (opportunity_id) do update
  set draft_revision_id = excluded.draft_revision_id,
      draft_sha256 = excluded.draft_sha256,
      overall_status = case
        when delivery_records.overall_status = 'succeeded' then 'succeeded'
        else delivery_records.overall_status
      end,
      updated_at = now()
  where delivery_records.user_id = auth.uid()
  returning * into record;

  return record;
end;
$$;

create or replace function public.reserve_delivery_daily_unit(
  target_opportunity_id uuid,
  target_request_id uuid,
  target_daily_limit integer default 150
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  usage_date date := (now() at time zone 'Asia/Shanghai')::date;
  used_count integer;
  reservation uuid;
begin
  if auth.uid() is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  if target_request_id is null or target_daily_limit < 1 or target_daily_limit > 500 then
    raise exception 'invalid_quota_request' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.delivery_records d
    where d.opportunity_id = target_opportunity_id
      and d.user_id = auth.uid()
      and d.overall_status <> 'succeeded'
  ) then
    raise exception 'delivery_not_prepared' using errcode = '23514';
  end if;
  select r.id into reservation
  from private.delivery_daily_reservations r
  where r.user_id = auth.uid() and r.platform = 'liepin' and r.opportunity_id = target_opportunity_id;
  if reservation is not null then
    return reservation;
  end if;

  perform pg_advisory_xact_lock(hashtext(auth.uid()::text || ':liepin:' || usage_date::text));
  select count(*) into used_count
  from private.delivery_daily_reservations r
  where r.user_id = auth.uid() and r.platform = 'liepin' and r.quota_day = usage_date;
  if used_count >= target_daily_limit then
    raise exception 'delivery_daily_limit_exceeded' using errcode = '23514';
  end if;
  insert into private.delivery_daily_reservations(user_id, platform, opportunity_id, quota_day, request_id)
  values (auth.uid(), 'liepin', target_opportunity_id, usage_date, target_request_id)
  returning id into reservation;
  update public.delivery_records
  set reservation_id = reservation,
      overall_status = 'in_progress',
      updated_at = now()
  where opportunity_id = target_opportunity_id and user_id = auth.uid();
  return reservation;
end;
$$;

create or replace function public.record_reviewed_delivery_attempt(
  target_opportunity_id uuid,
  target_request_id uuid,
  event_kind text,
  component_name text default null,
  component_status text default null,
  evidence_code text default 'observed',
  evidence_payload jsonb default '{}'::jsonb,
  reason_text text default null,
  target_draft_revision_id uuid default null,
  target_draft_sha256 text default null,
  target_reservation_id uuid default null
)
returns public.delivery_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  record public.delivery_records%rowtype;
  app_status text;
  greet_status text;
  next_overall text;
begin
  if auth.uid() is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  if target_request_id is null or char_length(evidence_code) not between 1 and 80 then
    raise exception 'invalid_delivery_attempt' using errcode = '23514';
  end if;
  select * into record
  from public.delivery_records d
  where d.opportunity_id = target_opportunity_id and d.user_id = auth.uid();
  if record.opportunity_id is null then
    raise exception 'delivery_not_found' using errcode = '42501';
  end if;

  insert into public.delivery_attempts(
    request_id, user_id, opportunity_id, event_kind, component_name, component_status,
    evidence_code, evidence, draft_revision_id, draft_sha256, reservation_id
  ) values (
    target_request_id, auth.uid(), target_opportunity_id, event_kind, component_name, component_status,
    evidence_code, coalesce(evidence_payload, '{}'::jsonb), target_draft_revision_id, target_draft_sha256, target_reservation_id
  ) on conflict (request_id) do nothing;

  app_status := record.application_status;
  greet_status := record.greeting_status;
  if component_name = 'application' and app_status <> 'verified' and component_status in ('attempted', 'verified', 'failed') then
    app_status := component_status;
  elsif component_name = 'greeting' and greet_status <> 'verified' and component_status in ('attempted', 'verified', 'failed') then
    greet_status := component_status;
  end if;

  next_overall := case
    when event_kind = 'delivery_preflighting' then 'preflighting'
    when event_kind = 'delivery_preflighted' then 'awaiting_confirmation'
    when event_kind = 'delivery_review_required' then 'review_required'
    when app_status = 'verified' and greet_status = 'verified' then 'succeeded'
    when app_status = 'verified' or greet_status = 'verified' then 'partial'
    when app_status = 'failed' or greet_status = 'failed' then 'failed'
    when app_status = 'attempted' or greet_status = 'attempted' or event_kind in ('delivery_confirmed', 'daily_unit_reserved') then 'in_progress'
    else record.overall_status
  end;

  update public.delivery_records
  set application_status = app_status,
      greeting_status = greet_status,
      overall_status = next_overall,
      latest_reason = left(coalesce(reason_text, latest_reason), 200),
      draft_revision_id = coalesce(target_draft_revision_id, draft_revision_id),
      draft_sha256 = coalesce(target_draft_sha256, draft_sha256),
      reservation_id = coalesce(target_reservation_id, reservation_id),
      updated_at = now()
  where opportunity_id = target_opportunity_id and user_id = auth.uid()
  returning * into record;
  return record;
end;
$$;

grant select on public.delivery_records, public.delivery_attempts to authenticated;
grant execute on function public.prepare_reviewed_delivery(uuid, uuid, text) to authenticated;
grant execute on function public.reserve_delivery_daily_unit(uuid, uuid, integer) to authenticated;
grant execute on function public.record_reviewed_delivery_attempt(uuid, uuid, text, text, text, text, jsonb, text, uuid, text, uuid) to authenticated;

create or replace function public.delete_my_product_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  delete from public.delivery_attempts where user_id = auth.uid();
  delete from public.delivery_records where user_id = auth.uid();
  delete from public.batch_items where user_id = auth.uid();
  delete from public.batch_runs where user_id = auth.uid();
  delete from public.job_opportunities where user_id = auth.uid();
  delete from public.filter_configs where user_id = auth.uid();
  delete from public.resume_profiles where user_id = auth.uid();
  delete from private.delivery_daily_reservations where user_id = auth.uid();
  delete from private.managed_usage where user_id = auth.uid();
end;
$$;
