# ADR 0013: Use unverified email and password authentication

- Status: Accepted
- Date: 2026-09-10

## Context

The first milestone requires Supabase product accounts. Email one-time codes, magic links, phone login, and third-party OAuth add delivery, callback, provider, or cost dependencies that are not desired for the initial release.

The product owner accepts email and password without registration-time email confirmation.

## Decision

Use Supabase email and password authentication and disable registration-time email confirmation.

Treat the email as an unverified login identifier:

- it does not prove mailbox ownership;
- it is not a verified contact channel;
- it cannot independently grant VIP or administrative entitlement;
- authentication errors do not reveal whether it is already registered.

Phone login, email OTP or magic link, and third-party OAuth are deferred. Password attempts require server-enforced rate limiting and must not rely on extension state.

Registration access and password-recovery behavior remain separate product decisions. A conventional email reset link would prove current mailbox access during recovery even though registration did not.

Registration is open and uses no invitation or allowlist. A separate server-controlled product-profile field records email verification status, defaults to unverified, and is not writable by the extension or owning user. The field is reserved for a future verification flow and does not block first-milestone core features.

Email verification, invitation management, and self-service password recovery are not implemented in the first milestone.

## Consequences

- Initial sign-up has less friction and does not depend on email delivery.
- A user can mistype or impersonate an email address unless registration is otherwise controlled.
- Open registration would permit email-address squatting.
- The product accepts email-address squatting risk during the first milestone.
- Users who lose their password have no self-service recovery until a later verified-email flow exists.
- VIP entitlement must live in server-owned authorization data rather than email conventions or client metadata.
