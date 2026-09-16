# Design: Liepin automatic submit and contact

## Context

The accepted single-opportunity reviewed-send flow already owns the hard parts of a Liepin write: authoritative opportunity and draft identity, a short-lived content preflight lease, an Asia/Shanghai daily quota reservation, component-level attempted and verified evidence, and recovery that never replays a verified component. Automatic mode should compose that mechanism into the existing serial batch queue rather than create a second sender. During the current debugging phase, automatic mode also has an explicit click-assumed completion fallback for a dispatched final control when Liepin does not expose readable post-write evidence.

The new authorization boundary is one explicit side-panel click for one visible selection. Merely persisting `automatic_send`, opening or filtering a page, scanning, rendering UI, or restarting Chrome cannot authorize a platform write.

## Execution Policy And Compatibility

Add the domain type:

```typescript
type ExecutionPolicy = "draft_only" | "reviewed_send" | "automatic_send";
```

`ExtensionSettings.executionPolicy` is parsed by the canonical strict schema and stored in trusted Chrome storage. Missing legacy values normalize to `reviewed_send`, which preserves the currently accepted manual workflow. `automatic_send` always requires explicit user selection and save. `draft_only` hides or disables all live controls.

Add `automaticSendDelayMinSeconds` and `automaticSendDelayMaxSeconds`. Both are integer seconds in the inclusive 5-600 range, the minimum cannot exceed the maximum, and defaults are 10 and 20. The settings page rejects an invalid pair and retains the previous valid settings.

The account/settings page uses a three-option segmented control. The side panel displays the active policy but does not edit it. Saving a setting performs no scan, model call, quota reservation, or Liepin command.

## Authorization Boundary

`START_BATCH` becomes:

```typescript
{
  type: "START_BATCH";
  selectedJobIds: string[];
  expectedExecutionPolicy: ExecutionPolicy;
}
```

The background accepts it only from the exact extension side-panel URL. It reloads trusted settings, requires `expectedExecutionPolicy` to match, validates every ID against the current scan preview, and snapshots the policy and authorization time into the run. The selected IDs in the decoded command are the complete authorization scope; later scan or setting changes cannot expand it.

The automatic side-panel action is a single explicit command such as `一键处理并投递 10 个职位`. It starts immediately without a second modal or per-item confirmation. Non-automatic policies retain a generation-only action.

No web page, content script, page-load listener, scan handler, settings handler, startup handler, or existing-draft view can initiate `START_BATCH` or a live delivery.

## Batch State

Extend the durable batch snapshot with:

```typescript
interface BatchRun {
  executionPolicy: ExecutionPolicy;
  authorizedAt: string;
  deliverySucceededCount: number;
  deliveryPartialCount: number;
  pauseReason?: string;
  nextWriteEligibleAt?: string;
}

interface BatchItem {
  opportunityId?: string;
  draftRevisionId?: string;
  draftSha256?: string;
  blockerPhase?: "pre_write" | "post_write";
  blockerCode?: string;
}
```

Add item stages that make the live boundary visible and recoverable:

```text
delivery_ready
waiting_interval
delivery_preflighting
delivery_in_progress
delivery_succeeded
delivery_partial
blocked
```

The canonical batch schema validates every write and read. `BatchItem.candidate` remains a `ListCandidate`; JD and recruiter details stay only in the owner-scoped opportunity row.

### Normal transitions

```text
queued
-> opening
-> extracting
-> evaluating
-> generating
-> delivery_ready                 automatic_send only
-> delivery_preflighting
-> delivery_in_progress
-> delivery_succeeded
-> next item
```

For `draft_only` and `reviewed_send`, `generating -> draft_ready -> next item` remains unchanged and performs no Liepin write.

An exclusion or review completes the item and advances. A model, grounding, or greeting validation error is recorded as an item failure and advances because no platform write occurred.

### Pause transitions

Pre-write blocker:

