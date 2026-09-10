# ADR 0018: Use a nonblocking unified review queue

- Status: Accepted
- Date: 2026-09-10

## Context

A predefined JD rule can encounter ambiguous language, and an LLM can return review instead of proceed or exclude. Stopping an entire serial batch for each ambiguity would undermine batch processing, while silently retrying on the next scan would waste model quota and produce inconsistent decisions.

## Decision

Put deterministic-rule ambiguity and LLM review decisions into one persistent manual-review queue. Each item shows:

- the opportunity, company, and job link;
- whether the source is deterministic rule ambiguity or LLM review;
- reasons and minimal JD evidence;
- the evaluation metadata already produced.

The batch continues with its next selected opportunity.

Each review item offers exactly:

- Continue generation: a deterministic-rule review proceeds to LLM suitability evaluation; an LLM review proceeds to a generation-only model step without repeating suitability evaluation.
- Permanently exclude: create a user exclusion for the user-owned platform job identity and prevent future detail, evaluation, and draft work.

Pending items do not trigger work on later scans. Persist the user's decision and time in the opportunity history.

Clear deterministic hard exclusions and persisted LLM exclusions are not overrideable through the ordinary review queue. The record center may offer the separately confirmed Continue as exception transition defined by ADR 0020.

## Consequences

- One queue supports both forms of uncertainty without conflating their sources.
- Batch throughput is not blocked by human response time.
- The generation service needs a mode that writes from an explicit human continue decision without requesting another suitability decision.
- User exclusions need their own status and audit record, distinct from hard-rule and LLM exclusions.
