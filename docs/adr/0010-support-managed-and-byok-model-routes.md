# ADR 0010: Support managed and BYOK model routes

- Status: Accepted
- Date: 2026-09-10
- Research: .trellis/tasks/09-10-liepin-outreach-mvp/research/model-entitlement-and-byok.md

## Context

A consumer product should offer a working model without requiring every paying user to obtain developer credentials. Some users still need provider choice, existing credits, custom endpoints, or control over model spending.

Immersive Translate demonstrates this product split: paid membership offers managed AI translation, while service settings support user-supplied API keys and custom OpenAI-compatible addresses. Its public documentation does not establish a storage contract suitable for this product, so only the entitlement pattern is adopted.

## Decision

Support two explicit model routes:

- Managed: VIP users default to a product-managed provider and a server-enforced usage quota.
- BYOK: users may explicitly configure and select their own supported provider credentials.

VIP users may choose either route. Users without the managed entitlement must configure BYOK before any operation that requires a model.

Before any resume or JD content is sent, the interface shows the active route, provider, and model. Every persisted model result records them.

Never silently fall back between managed and BYOK routes, providers, or models. Quota exhaustion, invalid credentials, incompatible endpoints, provider failures, and invalid outputs remain visible errors.

Managed quotas are enforced by the backend and cannot rely on extension state. Usage records contain counts and provider billing units but exclude resume text, JD text, prompts, credentials, and full model output.

BYOK credential persistence is defined by ADR 0011. The first provider protocol and catalog are defined by ADR 0012.

## Consequences

- Product-managed inference has an operator cost and requires abuse-resistant quotas.
- BYOK expands model access without granting users managed quota.
- Reproducibility and support require model route and version metadata on every evaluation and generated draft.
- The backend API needs an explicit route selection rather than choosing a provider after an error.
