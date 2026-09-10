# Liepin outreach MVP technical design

## 1. Scope and invariants

This design implements the accepted first milestone only: authenticated multi-user draft generation with no Liepin write operation.

Hard invariants:

- The only execution policy compiled into the first milestone is draft_only.
- Content scripts never receive Supabase refresh tokens, BYOK credentials, managed provider keys, or source resume text.
- Source resumes persist only in extension-private client storage.
- Supabase stores structured resume profiles, job data, decisions, drafts, and audit history under mandatory tenant isolation.
- Every external payload is decoded from unknown at its boundary.
- Every opportunity is unique only by user, platform, and platform job ID.
- Every state change is a named transition with append-only history.
- No UI setting can unlock application, message, upload, form-fill, private-write-API, pagination, or scrolling behavior.

Future live requirements remain represented in documentation, not executable branches.

## 2. Runtime boundaries

### 2.1 Content script

Responsibilities:

- recognize supported Liepin list and detail routes;
- render the small page-edge launcher and optional status markers;
- extract list cards and detail-page fields from public DOM;
- send validated, minimal messages to the background;
- never call Supabase or a model provider;
- never click, fill, submit, upload, scroll, or paginate.

The content script treats the host page as untrusted. Extracted strings have size limits and normalization before crossing the runtime-message boundary.

### 2.2 Background service worker

The background owns:

- the only Supabase JS client and Auth session;
- an asynchronous chrome.storage.local adapter for Supabase session persistence;
- BYOK credential access from chrome.storage.session or explicit local persistence;
- the batch queue and single detail-tab lease;
- validated runtime command dispatch;
- local deterministic rule evaluation;
- communication with authenticated Edge Functions;
- IndexedDB access for local resume source metadata and blobs;
- side-panel opening in response to a user gesture;
- recovery after worker suspension, extension reload, and browser restart.

Queue wakeups and detail timeouts use chrome.alarms plus persisted run state rather than relying only on in-memory timers.

### 2.3 Side panel

The side panel is a narrow, task-focused projection:

- current account and active model route;
- scan current result snapshot;
- preflight counts and batch selection;
- start, pause, resume, and cancel;
- current item, progress, and result counts;
- recent review, exclusion, failure, and draft results;
- links into management-page records.

It invokes background commands and renders background projections. It does not initialize another Supabase client.

### 2.4 Management page

The full-page extension surface owns dense workflows:

- open registration, login, and sign-out;
- local resume import, replacement, deletion, and availability;
- draft-profile review and activation;
- five-family JD rule configuration;
- managed and BYOK model route configuration and connection testing;
- unified manual review queue;
- job-record center and append-only history;
- outbox, current message editing, and draft revisions;
- local and cloud data deletion.

The first milestone contains no operational send control. Future actions may be shown only as clearly unavailable roadmap states if needed for layout testing.

### 2.5 Supabase

Supabase provides Auth, Postgres, RLS, and authenticated Edge Functions. Supabase Storage is not used for source resumes in this milestone.

The extension is a public client. Publishable project configuration is not a secret; RLS and authenticated commands are the authorization boundary. Service-role and managed model credentials are Edge Function secrets only.

## 3. Source layout

Preserve the existing single repository and TypeScript build while separating boundaries:

| Area | Proposed path | Ownership |
| --- | --- | --- |
| Domain contracts | src/domain | statuses, events, commands, decoders, reducers |
| Liepin adapter | src/platforms/liepin | selectors, URL identity, list/detail extraction |
| Background | src/extension/background | auth owner, queue, storage, command dispatcher |
| Content | src/extension/content | launcher, status marker, DOM bridge |
| Side panel | src/extension/sidepanel | narrow workflow UI |
| Management | src/extension/dashboard | full-page workflow UI |
| Shared UI | src/ui | DOM components, formatting, accessible controls |
| Local persistence | src/local | IndexedDB, Chrome storage adapters |
| Supabase client | src/backend | public client, DTO decoders, function calls |
| Model contracts | src/model | schemas, prompt versions, output validation |
| Database | supabase/migrations | tables, indexes, policies, command functions |
| Edge Functions | supabase/functions | model gateway and shared server modules |
| Database tests | supabase/tests | pgTAP RLS and command tests |

