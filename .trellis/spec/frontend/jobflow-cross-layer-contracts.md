# JobFlow Cross-Layer Contracts

## Scenario: Extend the JobFlow draft and reviewed-send workflow

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

Batch runtime command:

~~~typescript
{ type: "START_BATCH", selectedJobIds: string[], expectedExecutionPolicy: "draft_only" | "reviewed_send" | "automatic_send" }
~~~

Detail capture lease handshake:

~~~typescript
{ type: "DETAIL_PAGE_READY", jobId: string }
{
  type: "DETAIL_FAILED";
  code: "login_required" | "risk_control" | "job_unavailable" | "detail_rejected" | "dom_timeout" | "unexpected_redirect";
  jobId: string;
  leaseId: string;
  error: string;
}
~~~

Automatic execution settings and current-device throttle:

~~~typescript
{
  executionPolicy: "draft_only" | "reviewed_send" | "automatic_send";
  automaticSendDelayMinSeconds: number; // integer, 5-600, default 10
  automaticSendDelayMaxSeconds: number; // integer, 5-600, default 20, >= min
}
{
  ownerId: string;
  platform: "liepin";
  lastWriteStartedAt: string;
  scheduledDelaySeconds: number;
  nextWriteEligibleAt: string;
}
{
  ownerId: string;
  platform: "liepin";
  lastNavigationStartedAt: string;
  scheduledDelaySeconds: number; // current product constants: 15-30
  nextNavigationEligibleAt: string;
}
~~~

Reviewed-send runtime commands:

~~~typescript
{ type: "PREPARE_REVIEWED_SEND", opportunityId, draftRevisionId, draftSha256 }
{ type: "CONFIRM_REVIEWED_SEND", opportunityId, draftRevisionId, draftSha256 }
{ type: "CONTENT_REVIEWED_SEND_PREFLIGHT", leaseId, platformJobId }
{ type: "CONTENT_REVIEWED_SEND_EXECUTE", leaseId, platformJobId, draftText, draftSha256, needsApplication, needsGreeting }
~~~

Observed Liepin IM surface contract:

~~~text
.im-ui-chat-input
  -> exactly one visible textarea.im-ui-textarea
  -> exactly one visible .im-ui-basic-send-btn
.im-ui-chat-container
  -> owns the input and sibling message list used for greeting read-back
.im-ui-message-list-wrapper
  -> contains .im-ui-msg-list-content and rendered message rows
.im-ui-txt.im-ui-send
  -> a platform-owned outbound text row; Liepin maps message direction "0" to this class
chat surface discovery timeout: 15 seconds
outbound greeting evidence wait: 15 seconds
search roots: top document + open ShadowRoot + accessible same-origin iframe Document
cross-origin iframe: ignored; no frame permissions or cross-origin DOM access
disabled send control: rendered surface remains discoverable; interactivity is checked after draft input
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
prepare_reviewed_delivery(target_opportunity_id, target_draft_revision_id, target_draft_sha256)
reserve_delivery_daily_unit(target_opportunity_id, target_request_id, target_daily_limit)
mark_delivery_write_started(target_opportunity_id, target_reservation_id)
release_delivery_daily_unit(target_opportunity_id, target_reservation_id)
record_reviewed_delivery_attempt(target_opportunity_id, target_request_id, event_kind, component_name, component_status, evidence_code, evidence_payload, reason_text, target_draft_revision_id, target_draft_sha256, target_reservation_id)
append_user_opportunity_event(target_opportunity_id, event_kind, event_payload)
edit_my_draft(target_opportunity_id, target_request_id, draft_text)
delete_my_product_data()
~~~

### 3. Contracts

Runtime requests:

