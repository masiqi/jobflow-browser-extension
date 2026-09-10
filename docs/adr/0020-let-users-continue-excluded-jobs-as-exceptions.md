# ADR 0020: Let users continue excluded jobs as exceptions

- Status: Accepted
- Date: 2026-09-10

## Context

Deterministic, model, and user exclusions prevent the automatic pipeline from repeating work for a known platform job ID. The job seeker remains the final decision-maker and needs to correct an unsuitable automated decision without destroying its evidence.

Directly editing a status field or deleting an exclusion would make the audit history misleading. Rerunning suitability evaluation would also violate the accepted identity-level no-reevaluation rule.

## Decision

The job-record center offers Continue as exception on deterministic, model, and user exclusion records.

Before confirmation, show the original exclusion source, reasons, and evidence. On confirmation:

- append a user-override event with actor and time;
- preserve the original decision and all evidence;
- do not rerun deterministic filtering or LLM suitability evaluation;
- enter generation-only processing;
- apply the same approved-fact, grounding, length, and content validation as any other greeting.

If a truthful grounded draft still cannot be generated, return the opportunity to manual review.

Automatic scans continue to honor the original exclusion unless the opportunity already has a valid pending-message state produced by the user override.

## Consequences

- Automatic deduplication remains stable while users retain final control.
- Record details must display both the original automated decision and the later user exception.
- Status cannot be represented as one mutable field; transition history is required.
- A user can consciously proceed against a configured hard rule, so confirmation must be explicit.
