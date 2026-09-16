begin;
select plan(33);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'delivery-alpha@example.invalid', 'x', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'delivery-beta@example.invalid', 'x', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.job_opportunities (
  id, user_id, platform, platform_job_id, canonical_url, title, current_status
) values
  ('00000000-0000-4000-8000-000000000031', '00000000-0000-0000-0000-000000000031', 'liepin', 'delivery-job-1', 'https://www.liepin.com/job/31.shtml', 'Synthetic delivery role', 'draft_ready'),
  ('00000000-0000-4000-8000-000000000032', '00000000-0000-0000-0000-000000000032', 'liepin', 'delivery-job-2', 'https://www.liepin.com/job/32.shtml', 'Other synthetic delivery role', 'draft_ready'),
  ('00000000-0000-4000-8000-000000000033', '00000000-0000-0000-0000-000000000031', 'liepin', 'delivery-job-3', 'https://www.liepin.com/job/33.shtml', 'Synthetic pending role', 'failed'),
  ('00000000-0000-4000-8000-000000000035', '00000000-0000-0000-0000-000000000031', 'liepin', 'delivery-job-5', 'https://www.liepin.com/job/35.shtml', 'Synthetic recovering role', 'extracting'),
  ('00000000-0000-4000-8000-000000000036', '00000000-0000-0000-0000-000000000031', 'liepin', 'delivery-job-6', 'https://www.liepin.com/job/36.shtml', 'Synthetic unrelated extracting role', 'extracting');

insert into public.message_drafts(opportunity_id, user_id, current_text) values
  ('00000000-0000-4000-8000-000000000031', '00000000-0000-0000-0000-000000000031', 'Synthetic reviewed greeting.'),
  ('00000000-0000-4000-8000-000000000032', '00000000-0000-0000-0000-000000000032', 'Other reviewed greeting.'),
  ('00000000-0000-4000-8000-000000000035', '00000000-0000-0000-0000-000000000031', 'Recovering reviewed greeting.'),
  ('00000000-0000-4000-8000-000000000036', '00000000-0000-0000-0000-000000000031', 'Unprepared extracting greeting.');

insert into public.draft_revisions(id, request_id, user_id, opportunity_id, kind, text) values
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000051', '00000000-0000-0000-0000-000000000031', '00000000-0000-4000-8000-000000000031', 'generated', 'Synthetic reviewed greeting.'),
  ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000052', '00000000-0000-0000-0000-000000000032', '00000000-0000-4000-8000-000000000032', 'generated', 'Other reviewed greeting.'),
  ('00000000-0000-4000-8000-000000000045', '00000000-0000-4000-8000-000000000055', '00000000-0000-0000-0000-000000000031', '00000000-0000-4000-8000-000000000035', 'generated', 'Recovering reviewed greeting.'),
  ('00000000-0000-4000-8000-000000000046', '00000000-0000-4000-8000-000000000056', '00000000-0000-0000-0000-000000000031', '00000000-0000-4000-8000-000000000036', 'generated', 'Unprepared extracting greeting.');