- Decode unknown once in src/domain/messages.ts.
- Use a discriminated type field.
- Reject unknown fields with strict Zod objects.
- Live behavior exists only in strict reviewed-send prepare/confirm commands or in a side-panel `automatic_send` batch whose selected IDs and execution policy were explicitly authorized at start. Page-load, scan, settings save, startup, scroll, pagination, upload, and free-form platform commands cannot write to Liepin.
- Content scan returns sourceUrl plus at most 500 decoded list candidates.
- A batch accepts 1 through 20 selected platform job IDs. Batch start is accepted only from the exact extension side panel URL, must include the expected execution policy, must match trusted settings, and must fail if another queued/running/paused run already exists.
- Stored-detail retry accepts only an opportunity UUID. JD text, profile data, model credentials, and status cannot be supplied by the page command.
- Detail-page lease handshake accepts only a platform job ID from a trusted Liepin content sender. It returns the current extension-owned item lease only when sender tab ID, sender URL, current batch item, current job ID, item status, and run status match. It returns no lease for user-opened details, options/sidepanel callers, wrong tabs/jobs, historical items, completed/cancelled runs, or non-Liepin origins.
- Reviewed-send initiation is accepted only from the exact extension options page and carries opportunity/revision/hash identity, never caller-supplied message or JD content.
- Automatic delivery is accepted only for the current item in a newly authorized `automatic_send` run after detail capture and model-generated draft identity are persisted in the run snapshot. Historical drafts and user overrides remain reviewed-send only.
- Content execution requires the same successful, unexpired, job-bound preflight lease and rechecks the SHA-256 of `draftText` before any platform action.
- Every Liepin live write, reviewed or automatic, must acquire the shared non-reentrant live-write mutex before quota/write-start/content execution. Duplicate queue alarms, duplicate button paths, or overlapping service-worker continuations may reschedule or fail closed, but they must not overlap or double-execute a platform write.
- Automatic authorization uses exactly `event_kind=delivery_confirmed`, `evidence_code=automatic_batch_authorized`, and `evidence_payload={"source":"sidepanel_batch"}`. The RPC accepts `source` only for that combination and rejects missing, alternate, or additional source metadata.

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
- Delivery state is separate from draft opportunity state. Application and greeting each use pending/attempted/verified/failed; overall state is derived and reaches succeeded only when both are verified.
- Verified components cannot be downgraded or replayed. A repeated delivery request ID is a complete no-op even if its arguments differ.
- A partial or post-write review reason is derived from both component states (including the verified component and the missing component); the most recent component event must not hide which component still needs evidence.

Auth and local storage:

- One Supabase client exists in the background service worker.
- chrome.storage.local and session access levels are TRUSTED_CONTEXTS.
- Persisted settings, scan previews, and batch runs are parsed with their canonical strict schema before writing and after reading; an invalid mutation must fail at the write boundary instead of poisoning recoverable state.
- `BatchItem.candidate` stores only the `ListCandidate` snapshot. Accepted `DetailJob` fields belong in the owner-scoped opportunity record and must not be merged into the batch candidate.
- Automatic interval alarms are derived from the persisted batch run and persisted owner/platform throttle. An alarm for a missing, non-running, mismatched, paused, cancelled, or replaced run is stale and must be ignored without scheduling queue processing or touching quota/write state.
- Liepin detail navigation has a separate owner/platform device throttle. It persists across batches, Reload, and service-worker suspension, is cleared on owner/product-data reset, and currently samples one 15-30 second gap immediately before each extension-owned detail navigation. The first navigation without prior throttle may start immediately.
- A batch waiting for navigation stores `waiting_navigation` plus the authoritative `nextNavigationEligibleAt`. Early alarms reuse the same timestamp; elapsed waits clear it and sample the following gap before opening the tab.
- Content scripts never access Chrome storage, tokens, BYOK credentials, or source resumes.
- BYOK records contain ownerId and value and are returned only for that owner.
- A device-owner change clears settings, run, scan, automatic-write throttle, and BYOK state.
- IndexedDB resume keys contain user ID and source hash.

Long-running UI commands:

