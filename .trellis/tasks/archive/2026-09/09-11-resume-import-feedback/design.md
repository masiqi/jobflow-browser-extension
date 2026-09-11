# Design: Reliable detail capture and durable JD records

## Boundaries

- `src/platforms/liepin.ts` produces a runtime-valid `DetailJob` from the public detail DOM.
- `src/content/liepin.ts` sends `DETAIL_READY` and checks the background acknowledgement. A rejected payload is converted to `DETAIL_FAILED` so the batch terminates with the actual boundary error.
- `src/background.ts` validates the runtime message, acknowledges detail readiness by clearing its alarm, persists the detail, then continues with profile, rule, and model processing.
- `src/backend/supabase.ts` is the browser-side adapter for the named owner-scoped RPC.
- A new additive Supabase migration owns detail persistence, identity validation, state projection, and the append-only event.
- `src/options.ts` renders the already-loaded `OpportunityRecord.description` and recruiter fields; it performs no Liepin read.

## Persistence Contract

`record_job_details(target_opportunity_id, target_request_id, job, target_jd_hash)`:

- requires `auth.uid()`;
- requires the target row to belong to the caller and match `job.platform` plus `job.jobId`;
- requires a non-empty description no longer than 60,000 characters and a lowercase 64-character SHA-256 hash;
- stores description, recruiter, recruiter title, hash, and `current_status = extracting`;
- appends `details_captured` with only `jd_hash` and `description_length`;
- uses the existing `(opportunity_id, request_id, kind)` event uniqueness for idempotency;
- never stores full JD text in the event payload.

## Ordering

```text
validated DETAIL_READY
-> clear detail-readiness alarm
-> mark local batch item extracting
-> find owned opportunity
-> hash and persist detail
-> load active profile
-> deterministic rules
-> suitability model
-> greeting model
```

If detail persistence fails, the batch item fails visibly and no rule or model call occurs.

## Compatibility

- Additive migration only; existing opportunity rows remain valid with nullable detail fields.
- Failed identities remain retryable under the existing policy.
- Existing filter/evaluation RPCs may continue refreshing detail fields, but the first durable write no longer depends on their success.
- No host permission, platform-write behavior, scrolling, pagination, or Cookie access changes.

## Safe Model Diagnostics

The Edge Function owns raw provider content and never returns it. When output schema validation fails it returns a bounded `diagnostics` object:

```text
requestId, operation, provider, model, stage
outputKind
fields[] = allowlisted expected name + JSON type only
missingFields[] = allowlisted expected names only
unknownFieldCount
issues[] = sanitized allowlisted path + Zod code only
```

The browser validates this object before use, logs it under a stable Service Worker Console prefix, and formats a compact message for `BatchItem.error` / `latestReason`. Unknown keys and all values are discarded before diagnostics are constructed.

## Stored-detail retry

The management page sends a strict `RETRY_STORED_OPPORTUNITY` command containing only an opportunity UUID. The background reloads the owner-scoped opportunity, requires `failed` plus a non-empty persisted description, reconstructs a runtime-valid `DetailJob` from the stored projection, and processes it through the same shared deterministic-filter, suitability, greeting, and persistence function used after a live detail capture.

The shared function starts after detail acquisition. It never opens or closes a tab. Batch processing remains responsible for the detail lease and durable capture; stored retry bypasses those two steps because its JD is already durable. The retry path validates the active profile and selected model credentials before making a model request, persists a redacted failure on any downstream error, and refreshes extension state when it finishes.

The suitability prompt explicitly mirrors the Zod cardinality contract: `reasons` contains 1-6 items, `jdEvidence` contains no more than 6 excerpts (with at least one for `exclude`), and `factIds` contains no more than 6 IDs selected from approved facts. This fixes the root mismatch instead of weakening validation.

Both suitability and greeting prompts also mirror the grounding validator: each `jdEvidence` value is a verbatim contiguous excerpt from the stored description, never a paraphrase, summary, or ellipsis. Runtime grounding remains strict and is not weakened to accommodate model output.

Because the Edge Function owns the actual provider call, its prompts explicitly enumerate the suitability outcome tokens, optional score range, suitability array bounds, and greeting evidence/fact bounds. The browser-side prompt builders keep the same contract and source regressions prevent either copy from silently losing constraints.

## Rollback

- Revert the extension calls and UI section while leaving the additive RPC harmlessly available.
- The new columns are pre-existing, so no destructive schema rollback is required.
- Stored retry adds no schema and can be removed independently while retaining captured JD data.
