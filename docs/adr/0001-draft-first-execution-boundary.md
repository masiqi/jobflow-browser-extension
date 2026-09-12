# ADR 0001: Draft-first execution boundary

- Status: Accepted
- Date: 2026-09-10

## Context

The product may eventually contact recruiters and continue recruiting conversations, but greeting quality and job-selection quality require a debugging and calibration period. Sending an incorrect or fabricated message is externally visible, difficult to undo, and may affect the job seeker's account.

A single `autoSend` boolean is not an adequate domain model. Turning automatic sending off could still mean either “never write to the platform” or “allow user-confirmed sends,” which have different safety and interface requirements.

## Decision

The first acceptance milestone uses the **draft-only** execution policy:

- Read Liepin list and detail pages.
- Apply deterministic filters and model-assisted evaluation.
- Generate messages without sending, submitting forms, or otherwise writing to Liepin.
- Put generated messages in an editable outbox.
- Allow the job seeker to inspect and edit each pending message.
- Keep draft creation distinct from verified first contact in the ledger.

The product direction includes three distinct execution policies rather than one automatic-send switch:

1. `draft_only`: no platform writes are possible.
2. `reviewed_send`: a job seeker may explicitly send one message or a selected batch after review.
3. `automatic_send`: messages may be sent without per-message or per-batch approval.

At the first acceptance milestone, only `draft_only` was authorized. `reviewed_send` and `automatic_send` require separate product decisions, implementation milestones, safety tests, and manual browser acceptance before they can be enabled. A persisted setting alone must never unlock either sending policy.

## Consequences

- The first milestone can calibrate filtering and writing quality without contacting real recruiters.
- The data model must preserve generated content, the latest user-edited content, and delivery state separately.
- The outbox should support selection now, but send controls must not perform platform writes in the draft-only milestone.
- Future single and batch sending can share one reviewed-send workflow and evidence model.
- Existing simulated ledger entries cannot be interpreted as sent messages or successful applications.

## Amendment: single-opportunity reviewed send

- Date: 2026-09-11
- Status: Accepted and manually verified

The user separately approved `reviewed_send` for one opportunity at a time. The management page owns a two-stage prepare/confirm interaction; the side panel, list scan, batch generation, and page-load paths cannot initiate live actions. Each confirmation is bound to an owned opportunity plus the current draft revision and SHA-256.

Application and greeting results are persisted independently as attempted, verified, or failed. A delivery is complete only when both components have platform-read evidence. Batch and automatic sending remain unauthorized.
