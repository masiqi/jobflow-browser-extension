create or replace function public.record_job_details(
  target_opportunity_id uuid,
  target_request_id uuid,
  job jsonb,
  target_jd_hash text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owned_opportunity_id uuid;
  description_text text := coalesce(job ->> 'description', '');
  recruiter_text text := coalesce(job ->> 'recruiter', '');
  recruiter_title_text text := coalesce(job ->> 'recruiterTitle', '');
begin
  if target_request_id is null
    or char_length(description_text) < 1
    or char_length(description_text) > 60000
    or char_length(recruiter_text) > 200
    or char_length(recruiter_title_text) > 200
    or target_jd_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_detail_payload' using errcode = '23514';
  end if;

  select o.id into owned_opportunity_id
  from public.job_opportunities o
  where o.id = target_opportunity_id
    and o.user_id = auth.uid()
    and o.platform = job ->> 'platform'
    and o.platform_job_id = job ->> 'jobId';
  if owned_opportunity_id is null then
    raise exception 'opportunity_not_found' using errcode = '42501';
  end if;

  update public.job_opportunities
  set description = description_text,
      recruiter = recruiter_text,
      recruiter_title = recruiter_title_text,
      jd_hash = target_jd_hash,
      current_status = 'extracting',
      latest_reason = '职位详情已读取',
      last_seen_at = now()
  where id = owned_opportunity_id and user_id = auth.uid();

  insert into public.opportunity_events(
    user_id, opportunity_id, kind, actor, payload, request_id
  ) values (
    auth.uid(), owned_opportunity_id, 'details_captured', 'system',
    jsonb_build_object(
      'jd_hash', target_jd_hash,
      'description_length', char_length(description_text)
    ),
    target_request_id
  )
  on conflict (opportunity_id, request_id, kind)
    where request_id is not null do nothing;
end;
$$;

revoke all on function public.record_job_details(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.record_job_details(uuid, uuid, jsonb, text) to authenticated;
