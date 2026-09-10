# ADR 0009: Persist LLM exclusions

- Status: Accepted
- Date: 2026-09-10

## Context

Deterministic JD rules cover explicit user exclusions, but the LLM may identify a broader mismatch between a complete JD and the user's approved resume profile. Repeating detail extraction and model evaluation every time the same job appears wastes model usage and can produce inconsistent outcomes.

An LLM decision is not equivalent to a deterministic rule result. It must remain explainable, validated, and tied to the inputs that produced it.

## Decision

After deterministic JD rules pass, the LLM may return proceed, review, or exclude. An LLM exclusion permanently prevents automatic draft processing for that user-owned platform job identity.

Persist every model evaluation separately from deterministic filtering. The record includes:

- the user-owned opportunity identity;
- the structured outcome and reasons;
- minimal JD evidence supporting the reasons;
- the JD content hash;
- the active resume-profile revision;
- the rule-catalog and user-configuration version;
- the prompt version and model identifier;
- the evaluation timestamp.

When the same opportunity appears in another page, scan, or batch, its persisted exclusion prevents repeated detail extraction and model invocation. The exclusion remains visible in the opportunity history and batch summaries.

Invalid, incomplete, or ungrounded model output cannot exclude a job. It produces a reviewable processing failure instead.

Exclusion validity depends only on the owning user, platform, and platform job ID. JD content, active resume profile, filter settings, rule catalog, prompt, and model changes do not invalidate it. The first milestone provides no automatic or manual suitability reevaluation for an excluded identity. A different platform job ID is a different opportunity and remains eligible for evaluation.

The user may explicitly continue as an exception from the record center. This does not reevaluate, alter, or delete the model exclusion; it appends a user-override event and enters generation-only processing.

JD hashes and input versions remain stored for auditability only; they do not participate in deduplication or invalidation.

## Consequences

- Model exclusions consume durable ledger state rather than disappearing with a batch.
- Hard-rule exclusions and model exclusions need distinct statuses, counts, filters, and diagnostics.
- Evaluation reuse reduces model cost and prevents repeated work for a known platform job ID.
- The product intentionally accepts that an old model decision remains in force after the JD, resume, preferences, prompt, or model changes.
