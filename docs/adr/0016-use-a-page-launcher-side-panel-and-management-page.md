# ADR 0016: Use a page launcher, side panel, and management page

- Status: Accepted
- Date: 2026-09-10
- Reference: .trellis/tasks/09-10-liepin-outreach-mvp/research/immersive-translate-ui-reference.md

## Context

The current prototype injects a large batch panel into Liepin and uses an options page for configuration. The confirmed product needs in-context scanning plus dense workflows for profile review, rule configuration, draft editing, and ledger inspection.

Immersive Translate publicly documents a right-edge floating entry that opens extension controls and a separate settings page for deeper configuration. Its recent changelog also makes the floating entry optional. This interaction hierarchy is useful, while its exact visual design and implementation are not copied.

## Decision

Use three extension-owned interface levels:

1. A small, unobtrusive, hideable launcher appears at the edge of supported Liepin pages.
2. A user gesture on the launcher opens the native Chrome side panel for current-page scan, batch preview and controls, progress, and current opportunity results.
3. A full-page extension management surface handles account access, resume import and profile review, JD rules, managed and BYOK model settings, and a complete job-record center containing review items, outbox drafts, exclusions, failures, later delivery states, draft revisions, and transition history.

The content script injects only the launcher and minimal job-card state markers. It does not inject a large application panel. The toolbar action is only a shortcut to extension surfaces.

Side panel and management page reuse domain components and backend contracts and must not present conflicting state.

## Consequences

- Active job browsing remains visible while quick controls are open.
- Dense editing is not constrained to a narrow side panel.
- Two extension views require shared state and responsive components.
- The launcher needs hide, accessibility, host-layout, and SPA-navigation tests.
- The current large injected floating panel must be replaced.
