# Define Liepin outreach MVP

## Goal

Help a job seeker efficiently discover suitable Liepin jobs and prepare truthful, job-specific outreach while the first acceptance milestone performs no writes to Liepin. Preserve a path toward a later user-authorized action that both submits the resume and sends the greeting.

## Background

- The existing prototype can scan the currently rendered Liepin list DOM, open detail tabs, apply filters, call an OpenAI-compatible model, and write simulated results to local extension storage.
- The existing prototype cannot read recruiting conversations, classify recruiter replies, track exchanged contact details, submit a resume, or send a message.
- The existing resume-profile implementation contains personal, hard-coded career assumptions that are not valid generic product requirements.
- The repository safety boundary requires `START_RUN` to remain `dry_run` until a separately approved and manually accepted live milestone.

## Requirements

### Current acceptance milestone

- R1: The execution policy must be `draft_only`; no button, setting, runtime message, or persisted value may cause a Liepin write.
- R2: The extension must create a pending message from verified job details, deterministic filter results, and traceable resume facts.
- R3: Pending messages must be visible in an outbox and remain editable without being marked as contacted, applied, or sent.
- R4: The ledger must distinguish draft creation from externally verified platform actions.
- R5: Generated and edited message content must be stored as distinct values so user edits do not overwrite the generation record.
- R6: The first milestone must support product user accounts and a hosted backend rather than relying only on one Chrome profile.
- R7: Every hosted structured profile, preference, job opportunity, draft, and ledger record must belong to an authenticated user and be inaccessible to other users by default.
- R8: Authentication state must be usable from the Chrome extension without exposing server-only credentials in the extension bundle.
- R9: The backend must provide an explicit user-data deletion path and must not persist the source resume file or its full extracted text after profile generation completes.
- R10: The first milestone backend must use Supabase Auth, Postgres with mandatory Row Level Security, and Edge Functions for trusted operations and model calls; Supabase Storage is not used for source resumes.
- R11: The extension may contain only Supabase publishable client configuration and user session material; Supabase privileged credentials and model-provider credentials must remain in server-side secrets.
- R12: Cloudflare must not be placed in the first-milestone request path; it may be reconsidered later for a measured need such as edge routing, AI Gateway, static hosting, or bot protection.
- R13: The Chrome extension must retain the imported source resume as an extension-private local copy on the current device while Supabase stores only the structured profile, source hash, non-sensitive file metadata, and profile version.
- R14: The user must be able to inspect which local resume version is active, replace it, and delete it; local resume loss must be reported explicitly rather than silently falling back to another version.
- R15: Source resume content may transit an authenticated processing path and the configured model service only for an explicit resume-processing operation; it must not appear in application logs, analytics, error payloads, or model request logs controlled by this product.
- R16: The local source resume is the authoritative resume version, and the extension must display whether it is available and whether its content hash matches the source hash of the active cloud profile.
- R17: Resume import must create a reviewable draft profile; only a profile revision explicitly approved and activated by the owning user may be used for job evaluation or message generation.
- R18: The user must be able to edit or remove extracted profile facts before activation, and every fact available to a model must retain evidence traceable to the imported resume.
- R19: Importing or replacing the authoritative local resume must mark the previously active profile stale and require a new profile revision to be reviewed and activated.
- R20: Source code, prompts, defaults, migrations, fixtures, and built artifacts must not contain hard-coded personal employers, job titles, target roles, skills, career constraints, or other user-specific resume assumptions.
- R21: The job seeker must operate Liepin's native search and filter controls for coarse filtering; the extension must not reproduce, fill, click, or otherwise automate those controls.
- R22: On explicit user request, the extension must scan the currently rendered Liepin result set, record its source URL and observable filter context, and treat those results as job leads rather than as already-qualified opportunities.
- R23: Full job details must be evaluated with a closed catalog of product-defined JD rules exposed through structured controls; users must not enter arbitrary natural-language, keyword, or regular-expression rules.
- R24: Every JD-rule outcome must identify the rule version and show the matched JD evidence; a model cannot override a deterministic hard exclusion.
- R25: Missing, conflicting, or ambiguous JD evidence must result in manual review rather than silent exclusion.
- R26: The first rule catalog is limited to school-pedigree requirements, travel and mobility, engagement/onsite model, work schedule, and selected primary technologies.
- R27: JD rules are disabled until the user explicitly configures them; the product must not infer personal exclusions from a resume or enable value judgments by default.
- R28: A mandatory elite-school requirement is excluded when configured, while preference-only or ambiguous school language requires review.
- R29: Travel, mobility, engagement model, and work-schedule rules exclude only requirements clearly beyond the user's selected structured tolerance; negated, conditional, or unclear language requires review or pass according to the versioned rule semantics.
- R30: A selected technology excludes a job only when the JD presents it as a primary or mandatory requirement; incidental, optional, migration-source, or negated mentions do not exclude the job.
- R31: A first-milestone scan must read only job cards already loaded in the current page DOM and must not scroll, click pagination, navigate to another result page, or change native filters.
- R32: The user may navigate, paginate, or load more results manually and start another scan; all scans must share the cloud opportunity ledger and deduplication policy.
- R33: Before detail processing begins, the extension must show the number of observed cards, valid job leads, duplicates, and items selected for the batch.
- R34: Within one user's data domain, a job opportunity is uniquely identified only by `(platform, platform_job_id)`.
- R35: Re-observing the same identity may update latest observed metadata but must not create another opportunity or another default draft.
- R36: Different platform job IDs are always different opportunities, even when company, title, recruiter, location, or JD content is identical.
- R37: The product must not calculate similarity, infer reposts, show possible-duplicate warnings, or allow heuristic merging.
- R38: After deterministic JD rules pass, the LLM may decide proceed, review, or exclude; an LLM exclusion permanently prevents automatic draft processing for that user-owned platform job identity.
- R39: Every LLM evaluation must be schema-validated and persisted independently from deterministic filtering, with its outcome, reasons, minimal JD evidence, JD content hash, resume-profile revision, rule-catalog and configuration version, prompt version, model identifier, and timestamp.
- R40: Re-observing an opportunity with a persisted LLM exclusion must not reopen its detail page or invoke the model again merely because it appeared in another scan or batch.
- R41: LLM exclusion must remain visible in the opportunity history and batch summaries rather than being represented as a transient skip or omitted item.
- R42: LLM exclusion validity depends only on the user-owned platform and platform job ID; JD content, resume profile, filter settings, rule catalog, prompt, and model changes do not invalidate it.
- R43: The first milestone must not expose automatic or manual reevaluation for an LLM-excluded opportunity; a different platform job ID is evaluated as a different opportunity, while an explicit user override follows the generation-only path.
- R44: The product must support two explicit model routes: a product-managed model entitlement for VIP users and a user-supplied model credential route available to users who choose BYOK.
- R45: A VIP user defaults to the managed route but may explicitly select BYOK; a non-entitled user must configure BYOK before invoking resume extraction, job evaluation, or message generation.
- R46: The active model route, provider, and model must be visible before sending resume or JD content and must be recorded with every model result.
- R47: The product must never silently fall back between managed and BYOK routes, providers, or models; quota, credential, compatibility, and provider failures must remain visible.
- R48: Managed model usage must enforce server-side per-user and per-period quotas without logging resume text, JD text, prompts, model credentials, or full model output.
- R49: BYOK credentials must remain on the current client and must never be stored, encrypted, backed up, or synchronized through Supabase.
- R50: BYOK credentials default to the current browser session; the user may explicitly choose to remember them in the current Chrome profile after seeing a local-storage risk disclosure.
- R51: An authenticated Edge Function may receive a BYOK credential only for the lifetime of one model request and must not persist, log, echo, cache, analyze, or include it in diagnostics.
- R52: The extension must provide an explicit control to remove a remembered BYOK credential from the current device.
- R53: First-milestone BYOK supports only the OpenAI-compatible Chat Completions protocol with OpenAI, DeepSeek, and OpenRouter presets plus a custom compatible provider.
- R54: A custom provider accepts only a public HTTPS base URL, model identifier, and Bearer API key; arbitrary request headers, query credentials, and URL user information are not supported.
- R55: Custom endpoint validation must reject HTTP, localhost, IP literals, private, loopback, link-local, reserved, and cloud-metadata targets and must repeat validation after every redirect.
- R56: A provider configuration must pass a synthetic connection and schema-output test before it can process resume or JD content; endpoint, model, or credential changes invalidate that test.
- R57: The connection test must use only product-owned synthetic text and must show the user the normalized final endpoint, provider, and model.
- R58: First-milestone authentication must use Supabase email and password with registration-time email confirmation disabled.
- R59: The email value is an unverified login identifier and must not be treated as proof of mailbox ownership, a verified contact channel, or authority to receive VIP entitlement.
- R60: Phone login, email OTP or magic link, and third-party OAuth are outside the first milestone.
- R61: Authentication responses must not disclose whether an email is registered, and password attempts must be rate-limited independently of extension state.
- R62: First-milestone registration is open and requires no invitation or allowlist.
- R63: A server-controlled product profile field records email verification status, defaults to unverified, and cannot be changed by the extension or owning user.
- R64: Email verification, invitation management, and self-service password recovery are deferred and must not block the first-milestone job workflow.
- R65: Each opportunity that passes deterministic filtering and receives an LLM proceed decision has exactly one current pending-message draft rather than multiple simultaneous candidates.
- R66: A generated greeting is Chinese plain text targeting 80 to 140 Chinese characters with an absolute maximum of 200 characters.
- R67: A generated greeting must connect at least one specific JD requirement to one or two facts from the active approved resume profile, and the structured output must identify the JD evidence and fact IDs for validation.
- R68: Greetings must not fabricate or overstate experience, responsibility, metrics, skills, education, or commitments and must not introduce contact details, salary, start-date, or travel commitments that the user has not explicitly approved.
- R69: A low-friction relevant question may be included when natural but is not mandatory and the greeting is not required to end with a question mark.
- R70: The outbox must preserve immutable generated revisions and a separate current user-edited text; manual regeneration creates a new revision without overwriting earlier generated or edited content.
- R71: Every generated revision records its JD identity and evidence, profile revision and fact IDs, model route/provider/model, prompt version, and creation time.
- R72: If the model cannot ground a truthful greeting in approved resume facts, the opportunity requires manual review and no generic or fabricated draft is created.
- R73: Resume import supports text-layer PDF, DOCX, TXT, Markdown, and pasted plain text with a maximum source-file size of 10 MiB.
- R74: The client must validate actual file structure and content rather than trusting the filename extension or supplied MIME type.
- R75: The extension extracts and normalizes resume text locally, computes the authoritative content hash, and sends only normalized text and required metadata through the selected model route.
- R76: The model performs semantic extraction into the versioned draft-profile schema; raw PDF or DOCX bytes are not sent to model providers.
- R77: Scanned or image-only PDFs, legacy DOC, images, damaged files, and sources with insufficient extracted text must fail with an actionable request to use a supported text source or paste text.
- R78: Reimporting identical content must reuse its existing draft or active profile without another model call.
- R79: Pasted text is normalized and retained locally as the authoritative text source under the same hashing, review, replacement, and deletion rules as uploaded files.
- R80: Supported Liepin pages must show a small, unobtrusive, hideable launcher at the page edge; activating it from a user gesture opens the extension's native Chrome side panel.
- R81: The side panel is the in-context Liepin workspace for account status, current-page scan, batch preview and control, processing progress, and current opportunity results.
- R82: Dense workflows for registration and login, resume import and profile review, JD-rule configuration, managed/BYOK settings, the complete outbox, draft history, and the ledger use a full-page extension management surface reachable from the side panel.
- R83: The content script must not inject a large floating application panel into Liepin; page injection is limited to the launcher and minimal job-card status markers.
- R84: The browser toolbar action is a shortcut into the side panel or management page and does not duplicate complex forms.
- R85: Side-panel and management views must share domain components and backend contracts so the same record cannot show conflicting status across surfaces.
- R86: Scanning must not start detail extraction or consume model quota; the side panel first previews new, duplicate, excluded, and already-drafted counts and preselects only new processable opportunities.
- R87: The first milestone defaults to 10 selected opportunities per batch and permits a user-selected limit from 1 through 20; excess new opportunities remain available for a later batch.
- R88: Detail processing is serial, opens at most one background detail tab at a time, and supports pause, resume, and cancel without deleting completed results.
- R89: The user must explicitly activate Start generation after seeing the selected count, active model route, and maximum possible model calls.
- R90: Ambiguous deterministic-rule results and LLM review decisions enter one persistent manual-review queue with a clearly identified source, reasons, minimal JD evidence, and job-detail link.
- R91: Adding an item to manual review must not pause the batch; processing continues with the next selected opportunity.
- R92: A review item offers exactly two domain decisions: continue generation or permanently exclude the user-owned platform job identity.
- R93: Continuing a deterministic-rule review sends the job to LLM evaluation; continuing an LLM review invokes a generation-only model step without requesting another suitability decision.
- R94: A permanent user exclusion prevents future automatic detail extraction, evaluation, and draft generation for the same platform job ID.
- R95: A clear deterministic hard exclusion or persisted LLM exclusion is not placed in the ordinary review queue but remains eligible for an explicit user override from the record center.
- R96: Pending review items do not trigger model calls on later scans, and the user's decision and decision time remain in the opportunity history.
- R97: LLM suitability uses proceed, review, and exclude without a numeric score threshold deciding the outcome.
- R98: Proceed requires a credible connection between at least one core JD responsibility or requirement and approved resume facts with no explicit core conflict.
- R99: Review is required for insufficient profile evidence, ambiguous requirements, optional or preferred gaps, or uncertain seniority, years, management scope, or technical depth.
- R100: Exclude is allowed only for a clear conflict with an approved target direction or explicit profile constraint, or when multiple core responsibilities have no related approved facts and no truthful targeted greeting can be grounded.
- R101: Title mismatch, one absent skill, an optional or preferred qualification, or a numeric model score cannot independently justify exclusion; exclusion must cite core JD evidence and the conflicting or absent approved profile evidence.
- R102: The full-page management surface must provide a job-record center covering pending review, pending message, deterministic exclusion, model exclusion, user exclusion, and processing failure.
- R103: The record center must support status filtering and record detail with job/company metadata, current status, source URL, reasons, JD evidence, profile facts, model metadata, draft revisions, and an append-only transition history.
- R104: The side panel shows current-batch and recent records and links to the complete record center; it must not hide excluded, review, or failed counts.
- R105: Manual changes must execute named domain transitions and append audit history rather than directly editing a status field.
- R106: The record center must offer Continue as exception for deterministic, model, and user exclusions after showing the original decision, reasons, and evidence and receiving explicit confirmation.
- R107: Continuing as an exception appends a user-override event and enters generation-only processing without deleting, changing, or rerunning the original filter or suitability decision.
- R108: User-override generation still applies the approved-fact and greeting validation contract; failure to ground a truthful draft returns the opportunity to manual review.

