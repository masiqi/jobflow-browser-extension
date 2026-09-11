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
isLiepinListPage(location: Location): boolean
scanLiepinList(root: ParentNode): ListCandidate[]
~~~

Stored-detail retry runtime command:

~~~typescript
{ type: "RETRY_STORED_OPPORTUNITY", opportunityId: string /* UUID */ }
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
record_job_details(target_opportunity_id, target_request_id, job, target_jd_hash)
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
- Stored-detail retry accepts only an opportunity UUID. JD text, profile data, model credentials, and status cannot be supplied by the page command.

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

Long-running UI commands:

- Enter a visible busy state before the first awaited client, storage, runtime, or model operation.
- Disable the initiating control while busy and guard the handler against duplicate programmatic invocation.
- Expose coarse stages through an inline `aria-live` status; do not invent percentages when provider progress is unknowable.
- Success names the completed domain result and next state. Failure remains visible, restores controls, and permits retry.
- A transient toast may supplement inline status but must not be the only feedback for a long-running operation.
- User-edited transient selections remain the UI source of truth across state notifications and re-renders; do not restore persisted scan-time defaults over them.
- Show the actual selected count separately from the configured upper limit, and submit exactly the selected IDs.
- Failed batch items and opportunity summaries expose their redacted local `error` / `latestReason` in the side panel.
- Running batches show the current item's domain stage; a completed-item fraction such as `0/1` is not sufficient feedback by itself.

Phase-owned timeouts:

- The detail-readiness alarm covers only the interval from opening the leased detail tab until a matching `DETAIL_READY` payload is accepted.
- Clear the detail-readiness alarm before deterministic filtering or any model request starts.
- Provider timeouts belong to the model gateway and must surface as model failures, never as detail-readiness failures.

Liepin list routes:

- Supported list routes are explicit: any Liepin host at `/zhaopin/`, plus the authenticated candidate homepage exactly at `https://c.liepin.com/`.
- Do not classify other `c.liepin.com` account, application-record, conversation, resume, or settings paths as list pages.
- Route acceptance only permits current-DOM extraction; it does not authorize scrolling, pagination, navigation, or host-page interaction.
- A completed zero-candidate scan is a visible result distinct from the initial unscanned state.

Liepin detail capture:

- Every adapter-produced `DetailJob` must pass `detailJobSchema` in its nearest fixture test; field assertions alone are insufficient.
- `DETAIL_READY` is acknowledged. A rejected acknowledgement becomes `DETAIL_FAILED` with the redacted boundary error instead of waiting for a timeout.
- After validation, persist the bounded description, recruiter fields, and SHA-256 hash through `record_job_details` before profile, rule, or model work.
- Store the full JD only in the owner-scoped opportunity row. The `details_captured` event contains only the hash and description length.
- The record center renders persisted detail data from Supabase and does not need to reopen Liepin.

Model:

- Managed and BYOK routes never silently fall back.
- Edge Functions build prompts and reload the active profile plus approved facts through caller-scoped RLS.
- Client-supplied profile text is not authoritative.
- Edge and client both validate evidence, fact IDs, structure, and greeting safety.
- BYOK values exist only in trusted Chrome storage and one Edge request scope.
- Diagnostics never contain credentials, Authorization, resume/JD text, prompts, or raw model output.
- Zod boundaries distinguish invalid request payload, trusted-data hydration, provider envelope, model JSON, model output schema, grounding, and persistence errors.
- A model-output-schema error may return only request ID, operation, provider/model, output kind, allowlisted expected field names and JSON types, missing fields, unknown-field count, and sanitized issue paths/codes.
- Unknown model-controlled field names and every field value are discarded before diagnostics are returned or logged.
- The background validates diagnostics again, persists a compact reason no longer than 200 characters, and logs the safe object under `[JobFlow:model-output-validation]` in the Service Worker Console.
- Provider prompts explicitly mirror runtime output contracts. Suitability names the `proceed` / `review` / `exclude` enum, optional 0-100 score, one-to-six reasons, zero-to-six JD excerpts (`exclude` requires at least one), and at most six approved fact IDs. Greeting names its 40-200 character limit, one-to-three JD excerpts, and one-to-two approved fact IDs.
- Every requested `jdEvidence` item is a verbatim contiguous excerpt from the stored description. Prompts forbid paraphrasing, summarization, and ellipsis; grounding validation remains strict.

