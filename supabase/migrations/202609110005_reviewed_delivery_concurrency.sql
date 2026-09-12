create or replace function private.preserve_verified_delivery_components()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.application_status = 'verified' then new.application_status := 'verified'; end if;
  if old.greeting_status = 'verified' then new.greeting_status := 'verified'; end if;
  if new.application_status is distinct from old.application_status
    or new.greeting_status is distinct from old.greeting_status then
    new.overall_status := case
      when new.application_status = 'verified' and new.greeting_status = 'verified' then 'succeeded'
      when new.application_status = 'verified' or new.greeting_status = 'verified' then 'partial'
      when new.application_status = 'failed' or new.greeting_status = 'failed' then 'failed'
      when new.application_status = 'attempted' or new.greeting_status = 'attempted' then 'in_progress'
      else new.overall_status
    end;
  end if;
  return new;
end;
$$;

create trigger preserve_verified_delivery_components
before update on public.delivery_records
for each row execute function private.preserve_verified_delivery_components();

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

  select * into reservation
  from private.delivery_daily_reservations r
  where r.user_id = auth.uid()
    and r.platform = 'liepin'
    and r.opportunity_id = target_opportunity_id;
  if reservation.id is not null and reservation.released_at is null then
    return reservation.id;
  end if;

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
