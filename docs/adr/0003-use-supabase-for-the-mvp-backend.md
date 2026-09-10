# ADR 0003: Use Supabase for the MVP backend

- Status: Accepted
- Date: 2026-09-10
- Research: `.trellis/tasks/09-10-liepin-outreach-mvp/research/backend-platform-options.md`

## Context

The first milestone now requires product accounts and hosted data. It needs consumer authentication, relational tenant-owned records, optional private resume-file storage, and server-side model calls. Development and a small invitation-only test should fit within a managed free tier.

Supabase combines these capabilities in one project. A Cloudflare-native stack has suitable compute and storage products but would require an additional consumer-authentication system. A hybrid would introduce two deployment and authorization boundaries before the product has validated its core value.

## Decision

Use a Supabase-centric backend for the first milestone:

- Supabase Auth owns product identities and sessions.
- Supabase Postgres stores user profiles, resume profiles, preferences, job opportunities, pending messages, and ledger events.
- Row Level Security is mandatory on every user-owned table, including negative cross-user authorization tests.
- Supabase Storage is not used for source resumes under ADR 0004.
- Supabase Edge Functions validate the caller session and perform model calls or other operations requiring secrets.
- The Chrome extension contains only publishable Supabase client configuration and the current user's session material.
- Supabase privileged credentials and model-provider credentials exist only in server-side secret storage.

Do not put Cloudflare in the first-milestone request path. Reconsider Cloudflare later only when a measured requirement justifies it.

The Supabase Free plan is accepted for development and a small invitation-only test. It is not a production availability or zero-cost guarantee; quota exhaustion and free-project pausing must produce visible failures rather than silent data loss.

## Consequences

- Authentication, database migrations, RLS policies, Edge Functions, and authorization tests become part of the first milestone.
- The current Chrome-local storage model needs a migration boundary rather than remaining the authoritative store for user data.
- The extension is treated as an untrusted public client; obscuring a key in its bundle is not a security control.
- Public production will require a paid-service decision or an explicit operational policy for free-tier pauses and limits.
- Source-resume persistence follows ADR 0004: the authoritative source remains on the client and only its structured profile is stored in Supabase.