### Confirmed future direction, outside the current milestone

- F1: The product will have explicit `draft_only`, `reviewed_send`, and `automatic_send` execution policies rather than one `autoSend` boolean.
- F2: A user-triggered send means one combined business intent: formally submit the resume and send the greeting for the same job opportunity.
- F3: Resume submission and greeting delivery must have distinct result states and evidence even though the interface presents one combined action.
- F4: Single-item and selected-batch sending will share the same reviewed-send semantics.
- F5: Prefer a native Liepin operation that atomically submits and contacts when both outcomes can be verified; otherwise submit and verify the application first, then send and verify the greeting.
- F6: Stop the combined operation after either component fails, preserve partial completion, and retry only the component that lacks success evidence.
- F7: Future formal submission must use the authoritative local resume when Liepin supports submitting it; otherwise the user must explicitly bind a specific Liepin-hosted resume to that local version, and missing or mismatched binding must block submission.
- F8: A future automatic execution policy may start discovery, filtering, generation, and submit-and-contact processing when the user opens a supported platform result page, including controlled pagination or scrolling.
- F9: Every future reviewed or automatic submit-and-contact workflow must enforce a user-configurable daily limit per recruitment platform; the initial Liepin default is 150 opportunities per day and users may set a lower or higher value.
- F10: A configured product limit is a safety policy and must not be described as an official platform allowance or bypass a lower limit observed from the platform.
- F11: Platform daily limits use Asia/Shanghai calendar days and reset at local midnight.
- F12: Drafting and dry-run activity do not consume the daily limit; once either component of a real submit-and-contact operation begins a platform write, that opportunity consumes one daily unit regardless of full success, failure, or partial completion.
- F13: Retrying only the missing component for the same platform job ID does not consume another daily unit, and changing the configured limit does not reset usage already recorded for that day.
- F14: The user-selectable maximum, any server-controlled emergency ceiling, and automatic-mode rate limits must be decided during the separately approved live safety milestone.
- F15: Future single and selected-batch submit-and-contact actions are available only from records with a valid current pending message and after the reviewed or automatic execution policy is separately approved.
- F16: The record center may add verified application, greeting, partial-completion, conversation, rejection, and contact-exchange states only in their corresponding future milestones.