```text
delivery_ready / delivery_preflighting
-> blocked(pre_write)
-> run paused without advancing currentIndex
```

After the user resolves the problem and explicitly resumes, the item reopens the exact job and retries only preflight/delivery from its persisted draft identity; it does not call the model again.

Post-write ambiguity:

```text
delivery_in_progress
-> delivery_partial or failed with blockerPhase=post_write
-> advance currentIndex
-> run paused
```

Resuming continues the remaining queued items. The ambiguous opportunity can be recovered only through the existing reviewed-send path, which skips verified components.

During the current development phase, a dispatched final control may use the
click-assumed fallback instead of waiting for page read-back:

```text
delivery_in_progress
-> application_submit_clicked and/or greeting send clicked
-> component completed with an explicit click-assumed evidence code
-> delivery_succeeded when both components are completed
-> next item without automatic replay
```

This exception is available only to `automatic_send`. If the final application
control is not exposed but the greeting send control is dispatched, the
application component uses `application_greeting_click_assumed_success` to
make that composite development assumption explicit. The exception does not apply to
preflight blockers, ambiguous resume selection, missing/disabled controls, or
the stricter `reviewed_send` flow.

## Detail And Draft Flow

The current detail path remains authoritative:

```text
leased detail tab
-> strict DetailJob decode
-> persist JD/recruiter/hash
-> deterministic rules
-> validated suitability
-> validated and persisted greeting draft
```

Only an exact `proceed` plus a valid persisted greeting can enter `delivery_ready`. Automatic delivery reloads the owner-scoped opportunity and current draft after the model gateway returns, chooses the newest revision whose text equals `currentText`, recomputes SHA-256, and stores only revision/hash identifiers in the batch.

Existing `draft_ready` records are not processable automatic inputs. User overrides append `user_override`, preserve the original exclusion, generate a draft, and remain in the two-stage reviewed-send flow.

## Shared Delivery Orchestrator

Refactor the manual background implementation into internal primitives without weakening its callers:

```text
load authoritative delivery identity
-> preflight exact Liepin tab and bind lease
-> record authorization source
-> final preflight
-> reserve daily unit
-> mark write started
-> record component attempts
-> execute existing job-bound content command
-> record application/greeting results
-> derive complete/partial/review-required
```

Manual wrappers retain exact options-page sender validation and the two-stage prepare/confirm lease. Automatic delivery is callable only from the active batch orchestrator with all of these matching:

- run is `running`;
- run policy snapshot is `automatic_send`;
- item is the current selected item;
- opportunity ID and platform job ID match;
- current draft revision and SHA-256 match the persisted batch identity;
- current extension-owned tab matches the job;
- a successful unexpired content preflight lease exists.

The existing narrow content preflight/execute schemas and Liepin adapter are reused. There is no selector, arbitrary text, arbitrary URL, or generic action command.

Use the existing `delivery_confirmed` event with an allowlisted `automatic_batch_authorized` evidence code and bounded run metadata. No new database state is required merely to distinguish the source. Full JD, draft text, DOM, recruiter identifiers, and credentials remain absent from delivery evidence.

The bounded metadata is exactly `{ source: "sidepanel_batch" }`. The database RPC allowlist must accept `source` only for `delivery_confirmed + automatic_batch_authorized`; producer mocks and pgTAP jointly test the tuple before quota reservation or write-start.

## Randomized Write Interval

The interval limits real Liepin write boundaries, not scan, detail, model, or exclusion throughput. The first automatic opportunity may write immediately only when there is no current-device throttle for this owner and platform.

Detail navigation now has an independent conservative device throttle after real-browser risk-control evidence. Each extension-owned detail navigation persists the next 15-30 second eligible timestamp before opening; model time counts toward it. A normal/terminal detail tab remains open for at least 8 seconds. This is platform-respect pacing, not fingerprint spoofing or a risk-control bypass.

The canonical throttle is separate from `BatchRun` so replacing or completing a run cannot reset it:

```typescript
interface AutomaticWriteThrottle {
  ownerId: string;
  platform: "liepin";
  lastWriteStartedAt: string;
  scheduledDelaySeconds: number;
  nextWriteEligibleAt: string;
}
```

Store it in trusted `chrome.storage.local`, validate it strictly before write and after read, and clear it on device-owner change or product-data deletion. Content scripts cannot access it. `BatchRun.nextWriteEligibleAt` may mirror the active wait for rendering, but the owner/platform throttle is authoritative.

Immediately when any JobFlow Liepin write-start marker is accepted, including a reviewed send, load the current valid delay settings and select the delay for the next possible automatic write as a uniformly distributed integer in the inclusive range:

```typescript
delay = min + secureRandomInteger(max - min + 1);
nextWriteEligibleAt = writeStartedAt + delay * 1000;
```

Use `crypto.getRandomValues`; tests inject or stub the random integer source. Persist the complete throttle before issuing the content execute command. A crash after the server write-start marker but before this local persistence already enters the post-write-ambiguity pause path, so it cannot produce an immediate automatic follow-up.

When the next item reaches `delivery_ready`:

- if there is no current-device owner/platform throttle, continue immediately;
- if `nextWriteEligibleAt` is in the past, clear the consumed schedule and preflight immediately;
- otherwise set `waiting_interval`, persist the unchanged timestamp/delay, create a one-shot `chrome.alarms` alarm for that instant, and show the countdown;
- alarm wake reuses the persisted timestamp and never draws again;
- after the wait, run a fresh job-bound preflight before quota reservation and write.

Model processing time naturally counts toward the gap. For example, if the chosen interval is 17 seconds but evaluating the next JD takes 25 seconds, no additional wait is required. Exclusions and reviews do not create or reset a write interval. A newly started batch still honors a throttle left by the prior batch or a reviewed send.

Changing delay settings affects only a delay selected after that change. An already persisted `nextWriteEligibleAt` remains authoritative. Pause preserves the timestamp; cancel clears the alarm but never causes another write. Resume proceeds immediately only when the persisted time has elapsed.

## Write Ordering And Quota

Automatic mode preserves the reviewed-send ordering:

1. Read-only content preflight.
2. Wait for the persisted next-write timestamp when a prior write exists.
3. Recheck the latest run state so a user pause/cancel before the write is honored.
4. Final content preflight after the wait.
5. Atomically reserve one daily unit.
6. Mark the reservation write-started immediately before the first possible platform action.
7. Persist the newly selected interval for the following write.
8. Record both needed component attempts.
9. Execute the job-bound Liepin adapter.
10. Persist platform-read evidence for each component, or the explicit
    automatic click-assumed completion evidence during the development phase.

An unused reservation is released if execution stops before step 5. Once step 5 occurs, the unit is never released. The same opportunity reuses its reservation for manual component recovery.

## Failure Classification

| Failure | Write possible | Batch result |
| --- | --- | --- |
| Deterministic/model exclusion or review | No | Complete item and continue |
| Platform explicitly says the job is paused/stopped/unavailable | No | Record failure reason, complete item, and continue |
| Model envelope/schema/grounding/greeting validation | No | Fail item with bounded reason and continue |
| Login, CAPTCHA, risk control, ambiguous resume, missing/ambiguous action, wrong job | No | Store pre-write blocker and pause current item |
| Daily quota unavailable | No | Store pre-write blocker and pause current item |
| User pause/cancel observed before reservation/write | No | Preserve `delivery_ready`; pause/cancel without send |
| Interval alarm pending | No | Show `waiting_interval`; preserve one chosen timestamp; allow pause/cancel |
| Content transport fails after write-start marker | Yes | Record review-required, advance item, pause batch |
| One component verified | Yes | Record partial, advance item, pause batch |
| Both components verified | Yes | Record success and continue |
| Final application/greeting control was dispatched but page read-back is unavailable in automatic development mode | Yes | Record the component as click-assumed complete with its explicit evidence code and continue without replay |

