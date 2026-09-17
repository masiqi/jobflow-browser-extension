# ADR 0017: Preview small serial batches before automation

- Status: Accepted
- Date: 2026-09-10

## Context

Scanning the current result snapshot is read-only and inexpensive. Detail extraction opens platform pages, and model evaluation consumes managed quota or user BYOK balance. Automatically processing every observed card would make early debugging and cost attribution harder.

The product direction still requires future automation when a user opens a supported recruitment page. That automation must evolve from the same queue and evidence model after draft quality and live safety are separately accepted.

## Decision

For the first draft-only milestone:

- scanning does not open details or invoke a model;
- the side panel shows new, duplicate, excluded, already-drafted, and selected counts;
- only new processable opportunities are preselected;
- a batch defaults to 10 and accepts a user-selected limit from 1 through 20;
- excess new opportunities remain available for a later batch;
- the user explicitly selects Start generation after seeing the model route and maximum possible calls;
- detail processing is serial with at most one extension-owned background detail tab;
- pause, resume, and cancel preserve all completed records.

A future automatic execution policy may begin controlled discovery, filtering, generation, and submit-and-contact processing when a user opens a supported result page. It may later include pagination and scrolling but must reuse the same queue, identity, evidence, quota, stop, and recovery contracts.

Every reviewed or automatic submit-and-contact workflow has a per-user, per-platform daily limit. Single-opportunity Liepin reviewed-send now defaults to 150 opportunities per Asia/Shanghai calendar day, and a user may configure a value from 1 to 500. It is a product setting, not a claim about Liepin's official allowance.

Drafting and dry-run activity do not consume this limit. Immediately before the first real platform write for an opportunity, the system atomically reserves one daily unit. If no platform write begins, the reservation is released. Once either application or greeting write begins, the unit remains consumed regardless of full success, failure, or partial completion. Retrying the missing component for the same platform job ID does not consume another unit, and editing the configured limit does not reset recorded usage.

Automatic mode adds a current-device account/platform write interval. After any JobFlow Liepin write-start marker, including reviewed-send, the extension stores the next automatic-write timestamp. The interval defaults to a uniformly sampled integer from 10 to 20 seconds and is configurable from 5 to 600 seconds. It applies only to platform writes, not scanning, JD reading, model work, exclusions, or reviews.

## Amendment: remove the per-batch selection limit

- Date: 2026-09-17
- Status: Accepted

The side panel no longer exposes or enforces a separate “batch limit”. The user may select every processable job in the current scan snapshot, and the batch command submits exactly those selected platform job IDs. The snapshot and runtime payload remain capped at 500 candidates to protect storage and message sizes. Daily delivery quota, navigation pacing, and automatic write intervals remain independent safeguards.

## Amendment: click-assumed completion for automatic debugging

- Date: 2026-09-17
- Status: Accepted for the current development phase

When Liepin accepts a job-bound final application or greeting click but the desktop page does not expose a usable read-back result, `automatic_send` may count that clicked component as completed using an explicit click-assumed evidence code. The batch continues and will not replay that component. This fallback does not apply to pre-write blockers or `reviewed_send`, and the user-facing history states that the result was counted by click rather than independently verified by Liepin.

## Consequences

- First-milestone throughput is deliberately limited while extraction and draft quality are calibrated.
- Users can inspect cost exposure before model calls begin.
- Future automation does not require a second queue or ledger.
- Live automatic implementation remains behind explicit selected-batch authorization and still requires manual browser acceptance before being described as accepted against Liepin.

## Amendment: reviewed-send quota activation

- Date: 2026-09-11

The reservation model is active for single-opportunity reviewed-send. A read-only preflight consumes no unit. The server reserves one unit before the possible write boundary, distinguishes reserved from write-started, permits release only before write start, and reuses the same opportunity reservation during evidence-aware recovery.

## Amendment: selected-batch automatic mode

- Date: 2026-09-12

Automatic submit-and-contact uses the same batch queue and delivery evidence model. Non-write outcomes continue to the next selected item. Pre-write blockers pause without consuming quota. Post-write ambiguity records component evidence, advances the item, pauses the batch, and does not automatically retry. Chrome startup and extension reload fail closed by pausing active automatic runs until the user explicitly resumes.

Automatic batch authorization is audited before quota reservation as the exact tuple `delivery_confirmed / automatic_batch_authorized / {source: sidepanel_batch}`. Both the background producer and the database allowlist must be covered by one real RPC test; a mocked backend test does not establish this cross-layer compatibility. Failure at this event remains pre-write and is safely retryable.

An automatic resume that already carries a same-batch draft revision and SHA-256 reopens the detail page only for fresh preflight. It does not persist detail fields again or downgrade the authoritative `draft_ready` projection. The server can repair the historical `extracting` drift only when a prior delivery record and the current draft/revision/hash all match exactly.

## Amendment: conservative detail navigation pacing and risk handoff

- Date: 2026-09-14

Real-browser acceptance showed that write-only throttling still allowed several extension-owned detail navigations in a short burst, including a very short-lived terminal page, followed by a Liepin SMS risk challenge. The extension now keeps a separate owner/device Liepin navigation throttle: 15-30 seconds between navigation starts, persisted across batches and Reload, with model time counting toward the gap. A normal detail tab exists for at least 8 seconds before JobFlow closes it.

This pacing reduces JobFlow's own burstiness but is not represented as anti-detection or a guarantee against risk controls. The extension does not spoof identity or behavior and does not bypass challenges. A validated Liepin intercept/SMS redirect pauses before write, remains open and active for the user, and requires explicit resume after the user resolves it.

## Amendment: normal page lifecycle and native control semantics

- Date: 2026-09-17
- Status: Accepted

Detail content waits for the browser `load` lifecycle (bounded at 10 seconds),
then settles two render turns with a timer fallback for background-tab rendering
throttling before extracting the detail DOM. Read-only send preflight waits for
delayed job-bound controls for a bounded interval. The adapter focuses visible
controls and calls their native `click()` method, but scripted events remain
untrusted. These changes improve page compatibility only; they are not a
fingerprint, mouse-trajectory, CAPTCHA, or risk-control bypass.