## Out Of Scope For Current Milestone

- Writing to Liepin, including clicking application/chat controls, filling forms, sending messages, or calling private write APIs.
- Enabling `reviewed_send` or `automatic_send` through configuration.
- Reading or responding to recruiter conversations.
- Detecting explicit rejection or exchanged off-platform contact details.
- Supporting recruitment platforms other than Liepin.
- Production availability or a zero-cost guarantee after the free service quotas are exceeded.
- Persisting source resume files or their full extracted text in Supabase Database or Storage.
- Using an unreviewed or stale resume profile for filtering or message generation.
- JD fine-filter rule families beyond the five accepted first-milestone families.
- Automatic result-page pagination, scrolling, infinite-scroll loading, or multi-page continuous collection.
- Similarity-based, company/title-based, recruiter-based, or repost-aware opportunity deduplication.
- Native Anthropic, Gemini, Ollama, or other non-OpenAI-compatible BYOK protocols.
- BYOK endpoints using HTTP, local/private networking, arbitrary headers, or embedded URL credentials.
- Email OTP, magic-link, phone, and third-party OAuth authentication.
- Invitation codes, registration allowlists, email verification, and self-service password recovery.
- Multiple simultaneous model-generated greeting candidates for one opportunity.
- OCR, image resumes, legacy DOC parsing, and provider-specific binary file-upload APIs.
- A full application UI embedded directly inside the Liepin page DOM.

