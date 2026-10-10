# Supabase egress reduction (2026-10-09)

## Approved scope

User requested a complete audit and reduction of unnecessary traffic, especially
GET_APP_STATE, after the Free quota reached 14.33 GB. Preserve historical identity,
RLS, manual/automatic write authorization, current draft hash and quota guarantees.

## Design and implementation

Separate view reads, summary pagination and exact selected detail. Default state
is a lightweight side-panel projection, not all history. Deduplication uses scoped
candidate identities; queue/send paths use exact lookups. Display-only caches are
owner-scoped, bounded, expire after 30 seconds, merge pending requests, and invalidate
after writes. Authentication for authoritative actions stays fresh.

UI progress updates locally; records have server filters, 50-row pagination and
selected detail outside the active filter during an in-flight review/send. Stale
renders cannot replace a newer view. Rendering never persists local settings;
processing independently reads its small cloud rule configuration.

Model-gateway already loads only current opportunity identity/profile/facts.
Preserve that wire contract and server validation. No hosted schema/function
changes, deletion, model calls, or live recruitment sends required.

## Verification plan

- Backend transport tests bound returned bytes and requests independently of
  thousands of unrelated JDs/revisions; handle smaller server caps and safe search.
- Runtime tests prove GET_APP_STATE does not call whole-history getters, coalesces
  bursts, preserves local stage updates, invalidates writes and isolates owners.
- UI tests cover view/page/filter/detail requests, local-only progress/countdowns,
  out-of-order responses and complete one-click flow feedback.
- Reviewer findings: include previous partial item's authoritative delivery state;
  remove display settings persistence to prevent cross-owner overwrite. Both fixed
  with regression tests.
- Run full verify, audit, diff/secret checks; local DB tests may be unavailable
  because the user intentionally stopped the local database. Rebuild for Cloud.

See docs/traffic-and-data-loading.md for before/after data-volume evidence.

## Completed checks

- Full npm run verify: 26 files / 293 tests passed; includes schema bounds,
  independent processing rules and partial-delivery recovery display regressions.
- Read-only Cloud SQL aggregate measured the JSON sizes in the traffic document;
  anonymous Cloud REST search syntax probe returned HTTP 200 without retrieving
  private data. No hosted writes or recruitment sends performed.
- supabase test db returns LegacyDbConnectError with the local service stopped.
- npm mirror audit is unavailable (404 NOT_IMPLEMENTED). Official npm audit found
  four existing vulnerabilities (one high source-map-js, three moderate via
  sprintf-js/argparse/mammoth); no dependency versions changed in this task.