Stored-detail retry:

- Only an owned `failed` opportunity with a non-empty persisted description is retryable.
- The background reloads the owner-scoped record and active profile, requires at least one approved fact, and verifies the selected managed/BYOK route before provider work.
- Reconstruct `DetailJob` only from `OpportunityRecord`; never accept JD/profile fields from the runtime command.
- Normal batch capture and stored retry call one shared post-detail function for deterministic rules, suitability validation, greeting validation, and Edge persistence.
- Stored retry never calls `chrome.tabs.create`, reads Liepin DOM, or changes the draft-only safety boundary.
- A downstream retry failure is recorded through `record_processing_failure`; success or failure refreshes the record center and leaves explicit inline feedback.

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
| Model output fails Zod schema | Return bounded allowlisted diagnostics; never return or log raw values |
| Provider prompt omits an enum/range enforced by Zod | Prompt-contract regression fails before release |
| Model JD evidence paraphrases or abbreviates source | Reject grounding; prompt requires a verbatim contiguous excerpt |
| Diagnostic payload fails browser schema | Ignore it and show the generic safe error |
| Unsafe/overlong/Markdown greeting | Reject before persistence |
| BYOK endpoint is HTTP/local/private/IP/credentialed | Reject before fetch |
| Provider redirects across origin | Reject without forwarding the key |
| Supabase config is absent | Show unavailable state; do not use legacy local authority |
| Supabase config is broad or partial | Fail build before clearing dist |
| Long-running UI command pending | Show stage, set `aria-busy`, disable trigger, and ignore duplicate invocation |
| Long-running UI command fails | Keep the error visible, clear busy state, and restore retry controls |
| User changes preview selection, then `RUN_UPDATED` renders | Preserve the user's IDs and show the same selected count |
| Batch item fails | Show its redacted local reason in batch and recent-record summaries |
| Batch item is not terminal | Show the current title and queued/opening/extracting/evaluating/generating stage |
| Matching leased detail payload is accepted | Clear the detail-readiness alarm before filtering/model work |
| Adapter detail has a schema-invalid field | Reject immediately and report `DETAIL_FAILED` with the boundary error |
| Valid matching detail is accepted | Persist owner-scoped JD/recruiter/hash before profile, rule, or model work |
| Repeated detail request ID | Update the projection idempotently and keep one `details_captured` event |
| `c.liepin.com/` candidate homepage | Accept as a current-DOM list route |
| Other `c.liepin.com` path | Reject as a list route without inspecting or operating account workflows |
| Accepted list route with zero recognized cards | Persist and show an explicit zero-result state; do not imply a scan never ran |
| Stored retry command includes JD/profile/extra fields | Reject as an invalid runtime message |
| Stored retry target is not owned, not failed, or has no JD | Reject before any model request |
| Stored retry has no active approved fact or selected route credential | Reject before provider work |
| Stored retry downstream model call fails | Persist a bounded safe reason, refresh UI, and restore retry |
| Stored retry succeeds | Persist evaluation/draft outcome and refresh UI without opening a platform tab |

### 5. Good/Base/Bad Cases

