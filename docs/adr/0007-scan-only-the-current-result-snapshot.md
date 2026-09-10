# ADR 0007: Scan only the current result snapshot

- Status: Accepted
- Date: 2026-09-10

## Context

Liepin result pages may use pagination, lazy loading, or infinite scrolling. Automatically operating these mechanisms increases coupling to page behavior, complicates recovery and rate limits, and makes early extraction failures harder to diagnose.

The first milestone needs a predictable set of observed jobs so filtering and message quality can be calibrated. Future iterations should support pagination and scrolling without replacing the underlying discovery and deduplication model.

## Decision

For the first milestone, a scan reads only job cards already present in the current page DOM when the user explicitly starts the scan.

The scan must not:

- scroll the host page;
- click next-page or load-more controls;
- navigate to another result page;
- change Liepin search or filter controls.

Before detail processing, the extension reports observed cards, valid job leads, duplicates, and the selected batch size. The user may manually paginate, scroll, or otherwise load more results and start another scan. All scans use the same cloud opportunity ledger and deduplication policy.

Automatic pagination, scrolling, and continuous multi-page discovery are accepted future requirements, outside the current milestone. They must extend the same queue, limits, pause, recovery, and deduplication contracts and must remain independent from any contact or application action.

## Consequences

- The first milestone requires user interaction to cover more than the currently loaded result set.
- Fixture tests can define the scan input deterministically.
- Future continuous collection needs a platform-adapter capability rather than a separate crawler or state store.
- The next design decision must define opportunity identity across scans and reposts.