Keep DOM-native TypeScript for the first milestone rather than introducing a UI framework. Shared components receive typed view models and emit named commands. If UI complexity later justifies a framework, migrate after behavior is covered.

## 4. Domain model

### 4.1 Resume

ResumeProfileState:

- draft
- active
- stale

ResumeProfile stores source hash, source display metadata, version, summary, target directions, skills, user-approved constraints, timestamps, and state. ResumeFact stores one claim, keywords, source evidence, order, and approval state.

At most one active profile exists per user. Activating a revision and marking an older active revision stale is one database transaction.

LocalResumeState is a client projection:

- available
- missing
- version_mismatch

The local IndexedDB key includes user ID and source hash. Stored content includes the authoritative Blob or normalized pasted text plus file metadata. Cloud records never contain the Blob or full normalized source text.

### 4.2 Opportunity identity

JobOpportunity has a database unique constraint on:

- user_id
- platform
- platform_job_id

No title, company, recruiter, location, URL, hash, or similarity participates in identity. Different IDs remain different records. Rediscovery updates latest observed metadata and last_seen_at without creating another default draft.

The first milestone platform enum contains liepin only. Additional platforms require explicit adapter and permission work.

### 4.3 Opportunity statuses

Current milestone projection statuses:

- discovered
- queued
- extracting
- deterministic_excluded
- evaluating
- model_excluded
- review_required
- generating
- draft_ready
- user_excluded
- failed

Do not include live, sent, applied, or contacted in executable TypeScript unions. Future migrations add those states when their evidence contract is approved.

### 4.4 Opportunity events

Append-only event kinds:

- opportunity_observed
- details_captured
- deterministic_excluded
- evaluation_started
- evaluation_completed
- review_requested
- user_excluded
- user_override
- generation_started
- generation_completed
- draft_edited
- processing_failed

Each event includes ID, user ID, opportunity ID, kind, schema version, actor kind, actor ID where applicable, payload, and created time.

A single domain reducer maps ordered typed events to the current projection. Edge command functions append the event and update the query projection atomically. Client roles cannot directly update current status columns or existing events.

### 4.5 Manual review and override

Review source is deterministic_ambiguity or model_review.

Review transitions:

- continue_generation
- permanently_exclude

Continue from deterministic ambiguity enters suitability evaluation. Continue from model review enters generation-only processing.

Excluded records expose continue_as_exception in the record center. It appends user_override and enters generation-only processing without changing or rerunning the original decision.

### 4.6 Batch

BatchStatus:

- queued
- running
- paused
- completed
- cancelled
- failed

BatchRun stores source URL, observed counts, selected count, profile version, rule configuration version, model route metadata, current item, and timestamps. BatchItem stores an opportunity ID, immutable order, processing status, attempts, detail-tab lease metadata, and errors.

The queue is serial. Only the item owning the persisted detail-tab lease may accept a detail result. Late or mismatched messages are ignored and diagnosed without sensitive content.

## 5. Database design

### 5.1 Public user-owned tables

| Table | Purpose | Key authorization rule |
| --- | --- | --- |
| profiles | display profile and server-controlled email verification projection | user selects own row; protected columns are not client-updatable |
| resume_profiles | versioned structured profiles | owner select and draft edit through commands |
| resume_facts | evidence-backed facts | owner access through profile ownership |
| filter_configs | versioned five-family settings | owner access |
| job_opportunities | identity and current query projection | owner select; transitions through commands |
| opportunity_events | append-only audit history | owner select; server command insert only |
| evaluations | validated suitability records | owner select; model gateway insert only |
| message_drafts | one current draft projection per opportunity | owner select; edit through commands |
| draft_revisions | immutable model and user revisions | owner select; server command insert only |
| batch_runs | persisted batch projection | owner select; transition commands |
| batch_items | ordered run items and leases | owner select; transition commands |