- Enter a visible busy state before the first awaited client, storage, runtime, or model operation.
- The initiating button itself must disable, set `aria-busy`, and change to an action-specific progress label synchronously. Inline status supplements the button; it does not replace this immediate acknowledgement.
- Disable the initiating control while busy and guard the handler against duplicate programmatic invocation.
- User-requested generation is also single-flight per opportunity in the background so duplicate extension pages or runtime messages cannot create parallel draft revisions.
- Expose coarse stages through an inline `aria-live` status; do not invent percentages when provider progress is unknowable.
- Success names the completed domain result and next state. Failure remains visible, restores controls, and permits retry.
- A transient toast may supplement inline status but must not be the only feedback for a long-running operation.
- User-edited transient selections remain the UI source of truth across state notifications and re-renders; do not restore persisted scan-time defaults over them.
- Show the actual selected count separately from the configured upper limit, and submit exactly the selected IDs.
- Failed batch items and opportunity summaries expose their redacted local `error` / `latestReason` in the side panel.
- Running batches show the current item's domain stage; a completed-item fraction such as `0/1` is not sufficient feedback by itself.
- Automatic wait countdown rendering is client-side display only. Re-rendering the side panel or updating the countdown must not redraw intervals, consume quota, run preflight, or trigger content execution.

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
- `DETAIL_FAILED.code` is a strict finite classification. Content-controlled text cannot choose whether an automatic batch pauses or advances.
- A platform-owned `.stop-apply-header` stating that recruitment is paused, stopped, offline, expired, or missing is `job_unavailable`. Record the bounded reason, mark the item failed, and advance without model, quota, or platform write. Login, risk control, schema rejection, and unknown DOM timeout remain recoverable blockers that pause an automatic batch.
- A detail content script may use the URL hash lease fast path, but must fall back to a bounded `DETAIL_PAGE_READY` handshake when the final Liepin URL has no valid lease hash. The handshake itself must not scan, model, reserve quota, preflight delivery, or execute any platform action.
- A Liepin risk redirect may replace the detail pathname with a `safe.liepin.com` intercept or SMS-verification route. Content recovers only an HTTPS Liepin `/job|a/<id>.shtml` identity from the redirect's `backurl`; background returns a lease only when extension ID, sender tab, current item, job ID, and run state all match.
- The platform-owned title `安全中心-风险提示` and known `safe.liepin.com` intercept/verification routes are `risk_control` even when the body has not rendered. They report immediately instead of falling through to the detail watchdog.
- Login and risk blockers pause before write, clear the detail alarm, detach the tab from automatic ownership, activate it, and leave it open for the user. JobFlow never fills, submits, or bypasses the verification flow; resume remains an explicit user command.
- Normal terminal detail handling waits until the extension-owned tab has existed for at least 8 seconds before closing it. Longer model/filter processing naturally satisfies this dwell; risk/login handoff is not closed by this mechanism.
- Chrome Reload invalidates already-injected content-script contexts while their pending promises and page event listeners may still resume. Every outbound content-to-background message must use one runtime wrapper that checks for a live `chrome.runtime.sendMessage` immediately before the call and catches invalidation during the call.
- A missing runtime or `Extension context invalidated` rejection stops the stale content operation without retry, user-facing failure, or unhandled promise rejection. Other transport errors remain bounded and visible, and an acknowledged `{ ok: false }` remains a protocol failure rather than being misclassified as context invalidation.
- Top-level content startup promises must have a terminal rejection handler. Reload lifecycle handling must cover launcher configuration/clicks, detail lease handshake, `DETAIL_READY`, and `DETAIL_FAILED`, not only the path that first exposed the error.
- During fresh processing, persist the bounded description, recruiter fields, and SHA-256 hash through `record_job_details` before profile, rule, or model work. A delivery recovery that already carries the exact draft revision/hash skips this write and proceeds to fresh preflight.
- Repeated `record_job_details` may refresh fields but must not regress any projection beyond `extracting`; in particular, `draft_ready`, review, exclusion, and failure states remain authoritative.
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
- Stored retry never calls `chrome.tabs.create`, reads Liepin DOM, or enters the reviewed-send boundary.
- A downstream retry failure is recorded through `record_processing_failure`; success or failure refreshes the record center and leaves explicit inline feedback.

Reviewed send:

