# Liepin reviewed send live test

## Goal

Validate one real, user-reviewed Liepin submit-and-contact workflow end to end for one user-authorized opportunity. Use the current approved draft and the resumes already selected by Liepin, then independently verify formal application and greeting delivery. Exact opportunity identifiers remain only in the user's local delivery ledger and are not committed in task artifacts.

## Background

- The user explicitly authorized one irreversible live test and accepts a partial result when only one component can be verified.
- Product terminology defines the user intent as **submit and contact**: formal application first, greeting second, with independent evidence and idempotent recovery.
- Before this task, the extension was intentionally draft-only and had no live state, quota reservation, platform-write content command, or application/message readback.
- The public job page exposes `聊一聊`, not a separate visible application action. Its authenticated behavior must be learned fail-closed during the authorized test.
- The stored draft is `draft_ready`, 129 Chinese characters, and grounded in the current JD/profile.

## Requirements

- Introduce an explicit `reviewed_send` workflow; do not enable automatic or batch sending.
- The management page must show the exact target opportunity, current draft, action composition, resume mode (`platform_default`), and irreversible-write warning before confirmation.
- A live command must originate from a trusted extension page, contain a strict opportunity UUID plus the current draft revision identity/hash, and reject arbitrary message or JD payloads.
- Rehydrate the owned opportunity, current draft/revision, and authenticated user in the background/backend before every step.
- Only an owned `draft_ready` or recoverable partial delivery may start. Excluded, review, failed-generation, stale-draft, or already-complete opportunities must be rejected.
- Do not upload or replace a resume. Use only a resume already selected/defaulted by Liepin; if no unambiguous default exists, stop.
- Perform a read-only preflight before quota reservation: confirm authenticated job identity, one visible enabled `聊一聊` action, and no risk-control/login page.
- Immediately before the first possible platform write, atomically reserve one Liepin daily unit for the user/opportunity under the Asia/Shanghai calendar day. Repeated attempts for the same opportunity must reuse the reservation.
- The initial configurable Liepin daily limit is 150. This is a product limit, not a claim about Liepin's official allowance.
- Use only public rendered DOM and normal user-interface actions. Do not use Cookie access, private write APIs, broad host permissions, automatic scrolling, pagination, or unrelated platform navigation.
- Treat the first `聊一聊` activation as a possible write boundary. Once attempted, keep the quota unit consumed even if the outcome is partial or failed.
- Verify application and greeting independently from post-action rendered state. An attempted click, DOM event completion, or lack of error is not success evidence.
- Application success requires a platform-read state attributable to this job. Greeting success requires an outbound message bubble whose normalized text matches the current draft.
- If the native `聊一聊` action creates the conversation but exposes no independent application-success evidence, continue with the already-authorized greeting, keep application as attempted/unverified, and record partial completion rather than inventing full success.
- If application succeeds but greeting cannot be verified, record partial completion and make a retry execute only the missing greeting step.
- Persist append-only attempts, component states, timestamps, draft revision/hash, quota reservation, and bounded evidence codes. Do not persist full page DOM, screenshots, Cookies, raw browser logs, or duplicate message text.
- The UI must show preflighting, awaiting confirmation, reserving quota, applying, greeting, verifying, succeeded, partial, and failed states with a redacted reason.
- Manual acceptance is limited to the one user-authorized opportunity stored locally. Implementation must remain generic and must not hardcode a personal job ID, account, resume, draft, company, or model value.

## Acceptance Criteria

- [x] Strict schemas reject extra live-command fields, stale draft identity/hash, content-script-originated initiation, and non-UUID opportunity IDs.
- [x] Preflight is read-only and returns only allowlisted UI facts; it performs no click, fill, submit, or quota reservation.
- [x] Login/risk-control, wrong job identity, zero/multiple `聊一聊` actions, disabled controls, or ambiguous resume selection fail closed.
- [x] A named owner-scoped RPC atomically reserves at most one daily unit per opportunity and enforces the user's configured Asia/Shanghai limit.
- [x] The first possible write consumes the reservation; pre-write failure can release it, while attempted writes cannot.
- [x] The adapter uses rendered public DOM only and contains no Cookie/private-API path.
- [x] Application and greeting have separate attempted/verified/failed evidence and derive full/partial/failed delivery state.
- [x] Retry never repeats a component with verified evidence.
- [x] A greeting is reported delivered only after matching the current draft in an outbound rendered message bubble.
- [x] The management page requires explicit per-opportunity confirmation and shows durable progress/result feedback.
- [x] Unit, state-machine, database/RLS/idempotency, content-fixture, safety, Edge integration, and Chrome smoke tests pass.
- [x] Manual acceptance used only the one user-authorized opportunity, recorded application and greeting evidence separately, and contacted no other recruiter.

## Out Of Scope

- Automatic send, batch send, background send, pagination, scrolling, or sending on page open.
- Follow-up conversation automation, HR rejection detection, or off-platform contact exchange.
- Uploading the client-side source resume or selecting among ambiguous platform resumes.
- BOSS Zhipin or any platform other than Liepin.
- Private Liepin APIs, WebSocket internals, Cookie access/export, or broad host permissions.
- Claiming complete success when either application or greeting lacks platform-read evidence.

## Open Questions

- None. The authorized test accepts partial completion and uses Liepin's unambiguous default resume only.