### 5.2 Private server tables

| Table | Purpose |
| --- | --- |
| user_entitlements | VIP managed-model entitlement and policy |
| managed_usage | atomic quota reservations and settled provider units |
| endpoint_policy | preset origins and any server-controlled custom-provider restrictions |

Private tables are not exposed through the public API to client roles. Edge Functions query them only after validating the user.

### 5.3 RLS and privileges

Every public table enables RLS before grants. Policies use auth.uid equals user_id, with indexed user_id columns. Child-table policies verify parent ownership.

Column privileges prevent users from changing email verification, entitlement, current status, evidence, generated revisions, and audit fields. Security-definer database functions use fixed search_path, validate auth.uid, and expose only named transitions.

Tests create at least two users and prove:

- owner read and allowed writes succeed;
- cross-user reads and writes fail;
- protected columns cannot be changed;
- event updates and deletes fail;
- duplicate opportunity identity fails under concurrent or repeated insertion;
- server-only entitlement and usage tables are inaccessible.

## 6. Auth and entitlement

Registration uses email and password with Supabase email confirmation disabled. A database trigger creates profiles.email_verification_status as unverified. Registration is open.

The background Supabase client uses a custom asynchronous Chrome storage adapter, persistSession true, autoRefreshToken true, and URL session detection disabled. Background initialization is serialized so simultaneous views do not create competing refresh calls.

Runtime UI messages receive an AuthProjection containing user ID, email display value, email verification state, VIP entitlement boolean, and active route. They never receive refresh tokens.

VIP is manually provisioned in the private entitlement table for the first milestone. Payment, subscription lifecycle, verification, and password recovery are not implemented.

Sign-out clears the Supabase session and session-only BYOK key. Remembered BYOK and local resumes stay bound to their user ID and are invisible to a different signed-in user. Account-data deletion removes cloud user-owned records and that user's local source and BYOK data after explicit confirmation.

## 7. Model gateway

### 7.1 Operations

Use one authenticated model gateway with a discriminated operation:

- test_provider
- extract_resume_profile
- evaluate_opportunity
- generate_greeting

Each operation has a versioned request decoder, response schema, input limits, timeout, and provider response-size limit.

### 7.2 Managed route

The gateway reads entitlement and atomically reserves quota before calling the server-configured provider. It settles actual billing units after a response and releases reservations when no provider call begins.

Managed provider endpoint, model, and API key come from Edge Function secrets. No provider failure triggers fallback.

### 7.3 BYOK route

The client sends the currently selected credential only with the authenticated request. The gateway holds it in request scope, excludes it from errors and logs, and discards it after the call. No database statement receives the value.

BYOK config supports OpenAI, DeepSeek, OpenRouter, and a custom OpenAI-compatible provider. Provider metadata excludes the key and may be stored as user configuration; the key remains in Chrome session or explicit device-local storage.

### 7.4 Endpoint security

Preset origins are allowlisted.

For custom endpoints:

- normalize to one Chat Completions endpoint;
- accept HTTPS only;
- reject IP literals and URL credentials;
- resolve A and AAAA records and reject every non-public result;
- use redirect manual and validate each hop;
- cap redirects, body bytes, response bytes, duration, and concurrent calls;
- never forward arbitrary user headers;
- repeat the connection and structured-output test after endpoint, model, or key changes.

Deno DNS preflight does not pin fetch resolution, leaving residual DNS-rebinding risk. Custom providers remain disabled in a production build if deployment tests cannot demonstrate acceptable containment. This does not block preset BYOK providers.

### 7.5 Prompt injection and output validation

Prompts delimit resume and JD as untrusted data and explicitly prohibit following embedded instructions. Only active approved profile facts may be supplied.

Model output is parsed from unknown with exact schemas. Suitability exclude requires grounded conflict evidence under ADR 0019. Greeting output enforces plain text, length, evidence IDs, no unsupported claims, and content restrictions.

