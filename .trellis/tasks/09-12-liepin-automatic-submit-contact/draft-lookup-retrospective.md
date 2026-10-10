# Draft identity lookup after history grows

## Report and diagnosis (2026-10-06)

Human review followed by generate-and-deliver produced a pending draft, then
failed with “当前草稿修订不存在” before opening a recruitment tab.

Read-only Cloud SQL confirmed 537 current drafts and 540 revisions. Every draft
had a revision matching its text. All eight most recent drafts were absent from
the user's first 500 draft rows, while exact lookups found their revisions. These
records had no delivery record. No JD, draft text, password or token was logged.

Root cause: listDrafts read an unordered global limit(500) and callers used this
incomplete list as the authority for a single send. The separate oldest-first
revision limit(2000) had the same truncation risk, including the API server's own
row cap. The prior one-click tests mocked complete small lists and could not
reproduce real PostgREST pagination.

## Fix contract

- Sending reads the owned opportunity and its current draft/revision by exact ID.
- Opportunity, draft and revision listing uses stable pagination, including when the server returns fewer
  rows than the requested page size. Errors cannot silently become partial lists.
- Preserve current text/revision/hash validation and RLS. Missing or stale draft
  identity still stops before opening/sending; do not invent a revision.
- Cover more than 500 drafts and more than 1000 revisions with synthetic data and
  a simulated server row cap. Confirm the old implementation fails the regression.
- Keep previously generated drafts and all delivery evidence; no Cloud repair or
  replay is required. Rebuild the extension for the existing Cloud project.

Baseline npm ci and npm run verify passed (22 files / 233 tests).

## Completed verification

- Old query regression: 620 draft rows returned only 500 with API cap 1000,
  or 127 with cap 127. Fixed query returns all 620 drafts and 1240 revisions.
- Exact-target and missing/mismatched revision tests cover rejection before tab
  creation, preflight, quota or writes. No real application was submitted.
- Full npm run verify passed (23 files / 246 tests); git diff --check passed.
- supabase test db failed with LegacyDbConnectError because the intentionally
  stopped local database remains unavailable. No SQL or Function changes.
- Configured mirror audit returned 404 NOT_IMPLEMENTED; official npm registry
  audit reported four existing dependency findings (one high, three moderate)
  involving source-map-js and sprintf-js/argparse/mammoth. Dependencies were not
  changed in this focused fix.
- Other delivery/evaluation/event list caps remain outside this fix; authoritative
  delivery RPC validation remains intact.