## Acceptance Criteria

- [ ] A job seeker can inspect a list of generated pending messages with their job, company, rationale, and cited resume facts.
- [ ] A job seeker can edit a pending message and later see both the generated version and current edited version.
- [ ] Creating or editing a pending message never creates a sent/contacted/applied ledger event.
- [ ] Existing dry-run safety tests continue to prove there are no known Liepin write actions, broad host permissions, or cookie permissions in the build.
- [ ] Synthetic tests cover pending-message creation, editing, persistence, and recovery without real resume or job-seeker data.
- [ ] Source, tracked `dist/`, documentation, and tests describe the same draft-only behavior.
- [ ] A user can create a session, sign in from the extension, sign out, and recover an authenticated session after the MV3 service worker is restarted.
- [ ] Automated authorization tests prove that one user cannot read or mutate another user's resume profile, preferences, drafts, or ledger records.
- [ ] Backend service credentials and model-provider credentials are absent from the extension source, bundle, storage, and logs.
- [ ] Every user-owned Supabase table has an automated positive owner-access test and negative cross-user-access test.
- [ ] Authenticated Edge Functions reject missing, invalid, and expired sessions before reading user data or invoking a model.
- [ ] Importing a resume leaves no source file or full resume text in Supabase Database or Storage after processing, while the structured profile remains available to the owning user.
- [ ] The extension can reopen the active local resume metadata after a browser restart and lets the user replace or delete the local copy.
- [ ] If the local resume copy is missing, the extension blocks any future operation requiring the file and asks for a new import without substituting a different resume.
- [ ] The extension reports `available`, `missing`, or `version_mismatch` for the authoritative local resume relative to the active cloud profile.
- [ ] Importing a resume creates a draft profile that cannot be consumed by a job run until the user explicitly activates it.
- [ ] A user can inspect evidence, edit or delete extracted facts, and activate the resulting profile revision.
- [ ] Replacing the source resume marks the previous active profile stale and blocks subsequent runs until a matching profile revision is activated.
- [ ] Tests and tracked files contain only synthetic resume data and no personal default employers, roles, skills, or prohibitions.
- [ ] Starting a scan never changes Liepin's native search or filter controls and processes only the result cards made available by the current page state.
- [ ] Each excluded or review-required job shows the predefined rule, rule version, decision, and a minimal JD evidence excerpt.
- [ ] No first-milestone UI or stored settings accept arbitrary filter prose, custom keywords, or regular expressions.
- [ ] Each accepted JD rule family has synthetic fixtures covering clear matches, clear non-matches, negation, preference/optional wording, and ambiguous wording.
- [ ] Rule settings start disabled and become active only after an explicit user choice is persisted.
- [ ] Scanning a fixture page does not trigger scroll, pagination, navigation, filter changes, form submission, or any other host-page interaction.
- [ ] Manually revisiting or navigating result pages cannot create duplicate processing for an opportunity already known under the accepted identity policy.
- [ ] Database constraints prevent two opportunities with the same user, platform, and platform job ID, including under concurrent scans.
- [ ] Synthetic jobs with different IDs remain separate even when every other observed field is identical.
- [ ] No similarity score, possible-repost state, or manual merge control exists in the first milestone.
- [ ] A schema-valid LLM exclusion is visible with its reasons and versioned evaluation context and prevents all duplicate detail or model processing for the same platform job identity.
- [ ] Invalid, incomplete, or ungrounded model output cannot create an exclusion record and instead produces a reviewable processing failure.
- [ ] Deterministic-rule exclusion and LLM exclusion remain distinguishable in stored records, UI filters, counts, and redacted diagnostics.
- [ ] Changing the JD text, active profile, filter configuration, rule catalog, prompt, or model does not cause an excluded platform job ID to be reevaluated.
- [ ] A different platform job ID is eligible for evaluation even when all other content matches an excluded opportunity.
- [ ] A VIP user can explicitly choose managed or BYOK processing, while a non-entitled user without BYOK receives a configuration prompt before any model-bound data is sent.
- [ ] Every model request preview and persisted result identifies whether managed or BYOK processing is active and identifies the provider and model.
- [ ] Exhausted managed quota or a failing BYOK provider produces a visible error without automatic provider or model fallback.
- [ ] Managed quota enforcement is tested server-side and cannot be bypassed by changing extension storage or request payloads.
- [ ] A default BYOK credential disappears when its Chrome session ends; an explicitly remembered credential survives restart only on that device and can be removed.
- [ ] Supabase Database, Storage, Auth metadata, logs, analytics, and error records contain no BYOK credential or recoverable derivative.
- [ ] Edge Function tests prove credentials are redacted from request diagnostics, provider failures, thrown errors, and responses.
- [ ] Preset and custom BYOK providers use one versioned OpenAI-compatible request and response contract.
- [ ] Synthetic endpoint tests cover allowed public HTTPS hosts, every rejected address class, DNS and redirect revalidation, malformed responses, and structured-output incompatibility.
- [ ] Resume or JD content cannot be sent through an untested or invalidated provider configuration.
- [ ] A user can authenticate with email and password without completing an email-confirmation flow and can recover the session after an MV3 worker restart.
- [ ] Login and registration failures do not reveal whether a submitted email already exists.
- [ ] VIP entitlement is read from server-owned authorization data and is never inferred from an email or extension-controlled field.
- [ ] Any user can register with a syntactically valid, unused email identifier and password without invitation or email confirmation.
- [ ] New product profiles have an unverified email status that client roles cannot modify.
- [ ] An unverified account can use every first-milestone core job workflow subject to its model entitlement or BYOK configuration.
- [ ] A successful generation produces one current Chinese plain-text draft within the length contract and passes JD-evidence and resume-fact validation.
- [ ] Generated text containing an uncited personal claim, unapproved commitment, contact detail, Markdown, or more than 200 Chinese characters is rejected before persistence.
- [ ] Editing a draft changes only the current edited text; regenerating adds an immutable generated revision and preserves all earlier generated and edited revisions.
- [ ] A model response without sufficient approved grounding produces manual review and no pending-message text.
- [ ] Valid PDF, DOCX, TXT, Markdown, and pasted-text synthetic fixtures produce normalized text and the same stable content hash for equivalent content.
- [ ] Spoofed extensions, malformed containers, image-only PDFs, legacy DOC, files over 10 MiB, and insufficient text fail before any model request.
- [ ] Model-request tests prove that resume binary data is never included and normalized source text is not persisted in Supabase after processing.
- [ ] Reimporting the same content hash opens the existing profile revision and consumes no additional model quota.
- [ ] On supported Liepin pages, the launcher opens the native side panel from a user action and can be hidden without disabling the extension.
- [ ] Removing or hiding the launcher leaves no large overlay, layout shift, or persistent page-level UI.
- [ ] The side panel and management page show consistent account, batch, opportunity, outbox, and ledger state after reload and MV3 worker restart.
- [ ] Keyboard focus, accessible naming, and text layout work at the supported side-panel width without overlapping the host page.
- [ ] A scan alone opens no detail tab and invokes no model; the preview preselects only new processable opportunities.
- [ ] The batch selector defaults to 10, rejects values outside 1 through 20, and leaves excess opportunities unprocessed for a later batch.
- [ ] A running batch never has more than one extension-owned detail tab and pause, resume, or cancel preserves every completed record.
- [ ] Starting a batch requires an explicit user action after the selected count, model route, and maximum call count are visible.
- [ ] Deterministic ambiguity and LLM review items appear in one queue with distinct source labels, reasons, evidence, and job links while the batch continues.
- [ ] Continue generation follows the correct deterministic-review or LLM-review path without repeating an already completed suitability evaluation.
- [ ] Permanent user exclusion is reused by all later scans of the same platform job ID and remains distinguishable from deterministic and model exclusions.
- [ ] Continue as exception is available from deterministic, model, and user exclusion records only after explicit confirmation and appends a user-override event.
- [ ] User override preserves the original decision and evidence, skips suitability reevaluation, and either creates a valid grounded draft or returns to manual review.
- [ ] Leaving a review item pending causes no repeated detail or model work.
- [ ] LLM fixtures prove title mismatch, one missing skill, optional requirements, preference wording, and score alone cannot exclude an opportunity.
- [ ] Every LLM exclusion includes core JD evidence and a grounded conflict or multiple-core-responsibility mismatch under the accepted conservative criteria.
- [ ] The record center can filter and inspect every current first-milestone state and shows append-only history rather than an editable raw status field.
- [ ] Side-panel summaries reconcile with record-center counts after reload and link to the corresponding filtered records.

