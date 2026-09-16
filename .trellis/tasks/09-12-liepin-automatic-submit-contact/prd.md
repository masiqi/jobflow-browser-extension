# Liepin automatic submit and contact

## Goal

Allow a job seeker to choose an `automatic_send` execution policy so that one selected Liepin result batch is filtered, evaluated, drafted, formally submitted, and contacted without per-opportunity confirmation. The user performs the platform coarse filtering, opens the JobFlow side panel, reviews the recognized list and count, and explicitly starts one automatic batch; JobFlow then processes every selected opportunity serially and automatically submit-and-contacts only opportunities with a validated `proceed` result.

## Background And Confirmed Decisions

- The product execution policies are distinct domain states: `draft_only`, `reviewed_send`, and `automatic_send`; this is not an ambiguous `autoSend` boolean.
- `automatic_send` is always opt-in. A missing setting normalizes to `reviewed_send` so the current manually accepted workflow remains the default; `draft_only` remains available when the user wants to prohibit all Liepin writes.
- Single-opportunity `reviewed_send` is already manually accepted and provides reusable job identity, draft revision/hash, preflight, daily quota, application/greeting evidence, partial completion, and verified-component recovery contracts.
- Submit-and-contact is one business intent with two independently verified components: formal application and the exact generated greeting.
- Liepin may send its own default greeting when the conversation is opened. That platform text is not evidence that JobFlow sent the generated greeting.
- The user has now explicitly approved implementing `automatic_send` for selected Liepin opportunities.
- For the current development/debugging phase, the user has explicitly approved treating a job-bound final click as completion in `automatic_send` when Liepin does not provide readable post-write evidence; this is recorded separately from platform read-back and is not a silent success claim.
- Automatic mode requires one explicit side-panel batch start. Opening, refreshing, filtering, or merely scanning a Liepin page never performs a live write.
- Automatic mode processes only opportunities evaluated and drafted inside the newly authorized automatic batch. Existing pending drafts retain their reviewed-send authorization boundary.
- Consecutive automatic Liepin writes use a configurable uniformly randomized integer-second interval. The accepted default range is 10-20 seconds, with each bound configurable from 5 through 600 seconds.

## Requirements

### Execution Policy

- Add an explicit execution-policy setting with `draft_only`, `reviewed_send`, and `automatic_send` values.
- Do not store a personalized default. The product-level default is `reviewed_send`, preserving the current manually confirmed behavior while requiring an explicit opt-in for `automatic_send`.
- The UI must state whether the next selected batch will only generate drafts, require later per-item review, or automatically perform real Liepin writes.
- Enabling automatic mode must not retroactively send existing drafts or opportunities merely because the setting changed.

### Automatic Batch Behavior

- Use the current Liepin native filters and the explicit JobFlow selection as the batch input.
- Opening the side panel shows the recognized count, selectable job list, selected count, execution policy, and one primary batch action; it does not start processing by itself.
- In automatic mode the primary action is labeled as a real one-click submit-and-contact action and includes the selected count. Clicking it is the single authorization for that selected batch; there is no per-item confirmation.
- Changing filters, opening or refreshing the result page, opening the side panel, scanning, and changing the execution-policy setting perform zero Liepin writes.
- Process selected opportunities serially with at most one extension-owned detail tab.
- Run deterministic JD rules before any suitability or greeting model call.
- Send nothing for deterministic exclusions, model exclusions, `review`, invalid model output, missing profile facts, or an invalid or unsafe greeting.
- When deterministic rules pass, the suitability result is validated as `proceed`, and the greeting is validated and persisted, automatically execute submit-and-contact for that same opportunity.
- Bind every platform command to the authoritative user-owned opportunity, platform job ID, current generated draft revision, SHA-256, and a short-lived successful preflight lease.
- Reuse the accepted Liepin adapter. Do not introduce a generic selector, click, or fill command or a recruitment-platform private write API.
- Record application and greeting attempts independently. In the normal policy, overall success requires both platform-read components; during the approved development fallback, a dispatched final control may complete its component with `application_click_assumed_success` or `greeting_click_assumed_success` so automatic batches do not replay it.
- A retry may execute only components without verified evidence and must never automatically replay a verified application or greeting.
- Deterministic exclusion, model exclusion, `review`, invalid model output, missing facts, and unsafe greeting are item-level non-write outcomes; record the reason and continue with the next selected opportunity.
- A pre-write login, risk-control, CAPTCHA, ambiguous-resume, unknown-DOM, or quota blocker pauses the entire batch before any Liepin write. The side panel must identify the blocked item and reason.
- A pre-write blocked item may be retried only after an explicit user resume because no platform write began.
- If any platform write began but neither the final application nor greeting control was dispatched, or a pre-write/post-write blocker prevents even a click assumption, record the component states, pause the entire batch, and never automatically retry that opportunity. A dispatched final control may use the approved click-assumed completion in `automatic_send` and continue without replaying that component.
- After the user reviews a post-write ambiguous item, resuming the batch continues with the remaining queued opportunities; recovery of that item stays in the explicit reviewed-send flow.

### Limits And Safety

