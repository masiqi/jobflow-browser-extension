# Implementation Plan

## 1. Contracts And Red Tests

- [x] Add failing tests for execution-policy defaults, strict settings decoding, migration from settings without the field, and persistence across reload.
- [x] Add failing tests for the default 10-20 second range, inclusive 5-600 bounds, integer/minimum-order validation, deterministic random seams, and invalid-save preservation.
- [x] Add failing runtime tests that bind `START_BATCH` to the exact side-panel sender, expected policy, selected IDs, and automatic run snapshot.
- [x] Add failing batch-domain tests for delivery stages, success/partial counts, pre-write pause without index advance, post-write pause with index advance, and resume behavior.
- [x] Add failing safety tests proving render, scan, settings save, page load, Chrome startup, options page, content script, and host page cannot initiate automatic delivery.

## 2. Execution Policy And UI

- [x] Add `ExecutionPolicy` to domain types, settings schema, defaults, trusted storage normalization, and app state.
- [x] Add minimum/maximum automatic interval settings and a uniform inclusive secure-random helper with a deterministic test seam.
- [x] Add the management-page segmented control and enforce `draft_only` against manual live controls.
- [x] Update the side-panel policy status, selected-count action label, immediate busy state, and explicit automatic real-write styling.
- [x] Give management command buttons immediate action-specific busy state and enforce one user generation in flight per opportunity.
- [x] Keep list scanning and selection transient state unchanged; submit exactly the displayed selected IDs.

## 3. Durable Batch State

- [x] Extend `BatchRun` and `BatchItem` schemas with policy snapshot, authorization time, draft identity, blocker phase/code, delivery stages, pause reason, and delivery counters.
- [x] Persist a strict owner/platform throttle independently from a batch, mirror its active wait into the run for UI, and never redraw an existing schedule.
- [x] Clear the throttle on device-owner or product-data reset and prove a new batch cannot bypass a prior batch or reviewed-send timestamp.
- [x] Centralize batch transition helpers for continuing non-write outcomes, pausing before write, completing success, and pausing after ambiguous write.
- [x] Preserve write-time strict storage validation and add legacy-run handling that fails closed without inventing automatic authorization.
- [x] Preserve `draft_ready` across detail refresh, skip detail persistence during draft-identity resume, and repair only a prior exact delivery identity.

## 4. Shared Delivery Orchestration

- [x] Refactor manual prepare/confirm into internal authoritative identity, job-bound preflight, and evidence-aware execute primitives while keeping existing reviewed-send behavior and tests green.
- [x] Let PREPARE open a missing exact detail tab, reload one exact stale tab, and wait for content readiness without quota or platform clicks.
- [x] Record manual versus automatic authorization with allowlisted bounded evidence, without storing message or JD content.
- [x] Verify `automatic_batch_authorized + {source: sidepanel_batch}` against the real RPC and reject alternate or unknown source evidence before quota/write-start.
- [x] Keep quota reservation, write-start marking, component attempts, evidence projection, unused-reservation release, and verified-component immutability in one shared path.
- [x] After any reviewed or automatic JobFlow write-start marker, persist the next automatic-write throttle before invoking content execution.
- [x] During development, count only a dispatched final application/greeting control as automatic click-assumed completion when page read-back is unavailable; preserve strict reviewed-send evidence semantics and distinct audit codes.
- [x] Skip the long post-send read-back wait only for automatic click-assumed execution, retain a short post-click grace, and preserve the minimum detail-tab dwell before closing.

## 5. Automatic Queue Integration

- [x] After a valid generated greeting, reload the authoritative current revision/hash and persist `delivery_ready` on the current automatic item.
- [x] Preflight and execute on the same extension-owned detail tab only when the current run/item/policy/job/draft identities match.
- [x] Before a second or later write, count model time toward the persisted gap, wait with a one-shot `chrome.alarms` alarm only when needed, and run a fresh final preflight after wake.
- [x] Continue exclusions, reviews, model errors, grounding errors, and greeting validation errors without any platform command.
- [x] Classify an explicit Liepin paused/stopped job as permanently unavailable, persist the bounded reason, and continue without model, quota, or platform action.
- [x] Pause without advancing for pre-write login/risk/CAPTCHA/resume/action/DOM/quota blockers; resume from persisted draft identity without another model call.
- [x] Advance then pause for partial or ambiguous post-write results; never automatically retry that opportunity.
- [x] Continue after two verified components and close only the extension-owned detail tab.
- [x] Honor pause/cancel immediately before quota and write, and finish evidence collection if a write has already begun.

## 6. Recovery

- [x] Add a bounded automatic-delivery watchdog distinct from detail and provider timeouts.
- [x] Test interval alarm suspension/wake, no redraw after rerender or wake, elapsed intervals, pause/cancel while waiting, and changed settings applying only to future schedules.
- [x] Pause active automatic runs on Chrome startup, extension installation/update/reload, or unrecoverable in-flight state; require explicit user resume.
- [x] Test service-worker recovery for `delivery_ready`, pre-write blocked, and `delivery_in_progress` states with zero automatic replay after ambiguity.
- [x] Add persistent 15-30 second Liepin navigation pacing, 8-second minimum dwell, side-panel countdown, owner cleanup, and early-alarm reuse.
- [x] Classify validated safe-Liepin intercept/SMS redirects before the detail route guard, preserve/activate the verification tab, and require explicit user resume.

## 7. History And Exceptions

- [x] Verify every accepted JD remains persisted before LLM work across automatic success, exclusion, review, model failure, pre-write pause, and post-write pause.
- [x] Preserve existing append-only user override behavior and prove overridden or historical drafts cannot enter an automatic batch.
- [x] Keep override drafts editable and eligible only for the existing two-stage reviewed-send path.

## 8. Verification And Documentation

- [x] Update side-panel, options, domain, contracts, storage, background integration, content, Liepin adapter, safety, and Supabase tests with synthetic fixtures.
- [x] Update README, ADR 0001/0002/0017, cross-layer spec, glossary if terminology changes, and tracked default `dist`.
- [x] Run `npm run verify`, database tests/lint, local Edge integration, extension smoke, both audit paths, secret/personal-data scans, and `git diff --check`.
- [ ] Rebuild local Supabase `dist`, Reload Chrome, refresh Liepin, and manually accept 1-3 items: one non-write outcome, one verified success, and one safe pause path before describing automatic mode as accepted.

## Rollback Points

- Before any write: disable `automatic_send`, preserve generated drafts, and release only unused reservations.
- After a write-start marker: never erase attempts or quota; disable future automatic starts and leave recovery in reviewed-send.
- If the adapter changes: fail closed at preflight, pause the batch, and retain JD/draft history.
