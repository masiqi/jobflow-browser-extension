# Single-click human approval and delivery

## Approved requirement (2026-09-26)

The user reviews a pending-review opportunity in the options record center and
wants one explicit button to generate the greeting, prepare delivery, and submit
and contact that exact opportunity. This supersedes the earlier requirement for
three separate clicks on this path. Permanent exclusion remains available.

## Design and acceptance

- Offer an explicitly labeled generate-and-deliver action for pending-review
  Liepin opportunities when execution policy allows writes. Keep draft-only and
  Zhaopin generation behavior.
- Human approval authorizes generation and delivery for one owned opportunity;
  do not rerun a suitability veto after this approval. Preserve prior evaluations.
- Background owns the whole operation and binds the generated, persisted draft
  revision/hash to the existing preflight and delivery core.
- Guard duplicate operations and cross-context requests; revalidate owner,
  current draft, execution policy and opportunity state before writes.
- Busy state acknowledges clicks immediately and reports generation, preflight,
  and delivery progress across state notifications and UI re-renders.
- Generation/preflight failures send nothing. Post-write uncertainty preserves
  evidence and requires explicit recovery; never replay automatically on reload.
- Existing quotas, platform checks and component evidence remain authoritative.
- Use synthetic tests; no real recruitment-site writes are needed for acceptance
  of the code change. Build the final extension with the existing Cloud public
  configuration, never with secrets.

## Validation

Baseline: npm ci and npm run verify passed (22 files, 212 tests).
Add focused orchestration and UI tests, run full verification, inspect the Cloud
build and secret exclusion, and report any unavailable local DB checks.

Completed implementation: REVIEW_AND_SEND plus display-only progress messages,
options-page one-click action, shared reviewed delivery core and final pre-write
context guard after quota awaits. Original suitability decisions remain intact.

Validation on 2026-09-26: full npm run verify passes 22 files / 233 tests;
official-registry npm audit reports zero vulnerabilities. The configured mirror
audit endpoint returned 404 NOT_IMPLEMENTED. supabase test db cannot connect to
the intentionally stopped local database (LegacyDbConnectError); no SQL or Edge
Function changes were needed. Tests use synthetic platform responses; no live
application was submitted for this change.
