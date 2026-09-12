# Implementation Plan

- [x] Add domain types and pure projection tests for delivery component/overall states, including all partial and idempotent retry paths.
- [x] Add migrations and pgTAP tests for owner-scoped delivery records/events, Asia/Shanghai daily reservations, limit enforcement, request idempotency, and cross-user rejection.
- [x] Add configurable Liepin daily limit with a default of 150 and strict runtime/storage validation.
- [x] Add strict trusted-page prepare/confirm commands and job-bound background/content leases.
- [x] Build a fail-closed read-only Liepin preflight adapter with synthetic login/risk/wrong-job/zero/multiple-action/default-resume fixtures.
- [x] Add management-page reviewed-send confirmation and durable progress/partial/success/error UI.
- [x] Add the minimal allowlisted DOM application/contact action and post-action observation loop without Cookie or private API access.
- [x] Add greeting fill/send only after sequencing permits and verify an outbound bubble against the current draft hash.
- [x] Persist attempted/verified evidence at every boundary and prevent verified-component replay.
- [x] Update safety tests, cross-layer specs, README, ADR status, and tracked default `dist`.
- [x] Run focused tests, `npm run verify`, database tests/lint, Edge integration, Chrome smoke, audit, secret scan, and diff checks.
- [x] Build local Supabase `dist`, reload Chrome, preflight the one user-authorized opportunity, inspect the bounded state, then perform the approved single live confirmation.
- [x] Verify application and greeting independently in both Liepin UI and Supabase; report partial rather than complete if either evidence is absent.

## Rollback points

- Before confirmation: release an unused reservation and close only the extension-owned tab.
- After the first native action: never replay automatically; persist attempted state and require evidence-aware recovery.
- After one verified component: retry only the missing component.
