# JobFlow Cross-Layer Contracts

## Scenario: Extend the JobFlow draft-only workflow

### 1. Scope / Trigger

Read this spec before changing any of:

- runtime message kinds or payloads;
- Chrome storage or IndexedDB records;
- opportunity, review, batch, profile, evaluation, or draft states;
- Supabase tables, RLS, grants, or RPCs;
- model routes, prompts, provider responses, or credentials;
- build-time Supabase configuration or manifest permissions;
- Liepin list/detail extraction.

These changes cross extension contexts and backend boundaries. A locally valid TypeScript type is not enough because content scripts, service workers, extension pages, PostgREST, Edge Functions, model providers, and persisted old data all exchange runtime values.

### 2. Signatures

Canonical TypeScript entry points:

~~~typescript
decodeRuntimeRequest(input: unknown): RuntimeRequest
projectOpportunity(initial: OpportunityRecord, events: OpportunityEvent[]): OpportunityRecord
evaluateRules(job: DetailJob, settings: JdRuleSettings): FilterDecision
parseSuitabilityDecision(raw: unknown, job: DetailJob, profile: ResumeProfile): SuitabilityDecision
parseGreetingDecision(raw: unknown, job: DetailJob, profile: ResumeProfile): GreetingDecision
~~~

Canonical user-scoped database commands:

~~~text
get_my_entitlement()
reserve_managed_model_request(target_request_id, operation_name)
settle_managed_model_request(target_request_id, target_provider_units)
save_draft_resume_profile(profile)
activate_resume_profile(target_profile_id)
save_filter_config(filter_config)
observe_job_opportunities(observations)
record_filter_result(target_opportunity_id, target_request_id, job, filter_result)
record_evaluation_result(target_opportunity_id, target_request_id, job, profile_id, output, route, provider_name, model_name)
record_greeting_result(target_opportunity_id, target_request_id, profile_id, output, route, provider_name, model_name)
record_processing_failure(target_opportunity_id, target_request_id, error_code)
append_user_opportunity_event(target_opportunity_id, event_kind, event_payload)
edit_my_draft(target_opportunity_id, target_request_id, draft_text)
delete_my_product_data()
~~~

### 3. Contracts

Runtime requests:

- Decode unknown once in src/domain/messages.ts.
- Use a discriminated type field.
- Reject unknown fields with strict Zod objects.
- No current request contains mode, live, send, apply, click, upload, scroll, or pagination behavior.
- Content scan returns sourceUrl plus at most 500 decoded list candidates.
- A batch accepts 1 through 20 selected platform job IDs.

Opportunity identity:

- The database key is user_id + platform + platform_job_id.
- No URL, title, company, recruiter, hash, or similarity participates.
- Processing RPCs verify that job.platform and job.jobId match the owned record.

State:

- opportunity_events is append-only.
- Client roles cannot directly insert events or edit current_status.
- Named RPCs validate the prior state and derive the next state.
- Request IDs make processing event and revision retries idempotent.
- An LLM exclusion blocks automatic reevaluation by identity; user_override adds an exception without deleting the exclusion.

Auth and local storage:

- One Supabase client exists in the background service worker.
- chrome.storage.local and session access levels are TRUSTED_CONTEXTS.
- Content scripts never access Chrome storage, tokens, BYOK credentials, or source resumes.
- BYOK records contain ownerId and value and are returned only for that owner.
- A device-owner change clears settings, run, scan, and BYOK state.
- IndexedDB resume keys contain user ID and source hash.

Model:

- Managed and BYOK routes never silently fall back.
- Edge Functions build prompts and reload the active profile plus approved facts through caller-scoped RLS.
- Client-supplied profile text is not authoritative.
- Edge and client both validate evidence, fact IDs, structure, and greeting safety.
- BYOK values exist only in trusted Chrome storage and one Edge request scope.
- Diagnostics never contain credentials, Authorization, resume/JD text, prompts, or raw model output.

Environment:

~~~text
JOBFLOW_SUPABASE_URL                  public build input
JOBFLOW_SUPABASE_PUBLISHABLE_KEY      public build input
MANAGED_MODEL_ENDPOINT                Edge secret/config
MANAGED_MODEL_PROVIDER                Edge secret/config
MANAGED_MODEL_NAME                    Edge secret/config
MANAGED_MODEL_API_KEY                 Edge secret
~~~

The build accepts only one exact supabase.co origin or http://127.0.0.1:54321 and requires URL/key together. It never accepts a broad host.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Unknown/extra runtime field | Reject before command dispatch |
| Missing or malformed persisted run/scan | Return null; do not resume |
| Content script requests storage/token | No API exists; storage is TRUSTED_CONTEXTS |
| User ID changes on current Chrome profile | Clear previous device settings, run, scan, and BYOK |
| Cross-user table/RPC access | RLS or ownership check returns 42501 |
| Job identity differs from RPC record | Reject with owned-input/job-identity error |
| Repeated processing request ID | No duplicate event/evaluation/revision |
| Second suitability result for same job ID | Preserve the first evaluation |
| Rule/model/user exclusion in automatic scan | Do not reopen details or invoke model |
| Explicit user override on non-excluded state | Reject transition |
| Model cites absent JD evidence | Reject model result |
| Model cites unapproved fact | Reject model result |
| Unsafe/overlong/Markdown greeting | Reject before persistence |
| BYOK endpoint is HTTP/local/private/IP/credentialed | Reject before fetch |
| Provider redirects across origin | Reject without forwarding the key |
| Supabase config is absent | Show unavailable state; do not use legacy local authority |
| Supabase config is broad or partial | Fail build before clearing dist |

### 5. Good/Base/Bad Cases

- Good: user A scans job 123, Edge reloads user A active profile through RLS, stores one evaluation and one evidence-backed draft, and user B sees none of it.
- Base: a signed-out/default build renders account setup and draft-only status but cannot start backend work.
- Good: the same platform job ID appears on another page; metadata updates and no model call repeats.
- Good: a model-excluded record receives a user_override event and generation-only processing while the original exclusion stays visible.
- Bad: accept a profile object from the extension as approved truth.
- Bad: store a raw BYOK string without ownerId or allow content-script storage access.
- Bad: update current_status directly from UI or delete the event that explains it.
- Bad: add https://*/* for custom providers; provider traffic leaves through the Edge Function.

### 6. Tests Required

For every contract change, update the nearest focused test and rerun the full gates:

- tests/contracts.test.ts: RuntimeRequest and build/Endpoint schemas.
- tests/storage.test.ts: device owner, BYOK isolation, malformed persisted data.
- tests/domain.test.ts and tests/batch.test.ts: exhaustive projections and transitions.
- tests/filters.test.ts: clear, negative, optional/preferred, and ambiguous rule language.
- tests/prompt.test.ts and tests/resume.test.ts: evidence and content validation.
- tests/liepin.test.ts: sanitized list/detail/login/risk DOM.
- tests/safety.test.ts: exact manifest, no host writes, no personal defaults.
- supabase/tests: owner success, cross-user failure, protected columns, RPC state guards, identity, idempotency, deletion.
- scripts/test-supabase-integration.mjs: local JWT to Edge to RPC to RLS round trip.
- scripts/smoke-extension.mjs: temporary-profile Chrome registration, management page, side panel, launcher, and overflow checks.

Required gates:

~~~text
npm run verify
supabase db reset
supabase test db
supabase db lint --schema public,private --level warning --fail-on error
npm run test:edge with local-only public configuration
npm run smoke:extension with local-only public configuration
git diff --check
~~~

### 7. Wrong vs Correct

Wrong:

~~~typescript
const request = message as RuntimeRequest;
current.status = request.status;
await chrome.storage.local.set({ byok: request.apiKey });
~~~

This trusts an external payload, permits arbitrary status changes, and creates an ownerless credential visible to content contexts.

Correct:

~~~typescript
const request = decodeRuntimeRequest(message);
await appendUserEvent(request.opportunityId, "user_override", {
  reason: "用户选择作为例外继续"
});
await setByokKey(request.apiKey, request.remember, authenticatedUserId);
~~~

The decoder owns the payload contract, the named transition preserves history, and local credentials remain bound to the authenticated device owner.
