# ADR 0004: Keep source resumes on the client

- Status: Accepted
- Date: 2026-09-10

## Context

Resume source files contain highly sensitive personal data. The model needs source content when creating a structured profile, and a future reviewed-send milestone may need the exact file when formally applying. Cloud retention is not necessary for either requirement.

Keeping only the structured profile in Supabase reduces breach impact, storage authorization complexity, retention obligations, and accidental reuse of stale source files. Requiring the user to select the file for every future application would make the client workflow unnecessarily fragile.

## Decision

Split resume persistence across client and backend:

- The Chrome extension keeps an extension-private local copy of the active source resume on the current device.
- Supabase persists the structured resume profile, source content hash, non-sensitive source metadata, and profile version.
- Supabase Database and Storage do not persist the source file or full extracted resume text after processing completes.
- Source content may transit an authenticated processing path and the configured model provider only during an explicit resume-processing operation.
- Product-controlled logs, analytics, error payloads, and model-request logs must not contain source resume content.
- The user can inspect the active local file metadata, replace the file, and delete the local copy.
- Missing local data is an explicit state. The product must request a new import and must never substitute a different file or claim that the resume remains available.
- The local source resume is the product's authoritative resume version.
- The extension displays whether the local source is available and whether its content hash matches the active cloud profile.
- A future formal submission uses the local file when Liepin supports it. If Liepin requires a platform-hosted resume, the user must explicitly bind that platform resume to the authoritative local version.
- Missing local data, a content-hash mismatch, or an absent platform-resume binding blocks future formal submission.

This decision does not authorize uploading a resume to Liepin in the current draft-only milestone.

## Consequences

- The source resume does not synchronize across browsers or devices and may be lost when extension data is cleared or the extension is removed.
- A user signing in on a new device can access the structured profile but must import the matching source file before any future operation that requires the original.
- The local and cloud records must be linked by a content hash and version, and version mismatches must block resume-dependent external actions.
- Client-local binary persistence, quota handling, replacement, deletion, and corruption recovery must be covered by the technical design and tests.
- Liepin adapters must expose whether direct file submission is supported and must not infer that an unverified platform-hosted resume matches the local source.
