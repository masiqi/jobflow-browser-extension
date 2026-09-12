# ADR 0002: Combine application and greeting as one user intent

- Status: Accepted
- Date: 2026-09-10

## Context

The future outbox can expose single-item and selected-batch actions. The word “send” is ambiguous because a recruitment platform can distinguish formally applying for a job from opening a conversation and sending a greeting.

The job seeker wants both effects when authorizing an outbox item. The platform may expose them as one control or as two separate operations, and either operation may fail independently.

## Decision

The product command is **submit and contact**: for the same job opportunity, formally submit the resume and send the approved greeting.

This is one user intent but two independently recorded outcomes:

- `application`: whether formal resume submission has platform-read evidence.
- `greeting`: whether greeting delivery has platform-read evidence.

The combined command is successful only when both outcomes are verified. If exactly one succeeds, the item is partially complete rather than successful or wholly failed. Retrying a partially complete item must not repeat an already verified outcome.

When Liepin exposes a native combined operation, the adapter should prefer it only if both component outcomes can be read back independently. When separate operations are required, the adapter must:

1. Submit the resume and verify the application outcome.
2. Stop without sending the greeting if application verification fails.
3. Send the approved greeting only after the application is verified.
4. Preserve partial completion if greeting delivery cannot be verified.
5. On retry, execute only the component without success evidence.

This decision did not authorize the original draft-only milestone. The separately approved single-opportunity reviewed-send amendment in ADR 0001 now activates it only through explicit management-page confirmation.

## Consequences

- The outbox action should be labeled “投递并打招呼” rather than the ambiguous “发送.”
- The ledger and future state machine need separate application and greeting sub-statuses.
- A batch summary must show full success, partial completion, and failure separately.
- Adapters must distinguish an attempted action from a verified outcome and make retries idempotent at component level.
- User-facing delivery details show application, greeting, and overall status separately; attempted evidence is never labeled successful.

## Liepin observed sequence

The first reviewed-send acceptance on 2026-09-11 established a platform-specific exception to the preferred order:

1. Liepin's `聊一聊` action creates the conversation and immediately sends Liepin's own default greeting.
2. The open conversation exposes `发简历`; it opens a confirmation that identifies the selected attachment and states that the default online resume is also delivered.
3. `立即投递` sends those already-selected resumes.
4. JobFlow sends its reviewed custom greeting and verifies the exact outbound rendered text.

The platform default greeting is not JobFlow greeting evidence. A rendered resume card is application evidence; `已沟通` alone is not. Recovery reuses the open conversation and skips any component already verified.
