begin;
select plan(13);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'detail-alpha@example.invalid', 'x', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'detail-beta@example.invalid', 'x', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.job_opportunities (
  id, user_id, platform, platform_job_id, canonical_url, title, current_status
) values
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-0000-0000-000000000011', 'liepin', 'detail-job-1', 'https://www.liepin.com/job/11.shtml', 'Synthetic detail role', 'discovered'),
  ('00000000-0000-4000-8000-000000000022', '00000000-0000-0000-0000-000000000012', 'liepin', 'detail-job-2', 'https://www.liepin.com/job/12.shtml', 'Other synthetic detail role', 'discovered'),
  ('00000000-0000-4000-8000-000000000023', '00000000-0000-0000-0000-000000000011', 'liepin', 'detail-job-3', 'https://www.liepin.com/job/13.shtml', 'Synthetic drafted detail role', 'draft_ready');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';

select lives_ok(
  $$select public.record_job_details(
    '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000111',
    '{"platform":"liepin","jobId":"detail-job-1","description":"Synthetic bounded job description for durable detail capture.","recruiter":"Synthetic recruiter","recruiterTitle":"Hiring partner"}'::jsonb,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )$$,
  'owner can persist a validated matching detail'
);
select is(
  (select description from public.job_opportunities where platform_job_id = 'detail-job-1'),
  'Synthetic bounded job description for durable detail capture.',
  'detail description is persisted'
);
select is(
  (select recruiter || ' / ' || recruiter_title from public.job_opportunities where platform_job_id = 'detail-job-1'),
  'Synthetic recruiter / Hiring partner',
  'recruiter metadata is persisted'
);
select is(
  (select jd_hash from public.job_opportunities where platform_job_id = 'detail-job-1'),
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'JD hash is persisted'
);
select is(
  (select current_status from public.job_opportunities where platform_job_id = 'detail-job-1'),
  'extracting',
  'detail capture advances the projection to extracting'
);
select is(
  (select payload ? 'description' from public.opportunity_events
    where request_id = '00000000-0000-4000-8000-000000000111'),
  false,
  'detail event does not duplicate the JD text'
);
select lives_ok(
  $$select public.record_job_details(
    '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000111',
    '{"platform":"liepin","jobId":"detail-job-1","description":"Synthetic bounded job description for durable detail capture.","recruiter":"Synthetic recruiter","recruiterTitle":"Hiring partner"}'::jsonb,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )$$,
  'repeating the detail request is idempotent'
);
select is(
  (select count(*) from public.opportunity_events
    where request_id = '00000000-0000-4000-8000-000000000111'),
  1::bigint,
  'idempotent detail request creates one event'
);
select lives_ok(
  $$select public.record_job_details(
    '00000000-0000-4000-8000-000000000023',
    '00000000-0000-4000-8000-000000000115',
    '{"platform":"liepin","jobId":"detail-job-3","description":"Synthetic refreshed detail for a drafted opportunity.","recruiter":"","recruiterTitle":""}'::jsonb,
    'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
  )$$,
  'detail refresh accepts an already drafted opportunity'
);
select is(
  (select current_status from public.job_opportunities where platform_job_id = 'detail-job-3'),
  'draft_ready',
  'detail refresh does not regress a drafted projection to extracting'
);
select throws_ok(
  $$select public.record_job_details(
    '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000112',
    '{"platform":"liepin","jobId":"substituted-job","description":"Synthetic description","recruiter":"","recruiterTitle":""}'::jsonb,
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  )$$,
  '42501',
  null,
  'detail command rejects a substituted job identity'
);
select throws_ok(
  $$select public.record_job_details(
    '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000113',
    '{"platform":"liepin","jobId":"detail-job-1","description":"Synthetic description","recruiter":"","recruiterTitle":""}'::jsonb,
    'invalid-hash'
  )$$,
  '23514',
  null,
  'detail command rejects an invalid JD hash'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000012';
select throws_ok(
  $$select public.record_job_details(
    '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000114',
    '{"platform":"liepin","jobId":"detail-job-1","description":"Synthetic description","recruiter":"","recruiterTitle":""}'::jsonb,
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  )$$,
  '42501',
  null,
  'another user cannot persist details for an unowned opportunity'
);

select * from finish();
rollback;
