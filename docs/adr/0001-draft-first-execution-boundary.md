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
3. `automatic_send`: one explicit side-panel batch authorization allows matching jobs in that selected batch to be submitted and contacted without per-opportunity confirmation.

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

Application and greeting results are persisted independently as attempted, verified, or failed. A delivery is complete only when both components have platform-read evidence. At that amendment date, batch and automatic sending remained unauthorized; the later selected-batch amendment below supersedes that boundary only for explicitly authorized automatic side-panel batches.

## Amendment: selected-batch automatic submit and contact

- Date: 2026-09-12
- Status: Accepted for implementation with synthetic verification pending manual browser acceptance

The user separately approved `automatic_send` for one side-panel selected batch at a time. The setting is opt-in and defaults to `reviewed_send` for existing users. A batch start command is accepted only from the exact extension side panel, carries the expected execution policy, and snapshots the selected platform job IDs plus authorization time. Opening, scanning, refreshing, saving settings, viewing records, extension startup, and existing drafts cannot authorize a write.

Automatic mode reuses the reviewed-send delivery core: owned opportunity identity, current draft revision and SHA-256, final job-bound Liepin preflight, daily quota reservation, write-start marker, component attempts, and platform-read evidence. A pre-write blocker pauses without advancing the item. A post-write ambiguous or partial result advances the item, pauses the batch, and leaves recovery to the reviewed-send path. Verified components are never replayed. The implementation is synthetic-test covered, but real Chrome/Liepin manual acceptance is still required before this mode is described as accepted against the live site.
