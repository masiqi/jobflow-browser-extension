begin;
select plan(6);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000041',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'zhaopin@example.invalid', 'x',
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000041';

select lives_ok(
  $$select * from public.observe_job_opportunities('[{"platform":"zhaopin","platform_job_id":"CCLsyntheticJ001","canonical_url":"https://www.zhaopin.com/jobdetail/CCLsyntheticJ001.htm","title":"Synthetic Zhaopin role","company":"Synthetic company","location":"Beijing","salary":"20-30K","experience":"3-5 years","education":"Bachelor","card_text":"Synthetic card"}]'::jsonb)$$,
  'owner can observe a Zhaopin candidate through the shared RPC'
);
select is(
  (select count(*) from public.job_opportunities where platform = 'zhaopin'),
  1::bigint,
  'Zhaopin candidate is stored with its platform identity'
);
select is(
  (select platform_job_id from public.job_opportunities where platform = 'zhaopin'),
  'CCLsyntheticJ001',
  'Zhaopin full platform job ID is preserved'
);
select lives_ok(
  $$select public.record_job_details(
    (select id from public.job_opportunities where platform = 'zhaopin'),
    '00000000-0000-4000-8000-000000000141',
    '{"platform":"zhaopin","jobId":"CCLsyntheticJ001","description":"Synthetic Zhaopin detail description for durable read-only capture.","recruiter":"Synthetic recruiter","recruiterTitle":"Hiring partner"}'::jsonb,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )$$,
  'owner can persist Zhaopin detail through the shared detail RPC'
);
select is(
  (select description from public.job_opportunities where platform = 'zhaopin'),
  'Synthetic Zhaopin detail description for durable read-only capture.',
  'Zhaopin detail content remains available for later model processing'
);
select is(
  (select current_status from public.job_opportunities where platform = 'zhaopin'),
  'extracting',
  'Zhaopin detail capture enters the shared extracting state'
);

select * from finish();
rollback;