- Good: user A scans job 123, Edge reloads user A active profile through RLS, stores one evaluation and one evidence-backed draft, and user B sees none of it.
- Base: a signed-out/default build renders account setup and draft-only status but cannot start backend work.
- Good: the same platform job ID appears on another page; metadata updates and no model call repeats.
- Good: a model-excluded record receives a user_override event and generation-only processing while the original exclusion stays visible.
- Good: resume import immediately shows local parsing/storage/model stages and prevents a second import until completion.
- Good: the user explicitly scans `c.liepin.com/`; already-rendered job cards are extracted without operating the page.
- Good: a one-item user selection remains one checked item after batch status notifications, regardless of the scan's original default selection.
- Good: detail extraction clears its alarm, then a slow model request is governed only by the provider timeout.
- Good: runtime-valid detail is persisted before evaluation; a later provider failure leaves the JD visible in the record center.
- Bad: accept a profile object from the extension as approved truth.
- Good: a malformed `reasons` string reports `reasons:invalid_type`, request ID, and operation without including the string value.
- Good: a failed opportunity with captured JD is retried from its owner-scoped record and reaches `draft_ready` without reopening Liepin.
- Base: a valid stored retry produces a grounded exclusion or review; the UI reports the updated record rather than falsely claiming a draft.
- Bad: send stored JD or profile content in `RETRY_STORED_OPPORTUNITY`, or duplicate post-detail logic in the UI.
- Bad: rely on a Zod maximum that the provider prompt never states, or accept paraphrased evidence that cannot be located in the JD.
- Bad: store a raw BYOK string without ownerId or allow content-script storage access.
- Bad: update current_status directly from UI or delete the event that explains it.
- Bad: add https://*/* for custom providers; provider traffic leaves through the Edge Function.
- Bad: leave a button visually unchanged while awaiting a model request and rely on a completion toast as the only feedback.
- Bad: accept every path on `c.liepin.com` merely because the host is trusted.
- Bad: keep a detail-readiness alarm active while suitability or greeting models are running.
- Bad: assert a few extracted fields in a fixture without parsing the full adapter output through `detailJobSchema`.
- Bad: ignore an `{ ok: false }` response to `DETAIL_READY` and let the lease expire as a generic timeout.
- Bad: log provider `message.content`, arbitrary unknown output keys, Zod input values, or complete issue messages.

### 6. Tests Required

For every contract change, update the nearest focused test and rerun the full gates:

- tests/contracts.test.ts: RuntimeRequest and build/Endpoint schemas.
- tests/storage.test.ts: device owner, BYOK isolation, malformed persisted data.
- tests/domain.test.ts and tests/batch.test.ts: exhaustive projections and transitions.
- tests/filters.test.ts: clear, negative, optional/preferred, and ambiguous rule language.
- tests/prompt.test.ts and tests/resume.test.ts: evidence and content validation.
- tests/options-ui.test.ts: delayed long-running command feedback, duplicate blocking, failure recovery, and bulk fact approval.
- tests/sidepanel-ui.test.ts: recognizable scan command, pending/duplicate behavior, inline completion/failure, and zero-result state.
- tests/sidepanel-ui.test.ts: selection preservation across batch render, selected-count accuracy, and visible failure reasons.
- tests/contracts.test.ts: detail-readiness alarm clearing precedes deterministic and model processing.
- tests/liepin-content.test.ts: rejected `DETAIL_READY` acknowledgements become explicit detail failures.
- tests/options-ui.test.ts: persisted JD and recruiter metadata render without a platform tab.
- tests/model-diagnostics.test.ts: allowlisted shape summary, bounded formatting, and hostile-value/unknown-key non-disclosure.
- tests/prompt.test.ts: both client and real Edge prompts enumerate output cardinalities, discriminator values, and verbatim-evidence rules.
- tests/stored-retry.test.ts: strict owner/status/JD/profile/credential preconditions, shared processing, bounded failure persistence, and no `chrome.tabs.create`.
- tests/options-ui.test.ts: stored retry busy/duplicate/success/failure behavior and record refresh.
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

For platform detail adapters, the corresponding correct boundary is:

~~~typescript
const job = detailJobSchema.parse(extractLiepinDetail());
await recordJobDetails(opportunityId, requestId, job, await sourceHash(job.description));
~~~

Do not cast adapter output or wait until model persistence to save the JD; schema rejection and provider failure are independent states.

For stored retries, the corresponding boundary is:

~~~typescript
// Wrong: caller supplies untrusted content or opens the platform again.
await retry({ opportunityId, description, profile });
await chrome.tabs.create({ url: opportunity.canonicalUrl });

// Correct: background reloads trusted projections and shares post-detail processing.
const opportunity = await loadOwnedFailedOpportunity(opportunityId);
const job = detailJobSchema.parse(detailJobFromOpportunity(opportunity));
await processPostDetail(opportunity.id, job, settings, activeProfile);
~~~
