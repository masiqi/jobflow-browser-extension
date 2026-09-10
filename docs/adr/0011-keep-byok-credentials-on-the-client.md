# ADR 0011: Keep BYOK credentials on the client

- Status: Accepted
- Date: 2026-09-10

## Context

Synchronizing user-supplied model credentials would require the product to retain decryptable third-party secrets and protect a fleet-wide encryption key. A local-only credential cannot be recovered across devices, but it narrows the backend breach surface and matches the device-local source-resume boundary.

## Decision

BYOK credentials remain only in the current Chrome client:

- The default is session-only storage and expires with the browser session.
- The user may explicitly select remember on this device after seeing that Chrome local extension storage is not a system keychain.
- A remembered credential remains only in the current Chrome profile and has an explicit remove control.
- Supabase must not store the credential in plaintext, ciphertext, Auth metadata, backups, logs, analytics, diagnostics, or any recoverable form.
- An authenticated Edge Function may receive the credential for one model request, use it transiently, and discard it.
- Request logging, provider error handling, thrown errors, and responses must redact the credential and common authorization representations.

## Consequences

- Users re-enter BYOK credentials on new devices and, by default, after a browser session ends.
- Remembering a credential trades convenience for exposure to shared Chrome profiles, malicious extensions, or local-device compromise.
- The backend cannot recover user credentials and support staff must never request them.
- The extension-to-Edge-Function contract carries a high-sensitivity transient field and needs dedicated redaction tests.