## Deferred Future Decisions

- Live submission and greeting selectors, evidence, rate, maximum daily limit, and platform-rule compliance require a separately approved safety milestone.
- Automatic pagination, scrolling, and page-open execution require real-page research after the first-milestone read-only adapter is stable.
- Conversation polling, reply generation, rejection classification, contact-exchange classification, silence handling, and stop conditions belong to later milestones.
- Email verification, password recovery, payment, subscription lifecycle, and automatic VIP provisioning are deferred.
- Native model-provider protocols, additional JD-rule families, additional recruitment platforms, and OCR are deferred.

## Technical Notes

- Treat job descriptions, resume content, and model output as untrusted input.
- A persisted setting is not sufficient authorization for a live action.
- Platform success requires platform-read evidence; an attempted click or resolved API call is not success evidence.
- Free-tier limits are development constraints, not product availability guarantees; the system must fail visibly rather than silently losing work when a quota or project pause is encountered.
- Later automatic pagination and scrolling must extend the same discovery queue, deduplication, limits, pause, and recovery contracts rather than creating a separate crawler.

## Manual Acceptance

- Build and load the tracked dist directory in Chrome 120 or later, then confirm the right-edge launcher opens the native side panel without shifting the Liepin page.
- Register and sign in with a synthetic test account, restart the MV3 worker, and confirm the session and tenant-owned records recover without exposing tokens to the content script.
- Configure a synthetic BYOK endpoint or test provider, run its connection test, and confirm route/provider/model disclosure before any resume or JD content is sent.
- Import synthetic TXT, DOCX, and text-layer PDF resumes, approve a profile, replace the source, and confirm local availability and cloud profile-version behavior.
- Configure representative first-catalog JD rules and process one to three jobs in draft-only mode; inspect deterministic exclusion, model exclusion, review, user override, draft editing, and revision history where applicable.
- Inspect service-worker DevTools, Liepin content-script Console, Supabase local logs, and Extension Storage and confirm no real resume, BYOK credential, authorization token, or full model payload is logged.
- Reload the extension, refresh the Liepin page, and confirm queue, record-center, and side-panel projections recover without duplicate opportunities or model calls.
- Confirm no button click, form fill, resume upload, message send, application submission, private write API, cookie access, automatic scroll, or pagination occurs during first-milestone acceptance.