Do not log prompts, input bodies, raw model output, credentials, or Authorization values. Diagnostics use request ID, operation, route, provider/model, timing, token units, schema outcome, and redacted error category.

## 8. Resume import

Client pipeline:

1. Inspect size and actual file signature.
2. Extract text from PDF, DOCX, TXT, or Markdown, or normalize pasted text.
3. Reject malformed, image-only, legacy DOC, oversized, or insufficient sources.
4. Normalize line endings, Unicode whitespace, and repeated empty lines.
5. Compute SHA-256 over normalized text.
6. Persist the authoritative local source under user ID and hash.
7. If the hash already has a cloud profile, open it without a model call.
8. Otherwise invoke extract_resume_profile through the selected route.
9. Validate and save a draft profile and evidence-backed facts.
10. Let the user edit facts and explicitly activate the revision.

Replacing the local source marks the active profile stale through an authenticated command. A run requires an active profile; future external submission additionally requires local source availability and matching hash.

Use PDF.js for text-layer PDFs and a browser-compatible DOCX text extractor. Never evaluate macros, embedded objects, external links, HTML, comments, or tracked-change scripts.

## 9. Liepin discovery and filtering

### 9.1 Scan

The content adapter reads only cards currently in DOM. It returns platform job ID, canonical public URL, title, company, location, salary, experience, education, card text, and stable DOM order.

The background decodes, normalizes, caps, and upserts observations. Supabase returns existing state so the side panel can report new, duplicate, excluded, review, failed, and drafted counts before a batch begins.

### 9.2 Detail extraction

The background creates one inactive tab for the next selected opportunity and persists its lease. Detail content extracts normalized public fields and reports ready or a typed failure. An alarm enforces timeout. Success or terminal failure closes only the leased extension-owned tab.

Worker restart recovery reloads the batch and lease, checks whether the tab exists, and either resumes waiting or records a recoverable failure. It never manufactures success evidence.

### 9.3 Deterministic rules

The first catalog is versioned and closed:

- mandatory elite-school pedigree;
- travel and mobility;
- outsourcing, dispatch, and long-term client-site engagement;
- night/rotating shifts, big/small weeks, single rest days, and long-term on-call;
- selected disallowed primary technologies.

Each rule returns pass, exclude, or review with evidence spans. Rules start disabled. No arbitrary prose, keyword, or regular-expression input exists.

Pattern tests include clear match, clear non-match, negation, optional/preference wording, and ambiguity. A model cannot override a deterministic exclusion; the user may later use continue as exception from the record center.

## 10. User interfaces

Use a quiet, work-focused visual system with compact typography, stable row dimensions, restrained neutral backgrounds, status colors with text labels, and icons from an established icon package. Avoid cards inside cards and marketing composition.

### 10.1 Launcher

One fixed-size icon button sits at the supported page edge, has a tooltip and accessible name, avoids host controls, and can be hidden. Shadow DOM isolates its minimal styles. It opens the side panel from the click gesture.

### 10.2 Side panel

Layout:

- compact header with account and route status;
- scan summary band;
- batch selection and controls;
- stable progress summary;
- current/recent result rows;
- view-all links by status.

Controls use icons for scan, pause, resume, cancel, and open, with tooltips. Text must wrap without changing fixed control dimensions.

### 10.3 Record center and outbox

The management page uses a table/list workspace with status tabs and search by title or company. It is not a grid of decorative cards.

Record detail shows current projection first and append-only history second. Available domain actions depend on status:

- review: continue generation or permanently exclude;
- excluded: continue as exception;
- draft: edit, save, regenerate, or restore a prior revision as a new edit;
- failed: retry only the failed current-milestone step;
- future delivery: not executable in this milestone.

Editing autosaves only after explicit debounce and displays saved/error state. Generated and edited revisions remain distinguishable.

## 11. Build and configuration

