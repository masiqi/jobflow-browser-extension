# Liepin outreach MVP implementation plan

## Preconditions

- Do not start until the user approves the final planning summary.
- After approval, run task.py start and load trellis-before-dev before editing product code.
- Preserve unrelated uncommitted Trellis, editor, and CodeGraph files.
- Re-run npm ci from the lockfile and npm run verify before the first code edit.
- Confirm Docker or a compatible runtime is available before claiming local Supabase integration tests.
- Keep every build executable in draft_only mode throughout this task.

## Delivery strategy

Implement as vertical, reviewable increments. Each increment ends with focused tests, npm run typecheck, npm run build, git diff --check, and a source/dist review. Do not defer safety checks until the final increment.

Suggested conventional commits are listed as planning boundaries. Actual commits happen only after the corresponding checks pass.

## 1. Freeze safety and domain contracts

- [x] Expand safety tests first to reject live/sent executable states, host-page clicks, form fill/submit, file upload to Liepin, private write endpoints, automatic scroll/pagination, cookies, broad hosts, and secret literals.
- [x] Add synthetic tests proving current personal employers, roles, target directions, and prohibitions are absent.
- [x] Replace the legacy types with first-milestone platform, opportunity, event, evaluation, review, draft, batch, resume-profile, model-route, and error unions.
- [x] Create one runtime-message decoder and one exhaustive command dispatcher.
- [x] Create one opportunity-event decoder and reducer for current projection.
- [x] Remove hard-coded personal resume assumptions, free-form filter types, live unlock fields, and sent counters.
- [x] Keep legacy storage readable only for detection and deletion; never migrate it to cloud.

Validation:

- npm run typecheck
- npm test -- --run tests/safety.test.ts
- npm test

Suggested commit: refactor: establish draft-only domain contracts

Rollback point: the existing dry-run build remains loadable with legacy UI until the new surfaces are wired.

## 2. Add Supabase project and tenant schema

- [x] Add Supabase local configuration, migrations, seed fixtures, and test directories.
- [x] Create public profiles, resume_profiles, resume_facts, filter_configs, job_opportunities, opportunity_events, evaluations, message_drafts, draft_revisions, batch_runs, and batch_items tables.
- [x] Create private user_entitlements, managed_usage, and endpoint_policy tables.
- [x] Add the user/platform/platform_job_id unique constraint.
- [x] Enable RLS before granting client access.
- [x] Add owner policies, child ownership policies, protected column privileges, and append-only event restrictions.
- [x] Add the auth-user profile trigger with email verification defaulting to unverified.
- [x] Implement security-definer command functions with fixed search_path for atomic profile activation and opportunity transitions.
- [x] Add pgTAP owner, cross-user, privilege, append-only, uniqueness, and private-table tests.

Validation:

- supabase start
- supabase db reset
- supabase test db
- npm run typecheck

Suggested commit: feat: add tenant-isolated Supabase schema

Rollback point: reset the local Supabase project and replay migrations from empty; no remote migration runs in this increment.

## 3. Add extension Auth and backend boundary

- [x] Add the Supabase JS client dependency and boundary schema validator.
- [x] Implement one background-owned Supabase client with serialized initialization.
- [x] Implement the chrome.storage.local Supabase session adapter and disable URL session detection.
- [x] Add registration, login, sign-out, session recovery, and AuthProjection commands.
- [x] Ensure content messages never contain access or refresh tokens.
- [x] Add server-owned entitlement and email-verification projections.
- [x] Add synthetic build-time public Supabase config and exact-origin manifest generation for development and production builds.
- [ ] Add tests for worker restart, expired session, concurrent view initialization, sign-out, wrong user, and missing backend.

Validation:

- npm run typecheck
- npm test
- supabase test db
- inspect dist manifest and bundles for exact host permissions and absent privileged keys

Suggested commit: feat: connect extension accounts to Supabase

Rollback point: Auth failure leaves the extension signed out and read-only; it does not restore legacy local authoritative behavior.

## 4. Implement local resume sources and approved profiles

