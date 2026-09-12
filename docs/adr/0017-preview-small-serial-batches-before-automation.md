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
