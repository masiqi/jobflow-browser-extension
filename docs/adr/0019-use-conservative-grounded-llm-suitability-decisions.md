# ADR 0019: Use conservative, grounded LLM suitability decisions

- Status: Accepted
- Date: 2026-09-10

## Context

The LLM is allowed to permanently exclude a platform job identity after deterministic JD rules pass. A permissive exclusion policy would create irreversible false negatives, while a score threshold provides apparent precision without reliable evidence.

## Decision

Use a conservative three-state suitability contract:

- Proceed: at least one core JD responsibility or requirement has a credible connection to approved resume facts, with no explicit core conflict.
- Review: profile evidence is insufficient, JD language is ambiguous, only optional or preferred capabilities are missing, or seniority, years, management scope, or technical depth cannot be determined reliably.
- Exclude: the primary work direction clearly conflicts with an approved target direction or explicit profile constraint, or multiple core responsibilities have no related approved facts and a truthful targeted greeting cannot be grounded.

Do not let any of these independently produce exclusion:

- title mismatch;
- one skill absent from the profile;
- an optional, preferred, bonus, or familiarity-only qualification;
- a numeric model score.

Every exclusion cites core JD evidence and identifies the approved profile fact, target direction, explicit constraint, or multi-responsibility evidence gap supporting it. If the output cannot provide verifiable evidence, it must choose review.

A numeric match score may support display and ordering but never determines the state.

## Consequences

- More opportunities enter review instead of being aggressively removed.
- Model output validation needs semantic evidence references in addition to JSON shape.
- Permanent exclusion remains defensible in the record center.
- Synthetic evaluation fixtures must emphasize false-negative prevention.
