# ADR 0021: Use One Extension With Platform Adapters And Target Zhaopin Next

- Status: Accepted for the next implementation target
- Date: 2026-09-17

## Context

JobFlow should support more than one recruitment platform without creating a
separate Chrome extension for each site. The shared product behavior is the
same: scan the current result snapshot, normalize a job identity, persist the
detail, apply the closed JD rule catalog, call the model, and expose a draft or
an explicitly authorized delivery flow. Platform-specific DOM, route, login,
resume, application, greeting, and risk-control behavior must remain in an
adapter boundary.

BOSS Zhipin is explicitly deferred. The developer-mode behavior observed by the
team makes it unsuitable for the next development target, and this ADR does not
authorize attempts to evade that behavior.

## Decision

Keep one MV3 extension and add platform adapters behind the existing shared
side-panel, background queue, storage, model, quota, and evidence contracts.
The next platform is **智联招聘 (Zhaopin)**.

The first Zhaopin increment is read-only discovery and draft generation:

1. recognize only explicit Zhaopin list routes and current-DOM job cards;
2. normalize Zhaopin's platform job ID into the shared `ListCandidate` shape;
3. open and capture a public job detail page, preserving the full detail in the
   owner-scoped opportunity record;
4. reuse the shared JD rules, profile grounding, model validation, draft
   history, side-panel selection, and failure/pause UI;
5. perform no Zhaopin write until a later reviewed-send increment has its own
   fixtures and an explicit user-approved live test.

The shared identity remains `user_id + platform + platform_job_id`. Platform
selectors and action state are never inferred from another adapter. Any future
Zhaopin reviewed-send or automatic-send path must use the same job-bound
preflight, daily quota, evidence, retry, and risk-control handoff contracts as
Liepin, with only the adapter's platform commands and bounded failure codes
varying.

## Research Basis

The following public pages were inspected on 2026-09-17 with read-only
requests:

- Zhaopin sample detail:
  `https://www.zhaopin.com/jobdetail/CCL1501502560J40877030814.htm` returned
  HTTP 200 and exposed a stable `/jobdetail/` route, a structured job title,
  location, experience, education, and a `### 职位描述` section. The page also
  clearly separates public detail from login-required complete content.
- 51job sample detail:
  `https://jobs.51job.com/beijing-hdq/110630756.html?s=01` returned a public
  wrapper but reported “当前职位审核中或已下线” and showed recommendation
  content rather than a dependable detail payload. Its public routes also span
  `jobs.51job.com`, `we.51job.com`, and other subdomains.
- Lagou search:
  `https://www.lagou.com/zhaopin/yonghuyanjiuyuan/` exposed login/register
  flows and a WAF/verification surface in the unauthenticated result. That is a
  higher-friction first target for the current debugging phase.

This is a feasibility decision, not a ranking claim about the platforms or a
guarantee that Zhaopin will permit automation. Live platform behavior must be
verified with a small, user-approved test after the read-only adapter is stable.

## Consequences

- The manifest and content script remain one extension; platform support is a
  capability registry and adapter selection, not a collection of plugins.
- Shared code must not branch on undocumented CSS selectors. Each adapter owns
  route guards, list/detail extraction, platform job identity, action discovery,
  and risk/login classification.
- Host permissions remain exact and minimal. Add Zhaopin origins only after a
  fixture proves the required route; do not add cookies, broad origins, or
  private recruitment APIs.
- The first Zhaopin release is `draft_only`/read-only while selectors and
  account behavior are learned. Reviewed sending and automatic sending remain
  separate, later acceptance gates.
- Automatic pagination, scrolling, conversation replies, rejection
  classification, and off-platform contact exchange remain out of scope.

## Rejected Alternatives

- **BOSS Zhipin next**: deferred by explicit product decision because developer
  mode immediately triggers a risk response.
- **51job next**: public pages are widespread, but the sampled detail was an
  unavailable-job shell and route ownership is fragmented, increasing the
  first adapter's uncertainty.
- **Lagou next**: unauthenticated pages expose login/WAF friction before a
  stable detail contract can be established.
- **A separate extension per platform**: rejected because it duplicates update,
  storage, auth, model, quota, and safety boundaries and would allow behavior
  to drift between platforms.
