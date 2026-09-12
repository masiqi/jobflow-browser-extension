# Design: reviewed Liepin submit-and-contact

## Trust boundaries

- `options.ts` owns per-opportunity review and confirmation. It sends only an opportunity UUID and the displayed current revision identity/hash.
- `background.ts` rejects live initiation unless `sender.url` is the extension's own options page, reloads all authoritative state, owns tab leases, and sequences preflight, quota, application, greeting, and verification.
- `content/liepin.ts` decodes a narrow leased command, verifies current job identity, and delegates to a Liepin DOM adapter. It never sees auth tokens, BYOK, source resumes, or other opportunities.
- Supabase named RPCs own quota reservation and append-only delivery transitions under `auth.uid()` and row-level ownership checks.

## State model

Add a delivery record keyed uniquely by opportunity:

```text
overall: ready | preflighting | awaiting_confirmation | in_progress | partial | succeeded | failed
application: pending | attempted | verified | failed
greeting: pending | attempted | verified | failed
resume_mode: platform_default
draft_revision_id + draft_sha256
reservation_id + write_started_at
```

Events describe `delivery_preflighted`, `delivery_confirmed`, `daily_unit_reserved`, `application_attempted`, `application_verified`, `greeting_attempted`, `greeting_verified`, `delivery_partial`, and `delivery_failed`. Evidence is an allowlisted code plus bounded metadata such as matched text length or status label category, never full DOM or message content.

## Sequence

```text
options review
-> trusted PREPARE_REVIEWED_SEND
-> background reloads owned opportunity/current draft
-> active Liepin detail tab with job-bound lease
-> content read-only preflight
-> options displays preflight and explicit confirmation
-> trusted CONFIRM_REVIEWED_SEND with same revision/hash
-> RPC reserve daily unit
-> application/native contact action attempt
-> rendered application evidence readback
-> greeting fill/send only when sequencing permits
-> outbound bubble exact-text-hash readback
-> RPC records component evidence and derives succeeded/partial/failed
```

The adapter treats `聊一聊` as an unknown native boundary until the authorized run observes its post-click UI. It reports a bounded state taxonomy rather than persisting raw markup. If clicking it creates the conversation but no independent application evidence, the authorized test may still send and verify the greeting; application remains attempted/unverified and the delivery remains partial.

## Idempotency and recovery

- One reservation exists per user/platform/opportunity and is reused across days for retries of that opportunity.
- Each component has at most one verified transition; repeated RPC request IDs and verified-component commands are no-ops.
- A service-worker restart resumes only from durable component state and a job-bound lease. It never infers success from an earlier attempted state.
- A stale draft after preflight invalidates confirmation and requires a new preflight.

## Security and rollback

- No permission expansion is expected; existing exact Liepin host access is sufficient.
- Replace the blanket draft-only safety assertion with an allowlisted reviewed-send adapter assertion while retaining explicit bans on private APIs, Cookies, form submission shortcuts, automatic triggers, and broad hosts.
- A feature flag cannot silently unlock live mode. The only entry is the explicit reviewed action plus per-item confirmation.
- Rollback disables/removes the UI command and content write command while retaining append-only attempts and quota history for audit.
- External writes cannot be rolled back. Any ambiguous post-write result remains attempted/partial and is never retried automatically.
