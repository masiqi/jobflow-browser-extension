# Debug Retrospective: first Liepin reviewed send

## 1. Root Cause Category

- **Category**: B / D / E - Cross-layer contract, test gap, and implicit platform assumptions.
- **Specific cause**: the first adapter assumed `聊一聊` only opened a composer, treated any resume-like classes as an ambiguous picker, searched the whole document for inputs, and treated `已沟通` as application evidence. The real platform instead sent its own default greeting immediately, exposed a disabled chat composer plus `发简历`, then opened one selected attachment/default-online-resume confirmation before rendering a resume card.

## 2. Why Initial Attempts Were Partial

1. The first live action correctly stopped before filling, but a broad class heuristic falsely labeled the open chat as an ambiguous resume picker.
2. The second attempt sent and exactly verified the reviewed custom greeting, but did not recognize the attachment confirmation or rendered resume-card shape, so application remained attempted.
3. The third attempt actually delivered the selected attachment/default online resume, but the verifier still lacked the real `这是我的简历` / online-resume / attachment-resume evidence vocabulary.
4. The final recovery reused the same quota and existing conversation, skipped the already verified greeting, read the existing resume card, and projected both components to verified without another send.

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Trust boundary | Only exact options-page PREPARE/CONFIRM may initiate live work | Done |
| P0 | DOM scope | Bind composer/send to one chat-local surface; never select page-global controls | Done |
| P0 | Evidence | Separate platform default greeting, reviewed greeting, conversation state, and resume-card evidence | Done |
| P0 | Recovery | Persist independent components and never replay verified work | Done |
| P0 | Quota | Distinguish reserved/write-started/released and reuse one opportunity unit | Done |
| P0 | Idempotency | Duplicate request IDs are full no-ops; verified components survive concurrent updates | Done |
| P1 | Fixtures | Add disabled composer, selected attachment confirmation, existing chat, resume card, and false-positive tests | Done |

## 4. Systematic Expansion

- Every platform-native combined action must be treated as an unknown multi-effect boundary until post-action UI is observed.
- Action labels such as `已沟通` describe conversation state, not formal application.
- Evidence selectors should prefer local structure and exact content over broad class-name taxonomies.
- A failed verifier after an irreversible action requires read-only evidence recovery, not automatic replay.
- External-write quotas need database concurrency behavior, not only single-client UI guards.

## 5. Knowledge Capture

- Cross-layer signatures, state transitions, quota rules, real Liepin sequence, evidence rules, and wrong/correct examples are recorded in `.trellis/spec/frontend/jobflow-cross-layer-contracts.md`.
- ADR 0001 records the separately approved single-opportunity reviewed-send boundary.
- ADR 0002 records Liepin's platform-default greeting and resume-confirmation sequence.
- ADR 0017 records activation of Asia/Shanghai reviewed-send quota reservations.
