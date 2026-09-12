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

The user-selectable maximum, any server-controlled emergency ceiling, and automatic-mode request rate remain deferred to the separately approved live safety milestone.

## Consequences

- First-milestone throughput is deliberately limited while extraction and draft quality are calibrated.
- Users can inspect cost exposure before model calls begin.
- Future automation does not require a second queue or ledger.
- Live implementation remains separately prohibited until explicitly approved and manually accepted.

## Amendment: reviewed-send quota activation

- Date: 2026-09-11

The reservation model is active for single-opportunity reviewed-send. A read-only preflight consumes no unit. The server reserves one unit before the possible write boundary, distinguishes reserved from write-started, permits release only before write start, and reuses the same opportunity reservation during evidence-aware recovery. Batch and automatic live limits remain deferred.
