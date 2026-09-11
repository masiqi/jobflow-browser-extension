# Debug Retrospective: Batch selection drift and false detail timeout

## 1. Root Cause Category

- **Category**: B / D / E - Cross-layer contract, test coverage gap, and implicit assumption.
- **Selection cause**: the DOM held the user's current selection, while every state notification rebuilt it from the scan-time `selectedJobIds`. The command payload was correct, but the projection shown after submission was stale.
- **Visibility cause**: `BatchItem.error` and `OpportunityRecord.latestReason` were persisted but omitted from the side-panel projection.
- **Timeout cause**: a detail-readiness alarm was treated as a whole-item timeout. It remained active during model requests even though the model gateway permits a longer timeout than detail readiness.
- **Second timeout cause**: the detail adapter emitted `index = -1` while `detailJobSchema` requires a nonnegative list index. The background rejected `DETAIL_READY`, and the content script ignored the negative acknowledgement until the lease expired.
- **Durability gap**: detail fields were saved only as a side effect of later filter/evaluation RPCs, so a boundary or provider failure discarded an otherwise readable JD.
- **Observability gap**: every Zod failure became `invalid_schema`; raw output was correctly discarded, but no non-sensitive shape summary survived for debugging.

## 2. Evidence and Updated Beliefs

| Hypothesis | Prior | Discriminating evidence | Final confidence |
| --- | ---: | --- | ---: |
| The backend received the wrong selection | 30% | The persisted run was exactly `0/1`, then `1/1` | <1% |
| A stale UI projection restored defaults | 50% | `previewMarkup` always read scan-time defaults after `RUN_UPDATED` | >99% |
| The detail page or selector no longer worked | 45% | The real page loaded in under one second and the primary selector returned 2265 characters | <5% |
| The detail alarm covered model processing | 30% | Detail alarm was 90 seconds, provider timeout 120 seconds, and the alarm cleared only in final item completion | >95% |
| Adapter output failed the runtime schema | 40% | Production extractor plus production schema reported only `index: too_small`; changing `-1` to `0` made the real payload valid | >99% |

## 3. Why Existing Checks Missed It

1. Batch domain tests proved selected IDs create the correct run but did not render the scan preview again after submission.
2. Side-panel smoke checked layout and loading only, not mutable selection projection or failure details.
3. Detail fixtures proved extraction, but no contract asserted when the detail-readiness alarm stopped owning the operation.
4. Detail fixtures asserted selected fields but never parsed the complete result with the runtime message schema.
5. `DETAIL_READY` treated send completion as success without checking the `{ ok, error }` acknowledgement.

## 4. Prevention Mechanisms

| Priority | Mechanism | Specific action | Status |
| --- | --- | --- | --- |
| P0 | Test coverage | Re-render after a one-item selection and assert one item remains selected | Done |
| P0 | Timeout ownership | Clear the detail alarm before filters and model calls; assert source ordering | Done |
| P0 | Failure visibility | Render item and opportunity failure reasons in the side panel | Done |
| P1 | Code spec | Document transient selection ownership and phase-owned timeouts | Done |
| P0 | Boundary validation | Parse every synthetic detail fixture through `detailJobSchema` | Done |
| P0 | Durable capture | Persist validated details before rule/model work with owner and identity checks | Done |
| P0 | Safe observability | Return allowlisted output types and issue paths/codes, then validate again before browser logging | Done |
| P2 | Future integration | Add a Chrome fixture that delays provider response beyond detail readiness without exceeding provider timeout | Deferred |

## 5. Systematic Expansion

- Audit future `RUN_UPDATED` projections for unsaved user edits before rebuilding controls from persisted defaults.
- Every new alarm needs an explicit start event, terminal event, and test proving it cannot fire in a later phase.
- Every terminal state shown in a compact UI must include a redacted reason or a direct detail affordance.
- Every content-to-background acknowledgement must distinguish transport completion from domain acceptance.
- Platform data that must survive downstream failure is persisted at its own boundary, not as a side effect of a later model result.
- Privacy and diagnosability are not opposites: record schema shape and boundary metadata, never untrusted values or raw content.

## 6. Stored replay: prompt/schema drift

- **Category**: B / C / D - Cross-layer contract, change propagation failure, and test gap.
- **Cause**: output schemas enforced cardinality, enum, and exact-grounding constraints that the actual Edge provider prompts did not state. A separate browser prompt copy made the contract look more complete than the code that performed the real request.
- **Evidence**: safe stored replays progressed deterministically from `factIds:too_big`, to unlocatable JD evidence, to `outcome:invalid_value`; after the Edge prompt enumerated the same schema constraints, the same stored JD produced one valid `proceed` evaluation and a 129-character grounded draft.
- **Prevention**: prompt source regressions now assert the real Edge suitability enum/ranges and both prompts' verbatim evidence rule; a stored-detail retry provides an agent-runnable production-data feedback loop without reopening Liepin or exposing raw model output.
- **Expansion**: any future model output field with an enum, min/max, exact source evidence, or approved-ID rule must be represented in the provider prompt and its source regression in the same change.