- [x] Add extension-private IndexedDB storage keyed by user and source hash.
- [x] Add PDF, DOCX, TXT, Markdown, and pasted-text inspection, extraction, normalization, hashing, and 10 MiB limits.
- [x] Reject spoofed, malformed, image-only, legacy DOC, and insufficient-text sources.
- [x] Add local availability states and source replace/delete commands.
- [x] Add the extract-resume model operation using normalized text only.
- [x] Validate the returned draft profile and evidence-backed facts.
- [x] Implement profile editing, activation, stale transition, and identical-hash reuse.
- [x] Add hostile/synthetic parser fixtures and prove no binary or full normalized source is persisted to Supabase.

Validation:

- npm run typecheck
- npm test -- --run resume
- supabase test db
- inspect IndexedDB and Supabase local tables with synthetic sources

Suggested commit: feat: add reviewed cloud resume profiles

Rollback point: parser or model failure preserves the local source and creates no active profile.

## 5. Implement managed and BYOK model routes

- [x] Add the authenticated model-gateway Edge Function with test_provider, extract_resume_profile, evaluate_opportunity, and generate_greeting operations.
- [x] Require JWT validation and user-scoped RLS for user records.
- [x] Implement manually provisioned VIP entitlement, managed quota reservation, settlement, and visible exhaustion.
- [x] Implement client-only BYOK session storage, optional remembered-device storage, removal, and disclosure.
- [x] Implement OpenAI, DeepSeek, and OpenRouter presets.
- [x] Implement custom OpenAI-compatible HTTPS normalization and endpoint checks.
- [x] Disable automatic redirect following; validate each target and public DNS result.
- [ ] Apply input, output, redirect, timeout, and concurrency limits.
- [x] Redact credentials, authorization data, resume/JD text, prompts, and raw output from all diagnostics.
- [ ] Add synthetic provider tests, schema incompatibility tests, SSRF address cases, redirects, DNS changes, timeout, oversized response, invalid credentials, and no-fallback behavior.
- [ ] Keep custom endpoints disabled in production configuration if the deployment cannot contain DNS-rebinding risk acceptably.

Validation:

- deno test supabase/functions/tests
- supabase functions serve model-gateway
- run authenticated synthetic integration requests
- npm test
- scan local function logs for secrets and payload text

Suggested commit: feat: add managed and byok model gateway

Rollback point: disable the custom-provider capability independently while presets and managed routing remain available.

## 6. Implement the closed JD rule catalog

- [x] Replace legacy city/salary/direction/free-keyword filters with the accepted five-family structured config.
- [x] Implement versioned rule definitions and evidence spans.
- [x] Add school-pedigree mandatory, preferred, negated, and ambiguous semantics.
- [x] Add travel/mobility tolerance semantics.
- [x] Add outsourcing, dispatch, and long-term client-site semantics.
- [x] Add work-schedule selections.
- [x] Add product-owned primary technology vocabulary and core-versus-incidental semantics.
- [x] Start all rules disabled.
- [x] Add clear match, non-match, negation, optional/preference, and ambiguous synthetic fixtures for every rule.
- [x] Persist rule decisions and config version separately from LLM evaluation.

Validation:

- npm run typecheck
- npm test -- --run filters
- review every exclusion fixture for exact evidence

Suggested commit: feat: add explainable JD rule catalog

Rollback point: an unknown or ambiguous pattern returns review, never exclude.

## 7. Rebuild Liepin discovery and recoverable batch processing

- [x] Centralize supported route and selector definitions in the Liepin adapter.
- [ ] Add sanitized list and detail variants plus login-wall, captcha, risk, missing-field, and malformed-link fixtures.
- [x] Scan only current DOM and prove there is no host interaction.
- [x] Upsert observations through the exact identity constraint and return state counts.
- [x] Implement preview selection, default 10, range 1 through 20, route/call disclosure, and explicit start.
- [x] Implement serial detail tabs with a persisted lease.
- [x] Replace in-memory-only wakeups and timeout behavior with chrome.alarms and restart recovery.
- [x] Persist deterministic, LLM proceed/review/exclude, failure, and generation transitions.
- [x] Prevent repeat work for known excluded, review, or draft-ready identities.
- [ ] Add pause, resume, cancel, missing-tab, late-message, timeout, worker-restart, and concurrent-scan tests.

