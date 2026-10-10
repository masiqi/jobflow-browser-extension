-- Zhaopin uses the same owner-scoped opportunity and detail-history tables as
-- Liepin. Delivery tables intentionally remain Liepin-only until a separate
-- reviewed-send adapter is approved.

alter table public.job_opportunities
  drop constraint if exists job_opportunities_platform_check;
alter table public.job_opportunities
  add constraint job_opportunities_platform_check
  check (platform in ('liepin', 'zhaopin'));

alter table public.batch_runs
  drop constraint if exists batch_runs_platform_check;
alter table public.batch_runs
  add constraint batch_runs_platform_check
  check (platform in ('liepin', 'zhaopin'));

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
    item ->> 'platform',
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
    and item ->> 'platform' in ('liepin', 'zhaopin')
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

revoke all on function public.observe_job_opportunities(jsonb) from public, anon;
grant execute on function public.observe_job_opportunities(jsonb) to authenticated;
