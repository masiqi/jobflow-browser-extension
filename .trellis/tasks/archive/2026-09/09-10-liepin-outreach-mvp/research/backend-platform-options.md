# Backend platform options

- Researched: 2026-09-10
- Scope: free-tier suitability for an authenticated Chrome-extension MVP
- Source policy: current official product documentation and pricing pages

## Required capabilities

The first milestone needs:

- consumer user authentication usable by a Chrome extension;
- tenant-isolated relational records for profiles, preferences, jobs, drafts, and ledger events;
- private file storage if source resumes are retained;
- server-side model credentials and an authenticated model-proxy endpoint;
- a development-scale free tier.

## Supabase-centric

Supabase directly combines Auth, Postgres, Row Level Security, Storage, and Edge Functions. Its public client key can be present in the extension only when every exposed table and storage bucket is protected by tested RLS policies; server-role and model-provider secrets remain server-side.

Current Free plan headline limits:

- 50,000 monthly active users;
- 500 MB database;
- 1 GB file storage;
- 5 GB egress plus 5 GB cached egress;
- 500,000 Edge Function invocations;
- two active free projects.

Free projects with low activity over a seven-day period may be paused. Supabase describes the Free plan as appropriate for passion projects and simple sites; production availability requires a paid plan or acceptance of pause/quota behavior.

Sources:

- [Supabase pricing](https://supabase.com/pricing)
- [Edge Functions pricing](https://supabase.com/docs/guides/functions/pricing)
- [Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)

## Cloudflare-centric

A Cloudflare-native implementation can use Workers for the API, D1 for relational data, R2 for resume files, and Workers AI or an external model provider for inference. These components have ample prototype-scale free allowances, scale to zero, and do not require a continuously running database process.

Current Free plan headline limits include:

- Workers: 100,000 requests per day and 10 ms CPU per invocation;
- D1: 5 million rows read per day, 100,000 rows written per day, and 5 GB total storage;
- R2: 10 GB-month storage, 1 million Class A operations, and 10 million Class B operations per month;
- Workers AI: 10,000 Neurons per day, after which Free-plan inference fails until reset or upgrade.

Cloudflare Access protects organizational or controlled-access applications through configured identity providers and policies. It is not an integrated consumer-account database equivalent to Supabase Auth. A Cloudflare-centric consumer product therefore needs an additional authentication system or a custom auth implementation, including email delivery and account recovery.

Sources:

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Cloudflare Access identity providers](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/)

## Hybrid

A hybrid could use Supabase Auth/Postgres/Storage and a Cloudflare Worker for API or AI orchestration. This is technically viable, but it adds two deployment systems, cross-provider authorization validation, more secret management, more failure modes, and an extra network boundary before the MVP demonstrates product value.

## Recommendation

Use a Supabase-centric backend for the first milestone:

- Supabase Auth for product accounts;
- Postgres with mandatory RLS for structured user data;
- a private Storage bucket only if source-resume retention is approved;
- Edge Functions for authenticated model calls and operations requiring server secrets;
- the extension as an untrusted public client holding only publishable configuration and user session tokens.

Do not add Cloudflare to the request path initially. It remains a reasonable later choice for DNS, static web assets, bot protection, AI Gateway, or a Worker edge facade when a measured need justifies the second provider.

The free plan is suitable for development and a small invitation-only test, not an availability commitment. Before public production, budget for at least the Supabase Pro baseline or implement an explicit degraded-mode and recovery plan.
