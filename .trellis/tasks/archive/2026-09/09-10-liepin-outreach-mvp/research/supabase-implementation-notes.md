# Supabase implementation notes

- Researched: 2026-09-10
- Scope: authentication, Edge Functions, RLS testing, and custom outbound model endpoints

## Edge Function authentication

Supabase documents that Edge Functions require a valid JWT by default. Authenticated handlers should use a caller-scoped Supabase client so database requests run through the same Row Level Security policies as the user. Server-role access is reserved for narrow trusted commands and must perform explicit ownership checks.

Sources:

- [Securing Edge Functions](https://supabase.com/docs/guides/functions/auth)
- [Edge Function authorization headers](https://supabase.com/docs/guides/functions/auth-headers)
- [Function configuration](https://supabase.com/docs/guides/functions/function-configuration)

## Local development and tests

Supabase documents local Edge Function development through the CLI and a Docker-compatible runtime. It provides guidance for unit and full-function tests. Database and RLS policies can be tested with pgTAP through the Supabase CLI.

Sources:

- [Edge Functions quickstart](https://supabase.com/docs/guides/functions/quickstart)
- [Testing Edge Functions](https://supabase.com/docs/guides/functions/unit-test)
- [Database testing overview](https://supabase.com/docs/guides/local-development/testing/overview)
- [Advanced pgTAP testing](https://supabase.com/docs/guides/local-development/testing/pgtap-extended)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)

## Secrets

Managed provider keys and other server credentials use Supabase Edge Function secrets and local untracked environment files. No production secret belongs in source, migrations, browser bundles, fixtures, task artifacts, or logs.

Source:

- [Edge Function environment variables and secrets](https://supabase.com/docs/guides/functions/secrets)

## Chrome MV3 session storage

Supabase JS accepts a custom Auth storage implementation, but current official documentation does not provide a Chrome MV3-specific adapter. The extension design therefore centralizes the Supabase client in the background service worker and supplies an asynchronous chrome.storage.local adapter. Side-panel and management pages call the background through validated runtime messages. Content scripts never receive access or refresh tokens.

This behavior needs regression tests for concurrent client initialization, token refresh, worker suspension, sign-out, and session corruption. Community examples are implementation hints rather than authoritative security evidence.

## Custom endpoint SSRF boundary

Deno exposes DNS resolution for A and AAAA records. A secure proxy can reject local, private, loopback, link-local, reserved, and metadata addresses before a request and can use manual redirect handling to revalidate every hop.

Source:

- [Deno network API and resolveDns](https://docs.deno.com/api/deno/network/)

A DNS lookup performed before fetch does not cryptographically pin the later fetch connection to those addresses. This leaves a time-of-check/time-of-use and DNS-rebinding residual risk. The first implementation must:

- allow only HTTPS;
- reject IP-literal hosts and URL credentials;
- resolve and validate all A and AAAA results immediately before each request;
- disable automatic redirect following and validate every redirect URL;
- enforce response size and timeout limits;
- include adversarial resolver and redirect tests;
- keep custom providers disabled in production if the deployed runtime cannot satisfy these controls.

The residual risk must be revisited before public production. Preset allowlisted provider origins remain the lower-risk path.