- PREPARE is read-only with respect to Liepin and quota. It validates owner, `draft_ready`, current revision/hash, exact job tab, login/risk state, and one selected action tier.
- PREPARE reuses an exact open Liepin job tab or opens the authoritative canonical URL in a background tab, then retries only content readiness for at most 15 seconds. If an exact existing tab has a stale post-Reload content context, it reloads that tab once. These navigation operations do not click Liepin, reserve quota, or authorize CONFIRM.
- Liepin `/job/` pages may expose a ten-digit URL ID while job-bound action elements expose the verified eight-digit suffix. Action and application-evidence matching accepts exact equality or an eight-digit suffix of a nine-or-more-digit platform ID; shorter, nonnumeric, and unrelated recommendation IDs never match.
- If a prior detail refresh regressed a prepared opportunity to `extracting`, `prepare_reviewed_delivery` may repair it only when an existing owner-scoped delivery record already carries the exact requested revision and SHA-256 and the current draft/revision/hash all still match. An arbitrary old draft cannot activate this recovery.
- CONFIRM reruns preflight, atomically reserves the Asia/Shanghai daily unit, records the write boundary and both needed component attempts, then sends one leased content command.
- Reservations distinguish unused from write-started. Only unused reservations may be released; retries for one opportunity reuse its reservation.
- The configurable Liepin daily limit defaults to 150 and accepts 1 through 500.
- DOM interaction is restricted to the job-bound Liepin adapter. It prefers the primary `chat-chat` action, reuses an already-open chat surface, and never searches the whole page for an arbitrary composer/send pair.
- After `chat-chat`, prefer the unique current Liepin IM surface `.im-ui-chat-input` with exactly one visible `textarea.im-ui-textarea` and one visible `.im-ui-basic-send-btn`; only fall back to the existing unique chat-local structural pairing. A known-class match may accept a non-`button` send element, but may not escape its chat root.
- Chat-surface discovery waits up to 15 seconds because Liepin loads its federated IM bundle asynchronously. Tests use a virtual clock; production code must not reduce this to the earlier 4-second assumption without live timing evidence.
- Chat controls may be mounted in the top document, an open ShadowRoot, or an accessible same-origin iframe. Search those composed-tree roots with a visited-scope set; skip cross-origin frames rather than broadening permissions or attempting to read them.
- Visibility is ancestor-aware. A resume control, evidence leaf, or action under `hidden`, `aria-hidden=true`, `display:none`, `visibility:hidden|collapse`, or `pointer-events:none` is not eligible even if the element's own computed style looks visible.
- For chat-surface discovery, distinguish rendered visibility from clickability: a visible composer and disabled send control may use `pointer-events:none` and must still identify the surface. After the draft is set, `isDisabledElement` must pass before any send click.
- Liepin's first contact action may send its own default greeting. That text is not JobFlow greeting evidence.
- `发简历` may open an attachment picker. Exactly one preselected resume plus the explicit statement that the default online resume is included is an accepted `platform_default` confirmation; otherwise stop.
- `已沟通` is not formal application evidence. A new or existing resume card inside the current job's unique chat surface is application evidence.
- Greeting verification requires a non-input visible leaf inside the unique `.im-ui-chat-container` whose normalized text exactly equals the confirmed draft; the input wrapper alone is not a valid evidence root.
- Result events store only bounded evidence codes/counts/lengths and revision/hash references, never DOM, Cookie, recruiter identifiers, or duplicate message content.
- Client-side delivery persistence errors may expose only allowlisted database error codes such as `invalid_delivery_evidence` or `stale_delivery_hash`; arbitrary PostgREST messages, SQL, hints, details, and payloads remain hidden.

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
| In-memory batch run has an unknown or detail-only candidate field | Reject before overwriting the stored run |
| Automatic interval is fractional, outside 5-600, or minimum exceeds maximum | Reject settings before replacing the last valid configuration |
| Automatic throttle owner/platform differs from the signed-in context | Return no throttle; never delay or authorize another owner's write |
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
| Duplicate user generation arrives from another extension page/message | Reject while the same opportunity generation is in flight; create at most one model request/revision |
| Long-running UI command fails | Keep the error visible, clear busy state, and restore retry controls |
| User changes preview selection, then `RUN_UPDATED` renders | Preserve the user's IDs and show the same selected count |
| `START_BATCH` handler is already busy | Keep the start control disabled/aria-busy and do not visually re-enable it from selection changes |
| Batch item fails | Show its redacted local reason in batch and recent-record summaries |
| Batch item is not terminal | Show the current title and queued/opening/extracting/evaluating/generating stage |
| Matching leased detail payload is accepted | Clear the detail-readiness alarm before filtering/model work |
| Extension-owned detail URL has no valid lease hash | Content performs bounded `DETAIL_PAGE_READY` retries and reports only after the matching background lease is returned |
| Detail handshake sender/tab/job/item/status does not match | Return `null` and perform no model, quota, delivery, or platform action |
| Detail redirects to exact Liepin risk `backurl` on the extension-owned tab | Recover the current lease, report `risk_control`, activate and hand off the tab, and pause before write |
| Risk route removes the lease hash | Use the same bounded handshake with validated `backurl`; do not broaden sender or origin acceptance |
| Navigation throttle is still in the future | Persist `waiting_navigation`, show the same countdown, and schedule one queue alarm without opening a tab |
| Detail resolves before 8 seconds | Delay only tab close until minimum dwell; do not delay risk handoff or pretend this avoids platform controls |
| Adapter detail has a schema-invalid field | Reject immediately and report `DETAIL_FAILED` with the boundary error |
| Platform stop banner says the job is unavailable | Report `job_unavailable`, persist the exact bounded reason, mark failed, and continue without model/quota/write |
| Detail has an unknown DOM timeout, login, or risk control | Pause an automatic batch on the current item without entering the write boundary |
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
| Reviewed-send request originates from content/Liepin | Reject before loading backend opportunity or draft data |
| PREPARE succeeds | Persist awaiting_confirmation; consume no daily unit and perform no Liepin click/fill |
| Final preflight differs or fails | Stop before write; release any unused reservation |
| Content lease/hash differs | Reject without platform interaction |
| `聊一聊` sends a platform default greeting | Record application/contact attempt only; do not treat it as the reviewed custom greeting |
| Liepin IM bundle appears between 4 and 15 seconds after `聊一聊` | Continue bounded discovery, then bind only a unique chat-local surface |
| One visible `.im-ui-chat-input` contains one `.im-ui-textarea` and one `.im-ui-basic-send-btn` | Use that exact surface even when the send control is not a `button`/`a` or the surface contains another text input |
| The unique chat surface is inside an open ShadowRoot or accessible same-origin iframe | Traverse the composed tree and use the same local uniqueness checks |
| The chat surface is inside a cross-origin iframe | Ignore it and fail closed; do not add frame permissions or cross-origin access |
| The send control is rendered but disabled (including `pointer-events:none`) | Keep the surface, fill only its composer, and wait for an explicit enabled state before clicking |
| The exact outbound message is rendered in the chat container's sibling message list | Read it from the nearest unique `.im-ui-chat-container`, not only from `.im-ui-chat-input` |
| Candidate chat control is hidden by any ancestor | Exclude it from preflight, execution, and platform-read evidence |
| More than one visible known Liepin IM surface or more than one composer/send control in the surface | Fail closed as no unique writable chat surface |
| One selected attachment + `立即投递` | Send already-selected default/attachment resumes, then require a rendered resume card for verified application |
| `已沟通` without resume evidence | Keep application attempted/unverified |
| Exact reviewed text appears as outbound chat content | Mark greeting verified |
| Automatic `delivery_confirmed` audit has exact bounded source evidence | Persist it before quota reservation; no Liepin write has begun yet |
| Automatic source is missing, altered, attached to another event/code, or accompanied by an unknown key | Reject with `invalid_delivery_evidence` before quota and write-start |
| Reviewed PREPARE has no exact open job tab | Open the authoritative Liepin canonical URL in a background tab and wait for read-only content preflight; do not touch quota/write state |
| Existing exact reviewed-send tab has a stale content context | Reload that exact tab once and retry bounded preflight; never reload unrelated tabs |
| URL job ID ends with the action's eight-digit numeric `data-jobid` | Treat the action as job-bound; unrelated/short/nonnumeric IDs remain ineligible |
| Detail refresh repeats after draft generation | Refresh JD fields without downgrading `draft_ready`; recovery skips duplicate detail persistence |
| One component verified | Derive partial and retry only the missing component |
| Both components verified | Derive succeeded and hide replay controls |
| Duplicate automatic queue wake for one run | At most one path acquires the live-write mutex; the loser does not preflight or write |
| Automatic wait alarm fires before `nextWriteEligibleAt` | Preserve the same timestamp and reschedule without redrawing delay or touching quota/write |
| Automatic wait alarm fires after pause, cancel, completion, or run replacement | Treat as stale and ignore; cancel clears that run's alarm |
| Chrome startup/reload finds `delivery_in_progress` automatic item | Classify as post-write ambiguity, close the extension-owned stale tab when known, advance the item, pause the run, and never automatically replay that opportunity |

