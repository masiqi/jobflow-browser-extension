# ADR 0005: Require user-approved resume profiles

- Status: Accepted
- Date: 2026-09-10

## Context

Resume extraction uses untrusted source text and may use probabilistic model output. Automatic extraction can omit facts, misclassify roles, or invent unsupported claims. Reusing an incorrect profile can contaminate every job evaluation and pending message in a batch.

The existing prototype also contains hard-coded employers, roles, target roles, and prohibitions belonging to one person's career history. These are invalid in a multi-user product and demonstrate why extracted data cannot be silently treated as approved truth.

## Decision

Use an explicit profile revision lifecycle:

1. Resume import creates a `draft` profile revision.
2. The user reviews its summary, target roles, skills, education, work history, projects, citable facts, source evidence, and prohibited claims.
3. The user may edit or remove extracted content.
4. An explicit user action publishes the revision as `active`.
5. Only an active revision may be used for job evaluation or pending-message generation.
6. Importing or replacing the authoritative local resume marks the previous active revision `stale`; a new matching revision must be reviewed and activated.

Every citable fact must retain source evidence. Model output and deterministic fallback output follow the same review requirement and cannot activate themselves.

Remove all personal career assumptions from source code, prompts, defaults, tests, and built artifacts. Generic defaults must be empty or demonstrably synthetic and must never prescribe an employer, title, skill, target role, or claim prohibition for all users.

## Consequences

- Initial onboarding has an additional review step before the first job run.
- Profile revisions, statuses, provenance, user edits, activation time, and source hash become persisted domain data.
- Runs and generated messages must record the exact active profile revision used.
- Replacing a local resume invalidates the active profile and prevents silent use of stale facts.
- Test fixtures must use synthetic identities and employment histories.