Validation:

- npm run typecheck
- npm test -- --run liepin
- npm test -- --run batch
- inspect build for one-tab serial behavior and no live action patterns

Suggested commit: feat: make Liepin draft batches recoverable

Rollback point: any uncertain recovery records a typed failure or review and never marks simulated success without evidence.

## 8. Implement conservative evaluation and versioned greetings

- [x] Add the conservative suitability schema and prompt.
- [x] Enforce proceed, review, and exclude evidence requirements without score thresholds.
- [x] Persist model exclusion permanently by platform job identity for automatic processing.
- [x] Implement the unified nonblocking review queue.
- [x] Implement continue generation, permanent user exclusion, and continue as exception.
- [x] Implement generation-only processing without rerunning suitability.
- [x] Add one-current-draft projection, 80 to 140 target, 200 maximum, plain-text and grounding validation.
- [x] Persist immutable generated/user revisions and separate current edited text.
- [ ] Implement edit, regenerate, and restore-as-new-edit commands.
- [ ] Add prompt-injection, unsupported-claim, contact data, commitment, Markdown, length, invalid fact ID, and missing evidence tests.

Validation:

- npm run typecheck
- npm test -- --run prompt
- npm test -- --run domain
- supabase test db

Suggested commit: feat: add auditable evaluation and draft history

Rollback point: invalid or ungrounded model results create reviewable failures and no exclusion/draft success.

## 9. Build launcher, side panel, and management page

- [x] Add the exact sidePanel and alarms manifest permissions and no others.
- [ ] Replace the large injected panel with the small hideable launcher and minimal card markers.
- [x] Add the side-panel entry, stable layout, scan summary, batch controls, progress, recent results, and view-all links.
- [x] Add the full management page for account, resume/profile, rules, model routes, review queue, record center, and outbox.
- [x] Add status tabs, title/company search, record detail, evidence, model metadata, and event history.
- [x] Add status-specific named actions without a raw status editor.
- [x] Use an established icon library, tooltips, accessible names, keyboard focus, and responsive narrow-width behavior.
- [x] Avoid nested cards, floating page sections, marketing layout, monochrome palette, and text overlap.
- [ ] Add component, projection, long-text, empty, loading, quota, offline, and error-state tests.

Validation:

- npm run typecheck
- npm test
- npm run build
- run local extension screenshots at supported side-panel and management-page viewport sizes
- inspect text wrapping, stable dimensions, and absence of host-page overlap

Suggested commit: feat: add side panel and job record center

Rollback point: launcher can be disabled while toolbar and management-page access remain usable.

## 10. Integration hardening and documentation

- [x] Add npm scripts that compose typecheck, build, unit tests, Edge tests where available, and Supabase tests.
- [ ] Expand secrets scanning across tracked source, migrations, tests, docs, and dist.
- [x] Ensure every fixture is synthetic or irreversibly sanitized.
- [x] Run database migrations from empty twice where idempotency is expected.
- [x] Verify source and tracked dist are synchronized.
- [x] Rewrite README for account setup, local Supabase, model routes, privacy, side panel, record center, troubleshooting, and draft-only boundaries.
- [x] Document production build configuration without committing project secrets.
- [ ] Perform the PRD manual Chrome acceptance with one to three read-only Liepin jobs when a test account/environment is available.
- [ ] Record any browser step not actually performed as outstanding rather than claiming it passed.

Final automated validation:

- npm ci
- npm run verify
- deno test supabase/functions/tests
- supabase db reset
- supabase test db
- npm audit
- git diff --check
- git status --short
- git diff -- . :!package-lock.json
- tracked-file secret and personal-data scan

Suggested commit: test: harden the Supabase draft-only workflow

## Final review gate

- [x] Every PRD acceptance criterion maps to an automated or explicit manual check.
- [x] Current source contains no live platform-write implementation.
- [x] No test result is presented as real Chrome or Liepin behavior.
- [x] No remote Supabase migration, deployment, repository creation, push, or Chrome Web Store action occurs without separate user authorization.
- [x] Remaining live, conversation, payment, email-verification, OCR, extra-platform, and automation work is documented as deferred.