### 5. Good/Base/Bad Cases

- Good: user A scans job 123, Edge reloads user A active profile through RLS, stores one evaluation and one evidence-backed draft, and user B sees none of it.
- Base: a signed-out/default build renders account setup but cannot start backend or reviewed-send work.
- Good: the same platform job ID appears on another page; metadata updates and no model call repeats.
- Good: a model-excluded record receives a user_override event and generation-only processing while the original exclusion stays visible.
- Good: resume import immediately shows local parsing/storage/model stages and prevents a second import until completion.
- Good: the user explicitly scans `c.liepin.com/`; already-rendered job cards are extracted without operating the page.
- Good: a one-item user selection remains one checked item after batch status notifications, regardless of the scan's original default selection.
- Good: detail extraction clears its alarm, then a slow model request is governed only by the provider timeout.
- Good: Liepin removes the URL fragment before content startup; the exact extension-owned tab and job retrieve the current lease through the bounded handshake, then submit one `DETAIL_READY`.
- Bad: assume a third-party SPA preserves URL fragments, or return a batch lease merely because any Liepin detail page asks for one.
- Good: runtime-valid detail is persisted before evaluation; a later provider failure leaves the JD visible in the record center.
- Bad: accept a profile object from the extension as approved truth.
- Good: a malformed `reasons` string reports `reasons:invalid_type`, request ID, and operation without including the string value.
- Good: a failed opportunity with captured JD is retried from its owner-scoped record and reaches `draft_ready` without reopening Liepin.
- Base: a valid stored retry produces a grounded exclusion or review; the UI reports the updated record rather than falsely claiming a draft.
- Bad: send stored JD or profile content in `RETRY_STORED_OPPORTUNITY`, or duplicate post-detail logic in the UI.
- Bad: rely on a Zod maximum that the provider prompt never states, or accept paraphrased evidence that cannot be located in the JD.
- Good: PREPARE observes one job-bound primary action and returns awaiting confirmation with zero quota and zero platform writes.
- Good: Liepin sends its default first-contact text, JobFlow later verifies its own exact custom message and a rendered resume card as two separate facts.
- Good: Liepin's federated IM finishes rendering after five seconds; JobFlow keeps waiting within the 15-second bound, then fills only the unique `.im-ui-textarea` and activates only its local `.im-ui-basic-send-btn`.
- Good: the federated IM is mounted in an open ShadowRoot or same-origin iframe; JobFlow traverses that composed tree and still binds one local editor/send pair.
- Good: the chat editor is usable while the visible send button is initially disabled; JobFlow binds the rendered surface, fills the editor, and clicks only after the button becomes enabled.
- Good: the outbound message appears in `.im-ui-message-list-wrapper` beside `.im-ui-chat-input`; JobFlow verifies the exact text from their shared `.im-ui-chat-container`.
- Good: a chat subtree is pre-mounted under `display:none`; JobFlow does not reuse or read evidence from it until the job-bound action makes the ancestor visible.
- Good: a partial record with verified greeting reopens the existing chat only to verify/send the missing application; it never resends the greeting.
- Good: an automatic run paused before write resumes by reopening a fresh matching detail page and using the persisted authoritative draft identity; it does not rerun suitability or greeting generation.
- Good: an elapsed automatic interval alarm runs a fresh final preflight and may write only if the run/item/policy/job/draft identities still match.
- Bad: treat a visible side-panel countdown reaching zero as authorization to send, or replay `delivery_in_progress` after a browser restart.
- Bad: interpret `dispatchEvent()` return value, a completed click promise, `已沟通`, or absence of an exception as successful application.
- Bad: choose the first textarea or `发送` text from the whole document instead of a unique chat-local composer/control pair.
- Bad: decide visibility from the leaf element alone, require every Liepin send control to be a `button/a`, or assume the remotely loaded IM must render within four seconds.
- Bad: use only top-level `document.querySelectorAll`, inject into every iframe, or try to pierce a cross-origin frame to find a chat editor.
- Bad: discard a visible chat surface because its empty-state send button has `pointer-events:none`, or click a control merely because it is rendered without checking its disabled state.
- Bad: use the input wrapper as the only read-back root when the message list is its sibling, or treat an attempted send as verified without rendered outbound evidence.
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
- tests/batch-persistence.test.ts: accepted details keep the stored batch schema valid and terminal first-item outcomes advance to the next queued item.
- tests/domain.test.ts and tests/batch.test.ts: exhaustive projections and transitions.
- tests/filters.test.ts: clear, negative, optional/preferred, and ambiguous rule language.
- tests/prompt.test.ts and tests/resume.test.ts: evidence and content validation.
- tests/options-ui.test.ts: delayed long-running command feedback, duplicate blocking, failure recovery, and bulk fact approval.
- tests/sidepanel-ui.test.ts: recognizable scan command, pending/duplicate behavior, inline completion/failure, and zero-result state.
- tests/sidepanel-ui.test.ts: selection preservation across batch render, selected-count accuracy, and visible failure reasons.
- tests/sidepanel-ui.test.ts: start-busy selection changes do not visually re-enable the start button, and automatic wait countdown updates while the side panel remains open.
- tests/batch-persistence.test.ts: strict automatic live-write mutex, stale/early/elapsed automatic wait alarms, cancel alarm clearing, draft-identity resume without model rerun, and `delivery_in_progress` startup recovery as post-write ambiguity.
- tests/safety.test.ts: allowlisted side-panel automatic authorization and internal background delivery flow; scan/settings/startup/content/options paths cannot initiate live execution outside those boundaries.
- tests/contracts.test.ts: detail-readiness alarm clearing precedes deterministic and model processing.
- tests/liepin-content.test.ts: rejected `DETAIL_READY` acknowledgements become explicit detail failures.
- tests/liepin-content.test.ts: a valid no-hash detail retrieves its lease by bounded handshake, retries a startup race, and emits only one detail report.
- tests/liepin-content.test.ts: Chrome Reload runtime removal/rejection leaves no unhandled promise, stale detail reporting stops, and valid-context transport failures remain visible.
- tests/liepin-risk-redirect-content.test.ts: hash and no-hash safe-Liepin redirects recover the original synthetic job identity and report `risk_control` immediately.
- tests/liepin.test.ts and tests/liepin-content.test.ts: a synthetic platform stop banner is classified and reported immediately as `job_unavailable`.
- tests/contracts.test.ts and tests/batch-persistence.test.ts: detail failure codes are strict; permanent unavailability preserves its reason and advances automatic processing with zero model/quota/write work.
- tests/batch-persistence.test.ts: only the current extension-owned tab/job/item receives a detail lease; wrong origins, tabs, jobs, states, and historical items receive `null` with zero side effects.
- tests/batch-persistence.test.ts: navigation cooldown persists before open, early waits do not create tabs, minimum dwell delays close, and risk handoff activates without closing or entering model/quota/write paths.
- tests/storage.test.ts and tests/sidepanel-ui.test.ts: owner isolation/cleanup, malformed throttle rejection, `waiting_navigation`, and live navigation countdown rendering.
- tests/options-ui.test.ts: persisted JD and recruiter metadata render without a platform tab.
- tests/model-diagnostics.test.ts: allowlisted shape summary, bounded formatting, and hostile-value/unknown-key non-disclosure.
- tests/prompt.test.ts: both client and real Edge prompts enumerate output cardinalities, discriminator values, and verbatim-evidence rules.
- tests/stored-retry.test.ts: strict owner/status/JD/profile/credential preconditions, shared processing, bounded failure persistence, and no `chrome.tabs.create`.
- tests/options-ui.test.ts: stored retry busy/duplicate/success/failure behavior and record refresh.
- tests/reviewed-send-content.test.ts: successful preflight lease and draft hash are mandatory before execute.
- tests/liepin.test.ts: primary/secondary action tiering, open-chat reuse, ancestor-hidden rejection, current `.im-ui-*` surface binding, open ShadowRoot and same-origin iframe traversal, rendered-but-disabled send controls, sibling message-list read-back from `.im-ui-chat-container`, delayed federated-IM rendering with a virtual clock, disabled composer, selected resume confirmation, exact message/resume evidence, and false-positive rejection.
- tests/liepin.test.ts: exact and verified eight-digit action-ID suffix binding rejects unrelated recommendation controls.
- tests/options-ui.test.ts: generic record commands and reviewed-send controls acknowledge clicks synchronously, disable while pending, and reject duplicate clicks.
- tests/batch-persistence.test.ts: automatic draft recovery skips repeated detail persistence, accepts only server-revalidated projection repair, auto-opens missing reviewed-send tabs, and reloads only an exact stale tab.
- tests/domain.test.ts: independent component projection, verified immutability, partial/succeeded, and reviewed retry from failed to attempted.
- supabase/tests/002_detail_capture.test.sql and 003_reviewed_delivery.test.sql: detail refresh preserves draft state; projection repair requires a prior exact delivery identity plus current draft/revision/hash; owner/cross-user and stale draft guards remain enforced.
- supabase/tests/003_reviewed_delivery.test.sql: execute the real automatic authorization evidence against the RPC, retain exact `sidepanel_batch`, and reject alternate/unknown source evidence. Background mocks alone are insufficient for evidence-contract changes.
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

