## Bug Analysis: Liepin chat composer was not found after the write boundary

### 1. Root Cause Category

- **Category**: D / E - Test coverage gap and implicit assumption.
- **Specific Cause**: the adapter assumed that Liepin's federated IM would render within four seconds and that a unique chat surface could always be inferred from one visible generic text control plus a `button` or `a` whose label was exactly `发送`. The top-level-only DOM search could not see a surface mounted in an open ShadowRoot or accessible same-origin iframe. It also treated a rendered send button with the platform's disabled `pointer-events:none` state as invisible, and used the input wrapper as the greeting evidence root even though Liepin renders the outbound message in a sibling message-list subtree. The old visibility helper also checked only the leaf element's style, so controls mounted below a hidden ancestor could be treated as visible.

### 2. Why Earlier Fixes Failed

1. The earlier job-bound action fix proved that the correct `chat-chat` control could be selected, but it stopped at the click boundary and did not cover the asynchronously rendered IM component.
2. Existing synthetic fixtures rendered a textarea and enabled button immediately in the top document and appended the outbound bubble inside the same input wrapper. They could not fail on a five-second remote load, a rendered-but-disabled send button, a non-button `.im-ui-basic-send-btn`, an extra chat-local input, an ancestor-hidden pre-mounted surface, a composed-tree surface, or a sibling message-list read-back.
3. The database correctly preserved a post-write failure, but it stores bounded evidence rather than DOM. That made the missing fixture the key diagnostic gap.

### 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Platform contract | Prefer the observed `.im-ui-chat-input` / `.im-ui-textarea` / `.im-ui-basic-send-btn` namespace and require one local pair | Done |
| P0 | Bounded async wait | Allow 15 seconds for the federated IM surface while keeping the background content watchdog at 120 seconds | Done |
| P0 | Visibility safety | Reject controls and evidence hidden by any ancestor | Done |
| P0 | Composed-tree search | Traverse top document, open ShadowRoot, and accessible same-origin iframe; skip cross-origin frames | Done |
| P0 | Rendered vs clickable | Keep visible disabled send controls discoverable, then require enabled state after filling | Done |
| P0 | Evidence root | Verify outbound text from the nearest unique `.im-ui-chat-container`, which owns the input and sibling message list | Done |
| P0 | Regression tests | Cover current IM classes, five-second rendering, rendered-but-disabled send controls, sibling message-list read-back, extra inputs, non-button send controls, hidden ancestors, ShadowRoot, and same-origin iframe | Done |
| P1 | Live acceptance | Verify the next approved opportunity against the real post-click surface without replaying the failed opportunity | Pending user action |

### 4. Systematic Expansion

- **Similar Issues**: resume dialogs, application evidence, and greeting evidence all share the same visibility and composed-tree helpers and now inherit ancestor-aware rejection.
- **Design Improvement**: platform-owned class contracts are preferred before the conservative structural fallback; neither path may select a page-wide arbitrary input or send control.
- **Process Improvement**: every live DOM fix must add a minimal synthetic fixture for the exact post-action state and use virtual time for delayed remote components.

### Follow-up: outbound evidence was still missed after the first hardening pass

The next live report was `greeting_attempted / outbound_greeting_unverified` even though the job seeker saw the message in the Liepin app. The public IM bundle confirms that a normal text message is rendered as `im-ui-txt im-ui-send` (direction `"0"`) inside `.im-ui-txt-content`, under `.im-ui-message-list-wrapper > .im-ui-msg-list-content`. The adapter had covered the sibling list root, but its evidence wait was still only four seconds and its known selectors did not name the platform-owned send class.

The follow-up fix now waits 15 seconds for greeting evidence, recognizes the platform-owned outbound class and direction markers, joins text split across nested spans, and checks for an exact outbound message already present before filling or clicking. An inbound message with identical text remains a negative case. The adapter continues to fail closed when the only confirmation exists outside the current desktop DOM (for example, the mobile app); that case remains attempted/needs-review and is never silently promoted to verified.

A related presentation bug surfaced after the adapter began returning independent component results: when greeting verification succeeded but application verification did not, the final `latestReason` was the greeting success message, so the batch appeared to pause “because greeting was verified.” The partial reason is now derived from both component statuses and is reused by automatic batch state plus record-center views. This keeps the required pause while naming the missing application evidence and prevents an event-ordering detail from obscuring recovery work.

### 5. Knowledge Capture

- [x] Updated the cross-layer contract with the observed IM namespace, timeout, visibility, validation cases, and required assertions.
- [x] Added focused adapter regression tests, including delayed message insertion, split text, actual `im-ui-txt.im-ui-send`, pre-existing exact messages, and inbound same-text rejection.
- [x] Added a partial-delivery regression proving a verified greeting does not mask missing application evidence in batch and record-center reasons.
- [x] Confirmed this application repository has no `src/templates/markdown/spec/` mirror to synchronize.
- [ ] Complete a new 1-item live acceptance; the failed `79824963` attempt remains post-write and must not be automatically replayed.

### Evidence And Confidence

- **Observed**: database events span about 4.4 seconds from `delivery_write_started` to `composer_missing`, matching the old four-second polling boundary plus interval overhead.
- **Observed**: Liepin's current public IM stylesheet declares `.im-ui-chat-input`, `.im-ui-textarea`, and `.im-ui-basic-send-btn`.
- **Observed**: the live detail page still showed `聊一聊`; the database has no verified application or greeting evidence, but the write-start marker and quota reservation make automatic replay unsafe.
- **Confidence**: high that the old timeout was reached; high that top-level-only search was insufficient after the selector path still failed at 15 seconds. The ancestor-hidden case is preventive hardening supported by a deterministic reproduction, not claimed as the sole live root cause.
