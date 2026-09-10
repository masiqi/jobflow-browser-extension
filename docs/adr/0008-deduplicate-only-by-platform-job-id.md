# ADR 0008: Deduplicate only by platform job ID

- Status: Accepted
- Date: 2026-09-10

## Context

The same Liepin job can appear on multiple result pages and in multiple scans. A company can also publish separate jobs with identical titles or repost similar content under a new platform job ID.

Similarity heuristics introduce false merges, review states, and behavior that is difficult to explain. The product owner explicitly does not want inferred reposts or possible-duplicate handling.

## Decision

Within one user's data domain, the only job-opportunity identity is:

```text
(platform, platform_job_id)
```

- Re-observing the same key may update latest observed metadata but does not create another opportunity or default draft.
- A different platform job ID always creates a different opportunity, regardless of matching company, title, recruiter, location, or JD content.
- Do not calculate similarity, infer reposts, show possible-duplicate warnings, or expose heuristic merge controls.
- Enforce the identity with a database uniqueness constraint including the owning user ID so concurrent scans cannot create duplicates.

## Consequences

- Cross-page, cross-batch, and cross-device scans have deterministic deduplication for each product user.
- Reposted jobs with new IDs are treated as new opportunities and may receive new drafts or future outreach.
- The product intentionally accepts possible repeated contact caused by a platform assigning a new ID to substantially the same role.
- The implementation remains simple and does not retain sensitive JD embeddings or similarity features.