For extension-owned detail leases, never rely on a third-party URL fragment as the only transport:

~~~typescript
// Wrong: a redirect or SPA replaceState can remove the only lease copy.
const leaseId = new URLSearchParams(location.hash.slice(1)).get("jobflow-lease");
if (!leaseId) return;

// Correct: keep the hash fast path, then ask the background to rebind only the exact current tab/job.
const leaseId = leaseFromLocation() ?? await requestCurrentDetailLease(jobId);
if (!leaseId) return;
~~~

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

For reviewed send, never expose a generic content command:

~~~typescript
// Wrong: page content chooses the target and arbitrary action.
await chrome.runtime.sendMessage({ type: "LIVE_ACTION", selector, text });

// Correct: trusted options binds the authoritative revision, then content consumes one job-bound lease.
await sendCommand({ type: "PREPARE_REVIEWED_SEND", opportunityId, draftRevisionId, draftSha256 });
await sendCommand({ type: "CONFIRM_REVIEWED_SEND", opportunityId, draftRevisionId, draftSha256 });
~~~

For the Liepin chat surface, do not loosen matching to arbitrary page controls:

~~~typescript
// Wrong: page-wide first match, leaf-only visibility, and a 4-second SPA assumption.
const composer = document.querySelector("textarea");
const send = [...document.querySelectorAll("button,a")].find((node) => node.textContent === "发送");

// Correct: prefer the observed IM namespace, require one local pair, and reject hidden ancestors.
const root = uniqueVisibleRoot(document, ".im-ui-chat-input");
const composer = uniqueVisibleDescendant(root, "textarea.im-ui-textarea");
const send = uniqueVisibleDescendant(root, ".im-ui-basic-send-btn");
~~~
