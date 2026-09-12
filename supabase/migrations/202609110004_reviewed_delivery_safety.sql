alter table private.delivery_daily_reservations
  add column write_started_at timestamptz,
  add column released_at timestamptz;

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
  reservation private.delivery_daily_reservations%rowtype;
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

  select * into reservation
  from private.delivery_daily_reservations r
  where r.user_id = auth.uid()
    and r.platform = 'liepin'
    and r.opportunity_id = target_opportunity_id;
  if reservation.id is not null and reservation.released_at is null then
    return reservation.id;
  end if;

  perform pg_advisory_xact_lock(hashtext(auth.uid()::text || ':liepin:' || usage_date::text));
  select count(*) into used_count
  from private.delivery_daily_reservations r
  where r.user_id = auth.uid()
    and r.platform = 'liepin'
    and r.quota_day = usage_date
    and r.released_at is null;
  if used_count >= target_daily_limit then
    raise exception 'delivery_daily_limit_exceeded' using errcode = '23514';
  end if;

  if reservation.id is null then
    insert into private.delivery_daily_reservations(user_id, platform, opportunity_id, quota_day, request_id)
    values (auth.uid(), 'liepin', target_opportunity_id, usage_date, target_request_id)
    returning * into reservation;
  else
    update private.delivery_daily_reservations
    set quota_day = usage_date,
        request_id = target_request_id,
        write_started_at = null,
        released_at = null,
        created_at = now()
    where id = reservation.id and user_id = auth.uid()
    returning * into reservation;
  end if;

  update public.delivery_records
  set reservation_id = reservation.id,
      overall_status = 'in_progress',
      updated_at = now()
  where opportunity_id = target_opportunity_id and user_id = auth.uid();
  return reservation.id;
end;
$$;

create or replace function public.mark_delivery_write_started(
  target_opportunity_id uuid,
  target_reservation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  update private.delivery_daily_reservations r
  set write_started_at = coalesce(r.write_started_at, now())
  where r.id = target_reservation_id
    and r.opportunity_id = target_opportunity_id
    and r.user_id = auth.uid()
    and r.released_at is null;
  if not found then raise exception 'delivery_reservation_not_found' using errcode = '42501'; end if;
end;
$$;

create or replace function public.release_delivery_daily_unit(
  target_opportunity_id uuid,
  target_reservation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  update private.delivery_daily_reservations r
  set released_at = now()
  where r.id = target_reservation_id
    and r.opportunity_id = target_opportunity_id
    and r.user_id = auth.uid()
    and r.write_started_at is null
    and r.released_at is null;
  if not found then return false; end if;
  update public.delivery_records
  set reservation_id = null,
      overall_status = 'awaiting_confirmation',
      updated_at = now()
  where opportunity_id = target_opportunity_id
    and user_id = auth.uid()
    and reservation_id = target_reservation_id;
  return true;
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
  inserted_count integer;
begin
  if auth.uid() is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  if target_request_id is null
    or evidence_code !~ '^[a-z0-9_]{1,80}$'
    or event_kind not in (
      'delivery_preflighting', 'delivery_preflighted', 'delivery_review_required',
      'delivery_confirmed', 'daily_unit_reserved', 'daily_unit_released',
      'delivery_write_started', 'application_attempted', 'application_verified',
      'application_failed', 'greeting_attempted', 'greeting_verified',
      'greeting_failed', 'delivery_failed'
    ) then
    raise exception 'invalid_delivery_attempt' using errcode = '23514';
  end if;
  if jsonb_typeof(coalesce(evidence_payload, '{}'::jsonb)) <> 'object'
    or pg_column_size(coalesce(evidence_payload, '{}'::jsonb)) > 2048
    or exists (
      select 1
      from jsonb_object_keys(coalesce(evidence_payload, '{}'::jsonb)) as evidence_key(value)
      where value not in ('actionTier', 'resumeMode', 'codeCount', 'textLength')
    ) then
    raise exception 'invalid_delivery_evidence' using errcode = '23514';
  end if;

  select * into record
  from public.delivery_records d
  where d.opportunity_id = target_opportunity_id and d.user_id = auth.uid();
  if record.opportunity_id is null then
    raise exception 'delivery_not_found' using errcode = '42501';
  end if;
  if target_draft_revision_id is not null and target_draft_revision_id <> record.draft_revision_id then
    raise exception 'stale_delivery_revision' using errcode = '23514';
  end if;
  if target_draft_sha256 is not null and target_draft_sha256 <> record.draft_sha256 then
    raise exception 'stale_delivery_hash' using errcode = '23514';
  end if;
  if target_reservation_id is not null and not exists (
    select 1 from private.delivery_daily_reservations r
    where r.id = target_reservation_id
      and r.opportunity_id = target_opportunity_id
      and r.user_id = auth.uid()
  ) then
    raise exception 'delivery_reservation_not_found' using errcode = '42501';
  end if;

  insert into public.delivery_attempts(
    request_id, user_id, opportunity_id, event_kind, component_name, component_status,
    evidence_code, evidence, draft_revision_id, draft_sha256, reservation_id
  ) values (
    target_request_id, auth.uid(), target_opportunity_id, event_kind, component_name, component_status,
    evidence_code, coalesce(evidence_payload, '{}'::jsonb), target_draft_revision_id, target_draft_sha256, target_reservation_id
  ) on conflict (request_id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then
    select * into record
    from public.delivery_records d
    where d.opportunity_id = target_opportunity_id and d.user_id = auth.uid();
    return record;
  end if;

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
    when event_kind in ('delivery_review_required', 'delivery_failed') then 'review_required'
    when app_status = 'verified' and greet_status = 'verified' then 'succeeded'
    when app_status = 'verified' or greet_status = 'verified' then 'partial'
    when app_status = 'failed' or greet_status = 'failed' then 'failed'
    when app_status = 'attempted' or greet_status = 'attempted'
      or event_kind in ('delivery_confirmed', 'daily_unit_reserved', 'delivery_write_started') then 'in_progress'
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

grant execute on function public.mark_delivery_write_started(uuid, uuid) to authenticated;
grant execute on function public.release_delivery_daily_unit(uuid, uuid) to authenticated;
