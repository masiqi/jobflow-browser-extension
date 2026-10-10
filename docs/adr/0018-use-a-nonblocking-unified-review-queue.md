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

The original review flow offered:

- Continue generation: a deterministic-rule review proceeds to LLM suitability evaluation; an LLM review proceeds to a generation-only model step without repeating suitability evaluation.
- Permanently exclude: create a user exclusion for the user-owned platform job identity and prevent future detail, evaluation, and draft work.

A review item continued by the user remains a reviewed-send item even when account settings use `automatic_send`; only a direct batch-time `proceed` result is eligible for automatic delivery. The management button acknowledges the request before the first await, and the background permits only one concurrent user-requested generation per opportunity.

Pending items do not trigger work on later scans. Persist the user's decision and time in the opportunity history.

Clear deterministic hard exclusions and persisted LLM exclusions are not overrideable through the ordinary review queue. The record center may offer the separately confirmed Continue as exception transition defined by ADR 0020.

## Consequences

- One queue supports both forms of uncertainty without conflating their sources.
- Batch throughput is not blocked by human response time.
- The generation service needs a mode that writes from an explicit human continue decision without requesting another suitability decision.
- User exclusions need their own status and audit record, distinct from hard-rule and LLM exclusions.

## Amendment: one-click human-approved delivery

- Date: 2026-09-26
- Status: Accepted by the user

For pending-review Liepin records when writes are permitted, the primary action
is now “生成并投递”. One click authorizes greeting generation, job-bound preflight,
and formal application plus greeting for that specific opportunity, without a
second modal or a separate prepare/confirm click. The user has reviewed the JD;
this path does not ask the suitability model to veto that decision again.
Prior rule/model decisions remain in history and the generated greeting still
passes evidence and content validation.

The background owns the whole operation, rejects duplicate/conflicting commands,
and binds the persisted current revision/hash to the existing reviewed-delivery
core. It rechecks ownership and execution policy before writing. UI progress is
visible during generation, preflight and delivery, including across re-renders.

This is a single-opportunity manual authorization. It does not enroll a review
record into a side-panel automatic batch or broaden click-assumed success rules.
The existing quota and component evidence semantics still apply. Failures stop
the chain; reload never replays it. Draft-only mode and the read-only Zhaopin
adapter retain generation-only actions, and permanent exclusion is unchanged.
