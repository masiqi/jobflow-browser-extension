# Traffic and data loading

JobFlow's Supabase traffic includes database responses as well as Edge Function
responses. Avoid downloading the whole record center to update local progress.

## Read boundaries

- `GET_APP_STATE` accepts a view. An omitted view means the lightweight side panel.
- Side panel: eight recent opportunity summaries, matching delivery states, the
  current item and the most recent partial item when needed, plus local queue and
  scan state. No JD, draft history, evaluation history, or resume profiles.
- Record center: one page of at most 50 summaries with server-side status/search
  filters. The selected record alone supplies its JD, draft revisions, evaluations
  and events. Previous/next controls retain access to older records.
- Resume page: profiles and facts. Account/model/rules pages load no record history.
- Scan deduplication queries only the visible candidate platform/job IDs, using
  identity/status fields. It does not download old JDs or forget older exclusions.
- Queue work looks up its exact opportunity; send-time draft verification reads
  the current draft and newest revision, independent of total history size.

Display reads use a 30-second owner-scoped in-memory cache, coalesce identical
pending loads, and invalidate affected entries after mutations. Explicit refresh
bypasses the cache. Logout and owner changes clear cached private data. Old
requests cannot repopulate invalidated cache entries or overwrite account settings.
Queue/scan progress stays local and updates immediately. Presentation cache is
never used to authorize a send, choose a send revision, or reserve quota.

Options progress messages update local DOM; ordinary view/record requests are
scoped. Side-panel notification bursts coalesce. The countdown does no network
I/O. Model generation still sends the current job/profile required by the existing
gateway contract; it does not send a user's history. Server hydration and model
output validation remain intact.

## Validation evidence

Synthetic tests exercise a history of more than 7,000 opportunities with large JDs:
one 50-row summary page remains below 35 KB for that fixture, with response bytes
independent of unrelated history. A current-draft lookup with 2,000 old revisions
uses two requests and less than 1 KB in its fixture. One hundred repeated side-panel
snapshots within the cache window read summaries/deliveries once; profile/history
queries remain absent. These are regression budgets, not a billing guarantee.

A read-only aggregate of the deployed data on 2026-10-09 estimated opportunity JSON
sizes of 5,460,307 bytes for all records, 6,849 bytes for eight recent summaries,
and 37,412 bytes for 50 recent summaries. These are database JSON sizes before
wire encoding/compression, not measured Supabase billed bytes.

Usage already incurred remains in the current billing period. After rebuilding
with Cloud public configuration, Reload the extension and reopen existing options
and side-panel pages so old JavaScript no longer requests the previous full state.
No SQL migration or Edge Function redeployment is needed for these client read changes.
