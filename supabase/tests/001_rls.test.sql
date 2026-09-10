begin;
select plan(25);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alpha@example.invalid', 'x', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'beta@example.invalid', 'x', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.job_opportunities (
  user_id, platform, platform_job_id, canonical_url, title
) values
  ('00000000-0000-0000-0000-000000000001', 'liepin', 'job-1', 'https://www.liepin.com/job/1.shtml', 'Synthetic role'),
  ('00000000-0000-0000-0000-000000000002', 'liepin', 'job-2', 'https://www.liepin.com/job/2.shtml', 'Other synthetic role');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

select is(
  (select count(*) from public.profiles),
  1::bigint,
  'user sees only own profile'
);
select is(
  (select email_verification_status from public.profiles),
  'unverified',
  'new profile starts with unverified email state'
);
select is(
  (select count(*) from public.job_opportunities),
  1::bigint,
  'user sees only own opportunity'
);
select is(
  public.reserve_managed_model_request(
    '00000000-0000-4000-8000-000000000077',
    'synthetic-test'
  ),
  false,
  'non-entitled user cannot reserve managed model quota'
);
select throws_ok(
  $$insert into public.job_opportunities(user_id, platform, platform_job_id, canonical_url)
    values ('00000000-0000-0000-0000-000000000002', 'liepin', 'forged', 'https://www.liepin.com/job/3.shtml')$$,
  '42501',
  null,
  'user cannot insert for another owner'
);
select throws_ok(
  $$insert into public.job_opportunities(user_id, platform, platform_job_id, canonical_url)
    values ('00000000-0000-0000-0000-000000000001', 'liepin', 'direct-own', 'https://www.liepin.com/job/4.shtml')$$,
  '42501',
  null,
  'user must use the named observation command even for own records'
);
select throws_ok(
  $$select * from private.user_entitlements$$,
  '42501',
  null,
  'authenticated user cannot access private entitlements'
);
select throws_ok(
  $$update public.profiles set email_verification_status = 'verified'
    where user_id = '00000000-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'user cannot change protected verification state'
);
select throws_ok(
  $$insert into public.opportunity_events(user_id, opportunity_id, kind, actor)
    select user_id, id, 'user_override', 'user' from public.job_opportunities limit 1$$,
  '42501',
  null,
  'user cannot insert raw events'
);
select throws_ok(
  $$select public.append_user_opportunity_event(
    (select id from public.job_opportunities where platform_job_id = 'job-1'),
    'user_override',
    '{"reason":"invalid early override"}'::jsonb
  )$$,
  '23514',
  null,
  'user cannot override a non-excluded opportunity'
);
select lives_ok(
  $$select public.record_filter_result(
    (select id from public.job_opportunities where platform_job_id = 'job-1'),
    '00000000-0000-4000-8000-000000000099',
    '{"platform":"liepin","jobId":"job-1","description":"Synthetic description","recruiter":"","recruiterTitle":""}'::jsonb,
    '{"outcome":"exclude","decisions":[{"reason":"Synthetic rule"}]}'::jsonb
  )$$,
  'owner can record a deterministic result'
);
select lives_ok(
  $$select public.record_filter_result(
    (select id from public.job_opportunities where platform_job_id = 'job-1'),
    '00000000-0000-4000-8000-000000000099',
    '{"platform":"liepin","jobId":"job-1","description":"Synthetic description","recruiter":"","recruiterTitle":""}'::jsonb,
    '{"outcome":"exclude","decisions":[{"reason":"Synthetic rule"}]}'::jsonb
  )$$,
  'repeating the same request is idempotent'
);
select is(
  (select count(*) from public.opportunity_events
    where request_id = '00000000-0000-4000-8000-000000000099'),
  1::bigint,
  'idempotent request creates one event'
);
select is(
  public.append_user_opportunity_event(
    (select id from public.job_opportunities where platform_job_id = 'job-1'),
    'user_override',
    '{"reason":"synthetic override"}'::jsonb
  ) is not null,
  true,
  'excluded opportunity accepts an explicit user override'
);
select lives_ok(
  $$select public.save_draft_resume_profile(
    '{
      "id":"00000000-0000-4000-8000-000000000088",
      "version":1,
      "state":"draft",
      "sourceHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "sourceName":"synthetic.txt",
      "sourceKind":"text",
      "summary":"Synthetic profile",
      "targetRoles":[],
      "skills":[],
      "constraints":[],
      "analyzedAt":"2026-01-01T00:00:00.000Z",
      "facts":[{
        "id":"fact-1",
        "text":"Synthetic fact",
        "keywords":[],
        "evidence":"Synthetic evidence",
        "approved":false
      }]
    }'::jsonb
  )$$,
  'atomic resume import creates a draft profile'
);
select is(
  (select count(*) from public.resume_profiles p
    join public.resume_facts f on f.profile_id = p.id
    where p.id = '00000000-0000-4000-8000-000000000088'
      and p.state = 'draft'),
  1::bigint,
  'draft profile and facts are visible to the owner'
);
select is(
  (select current_status from public.job_opportunities where platform_job_id = 'job-1'),
  'generating',
  'user override updates the current projection'
);
select throws_ok(
  $$select public.record_filter_result(
    (select id from public.job_opportunities where platform_job_id = 'job-1'),
    '00000000-0000-4000-8000-000000000098',
    '{"platform":"liepin","jobId":"different-job","description":"Synthetic","recruiter":"","recruiterTitle":""}'::jsonb,
    '{"outcome":"exclude","decisions":[{"reason":"Synthetic"}]}'::jsonb
  )$$,
  '42501',
  null,
  'processing command cannot substitute another platform job identity'
);
reset role;
select throws_ok(
  $$insert into public.job_opportunities(user_id, platform, platform_job_id, canonical_url)
    values ('00000000-0000-0000-0000-000000000001', 'liepin', 'job-1', 'https://www.liepin.com/job/1-again.shtml')$$,
  '23505',
  null,
  'platform job identity is unique per user'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.save_filter_config('{"version":1,"travel":"disabled"}'::jsonb)$$,
  'user can save a filter configuration'
);
select lives_ok(
  $$select public.save_filter_config('{"version":1,"travel":"none"}'::jsonb)$$,
  'saving changed filters creates another version'
);
select is(
  (select count(*) from public.filter_configs),
  2::bigint,
  'filter history keeps both versions'
);
select is(
  (select version from public.filter_configs where active),
  2,
  'only the latest filter version is active'
);
select lives_ok(
  $$select public.delete_my_product_data()$$,
  'user can delete own product data'
);
select is(
  (select count(*) from public.job_opportunities)
    + (select count(*) from public.resume_profiles)
    + (select count(*) from public.filter_configs),
  0::bigint,
  'product data deletion removes the owner projections'
);

select * from finish();
rollback;