insert into public.delivery_records(
  opportunity_id, user_id, platform, platform_job_id, resume_mode,
  overall_status, draft_revision_id, draft_sha256
) values (
  '00000000-0000-4000-8000-000000000035',
  '00000000-0000-0000-0000-000000000031',
  'liepin',
  'delivery-job-5',
  'platform_default',
  'ready',
  '00000000-0000-4000-8000-000000000045',
  encode(extensions.digest('Recovering reviewed greeting.', 'sha256'), 'hex')
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000031';

select lives_ok(
  $$select public.prepare_reviewed_delivery(
    '00000000-0000-4000-8000-000000000031',
    '00000000-0000-4000-8000-000000000041',
    encode(extensions.digest('Synthetic reviewed greeting.', 'sha256'), 'hex')
  )$$,
  'owner can prepare a current draft revision'
);
select is(
  (select overall_status from public.delivery_records where opportunity_id = '00000000-0000-4000-8000-000000000031'),
  'ready',
  'prepared delivery starts ready'
);
select lives_ok(
  $$select public.prepare_reviewed_delivery(
    '00000000-0000-4000-8000-000000000035',
    '00000000-0000-4000-8000-000000000045',
    encode(extensions.digest('Recovering reviewed greeting.', 'sha256'), 'hex')
  )$$,
  'an extracting projection with an exact current draft can recover for delivery'
);
select is(
  (select current_status from public.job_opportunities where id = '00000000-0000-4000-8000-000000000035'),
  'draft_ready',
  'delivery preparation repairs the extracting projection after exact draft validation'
);
select lives_ok(
  $$select public.record_reviewed_delivery_attempt(
    '00000000-0000-4000-8000-000000000035',
    '00000000-0000-4000-8000-000000000069',
    'delivery_confirmed',
    null,
    null,
    'automatic_batch_authorized',
    '{"source":"sidepanel_batch"}'::jsonb,
    null,
    '00000000-0000-4000-8000-000000000045',
    encode(extensions.digest('Recovering reviewed greeting.', 'sha256'), 'hex')
  )$$,
  'automatic batch authorization records its bounded source evidence'
);
select is(
  (select evidence ->> 'source' from public.delivery_attempts
    where request_id = '00000000-0000-4000-8000-000000000069'),
  'sidepanel_batch',
  'automatic batch source evidence is retained'
);
select throws_ok(
  $$select public.record_reviewed_delivery_attempt(
    '00000000-0000-4000-8000-000000000035',
    '00000000-0000-4000-8000-000000000070',
    'delivery_confirmed',
    null,
    null,
    'automatic_batch_authorized',
    '{"source":"untrusted_page"}'::jsonb
  )$$,
  '23514',
  null,
  'automatic authorization rejects an unrecognized source value'
);
select throws_ok(
  $$select public.record_reviewed_delivery_attempt(
    '00000000-0000-4000-8000-000000000035',
    '00000000-0000-4000-8000-000000000071',
    'delivery_confirmed',
    null,
    null,
    'automatic_batch_authorized',
    '{"source":"sidepanel_batch","unknown":"value"}'::jsonb
  )$$,
  '23514',
  null,
  'automatic authorization still rejects unknown evidence fields'
);
select throws_ok(
  $$select public.prepare_reviewed_delivery(
    '00000000-0000-4000-8000-000000000036',
    '00000000-0000-4000-8000-000000000046',
    encode(extensions.digest('Unprepared extracting greeting.', 'sha256'), 'hex')
  )$$,
  '23514',
  null,
  'an extracting projection without a prior exact delivery identity remains blocked'
);
select throws_ok(
  $$select public.prepare_reviewed_delivery(
    '00000000-0000-4000-8000-000000000033',
    '00000000-0000-4000-8000-000000000041',
    encode(extensions.digest('Synthetic reviewed greeting.', 'sha256'), 'hex')
  )$$,
  '23514',
  null,
  'non-draft-ready opportunity is rejected'
);
select throws_ok(
  $$select public.prepare_reviewed_delivery(
    '00000000-0000-4000-8000-000000000031',
    '00000000-0000-4000-8000-000000000041',
    repeat('b', 64)
  )$$,
  '23514',
  null,
  'stale draft hash is rejected'
);
select throws_ok(
  $$select public.prepare_reviewed_delivery(
    '00000000-0000-4000-8000-000000000032',
    '00000000-0000-4000-8000-000000000042',
    encode(extensions.digest('Other reviewed greeting.', 'sha256'), 'hex')
  )$$,
  '42501',
  null,
  'cross-user prepare is rejected'
);
select lives_ok(
  $$select public.record_reviewed_delivery_attempt(
    '00000000-0000-4000-8000-000000000031',
    '00000000-0000-4000-8000-000000000061',
    'delivery_preflighted',
    null,
    null,
    'preflight_ok'
  )$$,
  'preflight attempt can be recorded'
);
select is(
  (select overall_status from public.delivery_records where opportunity_id = '00000000-0000-4000-8000-000000000031'),
  'awaiting_confirmation',
  'preflight moves to awaiting confirmation'
);
select public.prepare_reviewed_delivery(
  '00000000-0000-4000-8000-000000000031',
  '00000000-0000-4000-8000-000000000041',
  encode(extensions.digest('Synthetic reviewed greeting.', 'sha256'), 'hex')
);
select is(
  (select overall_status from public.delivery_records where opportunity_id = '00000000-0000-4000-8000-000000000031'),
  'awaiting_confirmation',
  'reloading prepared identity preserves preflight state'
);
select is(
  public.reserve_delivery_daily_unit(
    '00000000-0000-4000-8000-000000000031',
    '00000000-0000-4000-8000-000000000062',
    1
  ) is not null,
  true,
  'quota reservation succeeds under limit'
);
select is(
  public.reserve_delivery_daily_unit(
    '00000000-0000-4000-8000-000000000031',
    '00000000-0000-4000-8000-000000000063',
    1
  ),
  (select reservation_id from public.delivery_records where opportunity_id = '00000000-0000-4000-8000-000000000031'),
  'same opportunity reuses reservation'
);
select is(
  public.release_delivery_daily_unit(
    '00000000-0000-4000-8000-000000000031',
    (select reservation_id from public.delivery_records where opportunity_id = '00000000-0000-4000-8000-000000000031')
  ),
  true,
  'an unused reservation can be released before the write boundary'
);
select is(
  public.reserve_delivery_daily_unit(
    '00000000-0000-4000-8000-000000000031',
    '00000000-0000-4000-8000-000000000068',
    1
  ) is not null,
  true,
  'a released opportunity can reserve again without consuming a second row'
);
select lives_ok(
  $$select public.mark_delivery_write_started(
    '00000000-0000-4000-8000-000000000031',
    (select reservation_id from public.delivery_records where opportunity_id = '00000000-0000-4000-8000-000000000031')
  )$$,
  'the reservation can be marked consumed immediately before a platform write'
);
select is(
  public.release_delivery_daily_unit(
    '00000000-0000-4000-8000-000000000031',
    (select reservation_id from public.delivery_records where opportunity_id = '00000000-0000-4000-8000-000000000031')
  ),
  false,
  'a reservation cannot be released after the write boundary'
);

reset role;
insert into public.job_opportunities (
  id, user_id, platform, platform_job_id, canonical_url, title, current_status
) values (
  '00000000-0000-4000-8000-000000000034', '00000000-0000-0000-0000-000000000031', 'liepin', 'delivery-job-4', 'https://www.liepin.com/job/34.shtml', 'Another delivery role', 'draft_ready'
);
insert into public.message_drafts(opportunity_id, user_id, current_text)
values ('00000000-0000-4000-8000-000000000034', '00000000-0000-0000-0000-000000000031', 'Another reviewed greeting.');
insert into public.draft_revisions(id, request_id, user_id, opportunity_id, kind, text)
values ('00000000-0000-4000-8000-000000000044', '00000000-0000-4000-8000-000000000054', '00000000-0000-0000-0000-000000000031', '00000000-0000-4000-8000-000000000034', 'generated', 'Another reviewed greeting.');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000031';
select public.prepare_reviewed_delivery(
  '00000000-0000-4000-8000-000000000034',
  '00000000-0000-4000-8000-000000000044',
  encode(extensions.digest('Another reviewed greeting.', 'sha256'), 'hex')
);
select throws_ok(
  $$select public.reserve_delivery_daily_unit(
    '00000000-0000-4000-8000-000000000034',
    '00000000-0000-4000-8000-000000000064',
    1
  )$$,
  '23514',
  null,
  'daily limit blocks a second opportunity before platform write'
);
select lives_ok(
  $$select public.record_reviewed_delivery_attempt(
    '00000000-0000-4000-8000-000000000031',
    '00000000-0000-4000-8000-000000000065',
    'application_verified',
    'application',
    'verified',
    'application_status_verified'
  )$$,
  'application verification is recorded'
);
select is(
  (select overall_status from public.delivery_records where opportunity_id = '00000000-0000-4000-8000-000000000031'),
  'partial',
  'one verified component is partial'
);
select lives_ok(
  $$select public.record_reviewed_delivery_attempt(
    '00000000-0000-4000-8000-000000000031',
    '00000000-0000-4000-8000-000000000066',
    'application_attempted',
    'application',
    'attempted',
    'native_action_attempted'
  )$$,
  'verified application is not downgraded by replay'
);
select is(
  (select application_status from public.delivery_records where opportunity_id = '00000000-0000-4000-8000-000000000031'),
  'verified',
  'verified application remains verified'
);
select lives_ok(
  $$select public.record_reviewed_delivery_attempt(
    '00000000-0000-4000-8000-000000000031',
    '00000000-0000-4000-8000-000000000065',
    'greeting_verified',
    'greeting',
    'verified',
    'outbound_greeting_exact_match'
  )$$,
  'a duplicate request id is an idempotent no-op even with changed arguments'
);
select is(
  (select greeting_status from public.delivery_records where opportunity_id = '00000000-0000-4000-8000-000000000031'),
  'pending',
  'duplicate request id cannot mutate another component projection'
);
select lives_ok(
  $$select public.record_reviewed_delivery_attempt(
    '00000000-0000-4000-8000-000000000031',
    '00000000-0000-4000-8000-000000000067',
    'greeting_verified',
    'greeting',
    'verified',
    'outbound_greeting_exact_match',
    '{"textLength":27}'::jsonb
  )$$,
  'greeting verification is recorded'
);
select is(
  (select overall_status from public.delivery_records where opportunity_id = '00000000-0000-4000-8000-000000000031'),
  'succeeded',
  'both independent components produce succeeded'
);

select lives_ok(
  $$select public.record_reviewed_delivery_attempt(
    '00000000-0000-4000-8000-000000000034',
    '00000000-0000-4000-8000-000000000072',
    'application_verified',
    'application',
    'verified',
    'application_click_assumed_success'
  )$$,
  'automatic development mode can persist an application click-assumed completion'
);
select lives_ok(
  $$select public.record_reviewed_delivery_attempt(
    '00000000-0000-4000-8000-000000000034',
    '00000000-0000-4000-8000-000000000073',
    'greeting_verified',
    'greeting',
    'verified',
    'greeting_click_assumed_success'
  )$$,
  'automatic development mode can persist a greeting click-assumed completion'
);
select is(
  (select overall_status from public.delivery_records where opportunity_id = '00000000-0000-4000-8000-000000000034'),
  'succeeded',
  'click-assumed components produce a terminal delivery record'
);

select * from finish();
rollback;