Unknown failures at or after the write-start marker are always post-write ambiguity. They are never automatically replayed.

## MV3 Recovery

- A service-worker suspension during an intact message/response flow may complete normally.
- A one-shot interval alarm is derived only from a persisted `nextWriteEligibleAt`; wake-up does not randomize again.
- An automatic delivery watchdog covers preflight and execution separately from the detail-readiness timeout.
- A watchdog observing `delivery_in_progress` pauses the batch and records post-write ambiguity; it never sends again.
- Extension installation/update, explicit extension reload, or Chrome startup turns any active automatic batch into `paused` before scheduling work. The side panel explains that the user must resume it.
- A validated `safe.liepin.com` intercept/SMS redirect recovers the current job only from its Liepin HTTPS `backurl`, reports `risk_control`, detaches and activates the tab for the user, and never closes or operates the verification flow.
- A persisted pre-write item with a draft identity resumes from delivery preflight only after that user action.
- Draft-identity recovery skips `record_job_details`; repeated detail capture cannot regress a server projection beyond `extracting`. Historical `extracting` drift is repairable only through a prior exact delivery identity plus the still-current revision/hash.
- A paused generating/evaluating item without a persisted draft revision and hash is not treated as authoritative merely because an existing draft record is present; it reopens a fresh detail page, reruns the safe model processing, and binds the current draft identity produced by that processing before automatic delivery.
- A persisted post-write item is advanced and left for reviewed recovery before remaining items may resume.
- `GET_APP_STATE`, UI rendering, and scan never perform reconciliation that can write to Liepin.

## UI

### Management settings

- Segmented execution-policy control with `仅生成`, `逐条确认`, and `自动投递`.
- `automatic_send` uses explicit real-write wording and is opt-in.
- `draft_only` removes reviewed-send controls; `reviewed_send` and `automatic_send` keep manual controls for existing and overridden drafts.
- Reviewed PREPARE opens an absent exact job tab in the background, retries content readiness, and reloads an exact stale existing tab once without entering the platform write boundary.
- Every asynchronous command button changes label/disabled/`aria-busy` state synchronously; user-requested generation is also single-flight per opportunity in background state.

### Side panel

- Continue showing observed, processable, duplicate, drafted, selected, and upper-limit counts plus the selectable list.
- Show the policy snapshot for the next run.
- In automatic mode, render one primary real-write action containing the selected count.
- Settings expose minimum and maximum delay inputs beside the automatic policy; the side panel shows the currently configured range and a live countdown only when waiting.
- During a run, show the current title and stage plus draft, excluded, review, failure, complete-delivery, and partial-delivery counts.
- A pause reason is persistent and inline. Resume/cancel remain explicit controls.
- Click-assumed completion reasons explicitly state that the control was clicked
  and page read-back was not awaited; this evidence mode is not silently
  presented as platform verification.
- Long operations enter `aria-busy`, disable duplicate starts, and never rely only on a toast.

## JD History And User Override

`recordJobDetails` remains before rule/model work. Opportunity events, evaluation, draft revisions, user override, delivery attempts, and quota history remain append-only. The management page exposes domain actions rather than a free-form status editor. This preserves the fact that the model rejected a job even when a later user exception produces and manually sends a draft.

## Security And Rollback

- No permissions, Cookies, broad origins, file upload, or private Liepin API are added.
- Safety tests replace the absolute automatic-send prohibition with an allowlist: exact side-panel batch authorization plus the existing job-bound adapter only.
- `automatic_send` is not accepted from the options page, content script, host page, or page-load path.
- Rollback changes the policy to `reviewed_send` or removes the automatic branch. Existing delivery and quota evidence is retained.
- External writes cannot be rolled back. Manual acceptance starts with 1-3 synthetic-safe or user-approved real opportunities and reports only verified evidence.
- Randomized timing reduces bursts but is not presented as a guarantee against platform risk controls.
