# Improve first-run interaction feedback

## Goal

Make the first-run resume and Liepin scan workflows visibly actionable and responsive. Cover resume profile generation, bulk fact approval, and the current-DOM scan on Liepin's authenticated candidate homepage.

## Requirements

- Clicking the resume import action must immediately show an in-progress state and prevent duplicate submissions.
- The import surface must expose the current coarse stage while work continues: reading, local persistence, model generation, and profile loading.
- Completion and failure must remain visible and accessible; a failure must restore the controls so the user can retry.
- The draft profile fact list must have one master "allow all references" checkbox that selects or clears all fact approvals and exposes an indeterminate state when only some facts are approved.
- Individual fact approvals remain editable, and the master checkbox must track them.
- Treat the exact `https://c.liepin.com/` candidate homepage as a supported current-DOM list route in addition to the existing public `/zhaopin/` route.
- Keep route matching explicit: account records, settings, conversation, application history, and other `c.liepin.com` paths are not list routes.
- The side panel must expose a recognizable text-and-icon "scan current page" primary action, show an immediate busy state, block duplicate scans, and retain success or failure feedback inline.
- A completed scan with zero recognized cards must be distinguishable from a page that has not been scanned.
- The user's current checkbox selection is the batch source of truth. Any state-driven re-render must preserve that selection and must not visually restore the scan-time defaults.
- The side panel must show the actual selected count separately from the configurable batch upper limit.
- Batch and recent-record failure states must show the locally persisted failure reason without requiring the management page.
- A running batch must identify the current item and its queued, detail-opening, detail-reading, evaluating, or greeting-generation stage; `0/N` alone is not sufficient progress feedback.
- The detail-readiness alarm must be cleared as soon as a matching leased detail payload is accepted; deterministic filtering and model calls must not remain covered by a detail-page timeout.
- Every extracted detail payload must satisfy the runtime `DetailJob` schema; a rejected `DETAIL_READY` response must become an explicit detail failure rather than degrading into a timeout.
- A validated detail must be persisted to the owning user's opportunity before deterministic filtering or any model request.
- Persist the full bounded JD description, recruiter fields, JD hash, and a redacted `details_captured` event. Do not duplicate the full JD in the event payload.
- Detail persistence must be owner-scoped, identity-checked, idempotent by request ID, and inaccessible across users.
- The record center must render the persisted JD and recruiter metadata without requiring the user to reopen Liepin.
- Model failures must distinguish request, trusted-data hydration, provider-envelope, model-JSON, model-output-schema, grounding, and persistence stages where applicable.
- A model-output-schema failure may return and log only a bounded diagnostic summary: request ID, operation, provider/model, output kind, known expected fields and their JSON types, missing expected fields, unknown-field count, and sanitized Zod issue paths/codes.
- Raw model content, arbitrary unknown field names, field values, JD, resume/profile text, prompts, endpoint, credentials, and Authorization data must never appear in browser/Edge logs, database failure reasons, or diagnostic responses.
- The compact diagnostic must be visible in the side-panel failure reason and the full safe object must be available in the extension Service Worker Console.
- Suitability prompts must state the same bounded-array contract enforced by runtime validation: at most six approved fact IDs, one to six reasons, and at most six JD evidence excerpts; `exclude` still requires at least one JD excerpt.
- Suitability and greeting prompts must tell the model that every JD evidence item is a verbatim contiguous excerpt from the stored description, with no paraphrasing, summarization, or ellipsis, matching the grounding validator.
- The real Edge prompts must enumerate every constrained discriminator and critical range: suitability outcome/score, suitability arrays, and greeting evidence/fact arrays.
- A failed opportunity with an already persisted non-empty JD must expose a management-page retry action that evaluates and generates from stored data without reopening Liepin.
- Stored-detail retry must require the current signed-in owner, an active approved profile, a configured model route (including an available owner-bound BYOK key when selected), and a retryable failed opportunity.
- Stored-detail retry must reuse the normal deterministic filter, suitability validation, greeting validation, and persistence path so that it cannot drift from batch processing.
- The retry action must immediately show an in-progress state, prevent duplicate invocation, retain success or failure feedback, and refresh the record center when complete.
- Stored-detail retry must not create or navigate a tab, inspect the Liepin DOM, or add any recruitment-platform write behavior.
- Scanning remains read-only and must not scroll, paginate, navigate, click host controls, or collect more than the cards already present in the DOM.
- No resume content, model output, credentials, or new platform-write behavior may be logged or persisted outside the existing boundaries.

## Acceptance Criteria

- [x] A delayed import command causes an immediate visible busy state and disables the import controls and action.
- [x] Import progress advances through client parsing, local persistence, model generation, and final profile loading.
- [x] A successful import renders the draft profile and an explicit completion message.
- [x] A failed import shows an explicit error, clears the busy state, and permits retry.
- [x] The master fact checkbox selects all facts, clears all facts, and becomes indeterminate after an individual fact is changed.
- [x] `https://c.liepin.com/` is accepted as a list route while unrelated candidate-account paths remain rejected.
- [x] A synthetic authenticated-homepage fixture produces deduplicated job candidates without host interaction.
- [x] A delayed scan immediately disables its primary action and shows progress; completion and failure both remain visible and permit another scan.
- [x] A zero-result scan renders a specific empty result rather than looking like an unstarted workflow.
- [x] Starting a one-item batch preserves exactly one visible selection after `RUN_UPDATED`, even when the original preview defaulted to ten.
- [x] The side panel displays the actual selected count and the failure reason from both a failed batch item and its opportunity record.
- [x] Accepting a matching detail payload clears the detail-readiness alarm before filtering or invoking a model.
- [x] A running batch labels the current item stage instead of presenting only a static `0/N` counter.
- [x] The real failed detail shape passes `detailJobSchema`; a rejected `DETAIL_READY` acknowledgement becomes `DETAIL_FAILED` with the rejection reason.
- [x] A named `record_job_details` RPC persists only an owned matching job, stores JD/recruiter/hash, and appends one redacted event per request ID.
- [x] Background processing persists validated details before loading the active profile, filtering, or invoking a model.
- [x] The record center displays a stored JD and recruiter metadata from `OpportunityRecord` without opening Liepin.
- [x] Database owner, cross-user, identity, validation, and idempotency tests pass.
- [x] A malformed model output returns a stage-specific, bounded diagnostic with only allowlisted keys/types and sanitized Zod paths/codes.
- [x] Diagnostic tests prove sensitive values and arbitrary attacker-controlled field names never appear in serialized output or console arguments.
- [x] The background formats the diagnostic into the visible failure reason and writes the same safe object to the Service Worker Console.
- [x] Suitability prompt tests prove every bounded output array is described with the exact runtime maximum.
- [x] Suitability and greeting prompt tests prove the exact-excerpt grounding requirement appears in the real Edge prompts.
- [x] Prompt tests prove the real Edge suitability outcome enum and greeting array ranges mirror runtime schemas.
- [x] A strict stored-opportunity retry command rejects unknown fields and invalid opportunity IDs.
- [x] Retry tests prove persisted JD is used, missing JD/non-failed state/missing profile/missing BYOK are rejected, and no detail tab is created.
- [x] A failed record with stored JD renders a single retry action with visible busy, success, and failure feedback.
- [x] A successful stored-detail retry persists a valid evaluation and greeting draft through the same processing path as a normal batch item.
- [x] The full verification suite passes and tracked `dist/` is rebuilt from `src/`.

## Notes

- This remains draft-only. The follow-up adds one strict runtime command but no backend schema, host permission, or platform-write change.