- Apply the existing per-user Liepin daily limit, default 150 and configurable from 1 through 500, using the Asia/Shanghai calendar day.
- Reserve one daily unit immediately before the first possible platform write for an opportunity; release it only if no write starts; reuse it for evidence-aware recovery of that opportunity.
- The existing batch limit remains 1 through 20 and is separate from the daily live limit.
- Apply a configurable randomized interval between consecutive opportunities that reach the real Liepin write boundary. An automatic write may start immediately only when this owner/platform has no unexpired current-device throttle.
- Expose separate minimum and maximum interval inputs. Default to 10 and 20 seconds, require both values to be integers from 5 through 600, and require minimum to be no greater than maximum.
- Select each interval uniformly from the inclusive configured range.
- Do not delay list scanning, detail capture, deterministic filtering, model evaluation, greeting generation, exclusions, or reviews; the interval controls platform writes rather than model throughput.
- A randomly selected delay and its next eligible write time must be persisted before waiting so MV3 suspension or an alarm wake cannot redraw a shorter interval or bypass it.
- The next eligible automatic write time is account- and platform-scoped on the current device rather than batch-scoped, so completing, cancelling, or replacing a batch cannot bypass the interval.
- Any real Liepin write started by JobFlow, whether reviewed or automatic, schedules the next automatic-write interval. Recruitment-site actions performed manually outside JobFlow are not observable and are outside this limiter.
- Use `chrome.alarms`, not a long `setTimeout`, and show the current wait/countdown in the side panel. Pause and cancel must remain effective while waiting.
- Changing the interval setting affects only delays selected after the change and cannot itself start or resume a batch.
- Do not add Cookie access, Cookie export, broad host permissions, file upload, automatic pagination, automatic scrolling, or support for another recruitment platform.
- Do not send existing pending drafts automatically when automatic mode is enabled; only a newly authorized automatic batch can enter the live path.
- Preserve pause, cancel, MV3 recovery, item-level reasons, and a batch summary that distinguishes drafts, exclusions, reviews, failures, partial deliveries, and complete deliveries.

### JD History And User Exceptions

- Persist every accepted full JD, recruiter metadata, and JD hash before deterministic filtering or model processing. A later exclusion, review, model failure, or send failure must not remove the stored detail.
- Retain the original deterministic decision, model evaluation, evidence, model metadata, draft revisions, user decisions, and delivery attempts as append-only history for the opportunity.
- Do not expose arbitrary direct editing of the projected status. User-visible actions append explicit decisions that deterministically derive the current status.
- An excluded opportunity must expose an explicit `continue as exception` action. The exception preserves the original exclusion and evidence, records the user override, and allows a new draft to be generated from the stored JD and current active profile.
- A user override never silently joins the running automatic batch and never sends immediately merely because automatic mode is enabled.
- Previously generated unsent drafts, including drafts produced by an exception, remain in the existing reviewed-send flow for user inspection, editing, prepare, and final confirmation.
- Platform plus platform job ID remains the only opportunity identity. A later JD content change does not create a new opportunity or discard its history.

## Acceptance Criteria

- [ ] A user can select `draft_only`, `reviewed_send`, or `automatic_send`, save the setting, reload the extension, and see the same policy.
- [ ] `draft_only` and `reviewed_send` batch generation retain their current no-live-write behavior.
- [ ] A selected automatic batch processes every selected opportunity serially; an exclusion or review on one item does not block the next item.
- [ ] The side panel displays the recognized jobs and counts before live work; exactly one explicit batch button starts automatic submit-and-contact for the selected IDs.
- [ ] A validated `proceed` opportunity with a valid generated greeting enters the job-bound Liepin submit-and-contact path without per-item confirmation.
- [ ] A non-`proceed` or invalid item performs zero Liepin writes and exposes its reason.
- [ ] Quota exhaustion stops before a platform write and is visible in the batch result.
- [ ] Consecutive real-write opportunities observe the configured persisted random delay, while non-write outcomes continue without an artificial delay.
- [ ] The default interval is an inclusive uniform 10-20 seconds; invalid, reversed, fractional, or out-of-range 5-600 second settings are rejected without replacing the last valid configuration.
- [ ] Alarm wake, side-panel rerender, and service-worker suspension cannot shorten or redraw an already selected delay; the UI exposes the wait and pause/cancel work during it.
- [ ] Starting another batch or completing a reviewed send cannot bypass the current-device account/platform next-write timestamp.
- [ ] Non-write exclusions, reviews, and model or greeting validation failures continue to the next selected opportunity.
- [ ] Login, risk-control, CAPTCHA, resume ambiguity, unknown DOM, quota exhaustion, and post-write ambiguity pause the batch with an item-level reason.
- [ ] Each automatic item records separate application and greeting evidence; normal platform-read verification and development click-assumed completion use distinct evidence codes, and both completed components produce complete delivery.
- [ ] Partial or ambiguous post-write outcomes are never automatically replayed; verified components remain immutable.
- [ ] Changing the setting alone, opening or filtering a result page, scanning, opening a saved job, reloading Chrome, or viewing an existing draft cannot trigger a send.
- [ ] Every JD accepted for LLM processing remains readable in the owner-scoped record center after proceed, exclude, review, model failure, send failure, or batch pause.
- [ ] A user can continue an excluded opportunity as an exception without deleting or rewriting the original decision and evidence.
- [ ] An exception-generated or historical draft can be reviewed, edited, prepared, and explicitly sent through reviewed-send, but is never auto-sent by changing execution policy.
- [ ] Safety, queue recovery, storage, Supabase, content-script lease, adapter, UI, and build tests pass with synthetic fixtures.
- [ ] A 1-3 item Chrome manual acceptance confirms exclusion or no-write, full success, partial or failure visibility, stop behavior, and daily quota accounting before the feature is described as accepted.

## Out Of Scope

- Automatic pagination or infinite scrolling.
- Automatic replies after the initial greeting.
- Reading recruiter conversations, rejection classification, or off-platform contact exchange.
- BOSS Zhipin or other recruitment platforms.
- Uploading or selecting a new resume file on Liepin.
- Automatically sending drafts created before the current automatic batch.
- Automatically sending a user-overridden exclusion; it must remain in the two-stage reviewed-send flow.
- Arbitrary direct mutation or deletion of historical evaluation, evidence, delivery, or projected status records.