Extend the esbuild entry map for background, Liepin content, side panel, and dashboard. Generate and copy their HTML/CSS assets. Continue generating dist from source; never edit dist directly.

Manifest permissions:

- storage
- tabs
- alarms
- sidePanel

Host permissions:

- the exact supported Liepin HTTPS origin pattern already approved;
- one exact Supabase project origin injected by build configuration;
- optional localhost Supabase origin only in an explicit development build.

Do not add cookies, broad HTTP/HTTPS hosts, or model-provider host permissions. Provider traffic leaves from the Edge Function.

Build configuration consumes a public Supabase URL and publishable key. Repository defaults are synthetic development placeholders. Production service-role and model secrets never enter the build.

## 12. Existing-data and code migration

This is a prototype-to-product replacement, not a trusted data migration.

- Remove personal hard-coded resume defaults and tests.
- Replace free-form filter settings with the accepted catalog; do not silently reinterpret old custom keywords.
- Do not upload existing chrome.storage local profiles or simulated ledger data to Supabase.
- Detect legacy local keys and show a local-only legacy-data notice with delete capability.
- Never reinterpret simulated as contacted, applied, or sent.
- Remove unused live, sent, and unlock types from executable code.
- Rebuild tracked dist after every source or build-script change.

## 13. Testing strategy

### Fast tests

- domain event reducer and transition table;
- schema decoders for runtime, Supabase, and model boundaries;
- all deterministic rule fixtures;
- URL and endpoint validation;
- greeting and profile output validation;
- PDF, DOCX, TXT, Markdown, and pasted-text normalization;
- local IndexedDB and Chrome storage adapters;
- queue pause, resume, cancel, lease, timeout, and restart recovery;
- side-panel and record-center projections.

### Supabase tests

- migrations from empty local project;
- profile trigger and unverified state;
- RLS owner and cross-user behavior;
- protected-column privileges;
- append-only events;
- unique opportunity identity;
- atomic profile activation and status transitions;
- entitlement and managed-quota authorization;
- Edge Function missing, invalid, expired, and valid JWT behavior;
- BYOK redaction and managed quota enforcement.

### DOM and build tests

- sanitized Liepin list and detail variants;
- login wall, captcha/risk page, missing fields, malformed URLs, and late detail response;
- no host-page interaction during scan;
- exact manifest permissions and origins;
- no cookie access, known write selectors, form submission, uploads, private write endpoints, live states, or secret literals in source and dist;
- source and tracked dist consistency.

### Manual Chrome acceptance

Follow the PRD Manual Acceptance section. Passing automated tests is not reported as real Liepin behavior verification.

## 14. Rollout and rollback

Deliver in vertical milestones behind compile-time-safe draft-only behavior:

1. domain contracts and removal of unsafe legacy assumptions;
2. local Supabase schema, Auth, RLS, and session projection;
3. resume import and approved profile;
4. model routes and validated outputs;
5. Liepin scan, rules, queue, and recovery;
6. launcher, side panel, record center, and outbox;
7. integration hardening, dist, and docs.

Each milestone keeps npm verification green. Database migrations are forward-only and additive within a milestone. Before a public remote deployment, rehearse local reset and migration replay.

If Supabase integration is unavailable, the extension fails closed with a visible service error; it does not fall back to unsynchronized local authoritative data. If model processing is unavailable, it preserves the opportunity and exposes retry/review without generating unvalidated content.

## 15. Residual risks

- Liepin DOM and route changes require sanitized fixtures and manual read-only checks.
- Supabase Free projects may pause and do not provide a production availability guarantee.
- Open registration without email verification permits email squatting and has no self-service recovery.
- Device-local resumes and BYOK keys can be lost or exposed with the Chrome profile.
- Arbitrary custom HTTPS endpoints retain DNS-rebinding residual risk.
- LLM exclusions remain active by platform job ID even after inputs change unless the user continues as an exception.
- Future live actions require a separate security, compliance, selector, evidence, and rate-limit design and are not implied by this architecture.
