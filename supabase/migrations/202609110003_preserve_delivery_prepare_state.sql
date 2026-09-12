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
