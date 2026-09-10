# ADR 0006: Use platform coarse filtering and a closed JD rule catalog

- Status: Accepted
- Date: 2026-09-10
- Research: `.trellis/tasks/09-10-liepin-outreach-mvp/research/liepin-filter-boundary.md`

## Context

Liepin already provides search and filter controls for broad, structured attributes. Some disqualifying requirements appear only in free-form job descriptions, including school-pedigree requirements, travel, work arrangements, and required technologies.

Duplicating Liepin's filter UI would create a second source of truth and couple the extension to changing platform query semantics. Allowing arbitrary user-authored prose, keywords, or regular expressions would make decisions hard to validate, explain, and support.

## Decision

Split filtering into two explicit stages:

1. **Platform coarse filtering**: the job seeker uses Liepin's native search and filter controls. The extension does not manipulate those controls.
2. **JD fine filtering**: after an explicit scan, the extension opens each selected result's public detail page and evaluates the complete JD against a versioned, product-defined rule catalog.

The JD rule catalog is closed:

- users configure only the options exposed by structured controls;
- users cannot enter arbitrary filter prose, custom keywords, or regular expressions;
- product-owned keyword and phrase patterns may implement a rule internally;
- each decision stores the rule identifier and version and shows minimal JD evidence;
- deterministic hard exclusions cannot be overturned by a model;
- missing or ambiguous evidence produces manual review rather than silent exclusion.

The first-milestone catalog is limited to:

| Rule family | Structured choices | Decision boundary |
| --- | --- | --- |
| School pedigree | Accept all, or reject mandatory elite-school requirements | Mandatory configured pedigree requirements exclude; preference-only or ambiguous wording requires review |
| Travel and mobility | No travel, occasional travel allowed, or unrestricted | Clear requirements beyond the selected tolerance exclude; unclear frequency or scope requires review |
| Engagement/onsite model | Independently allow or reject outsourcing, dispatch, and long-term client-site work | Explicit configured arrangements exclude; ambiguous company/project descriptions require review |
| Work schedule | Independently allow or reject night shifts, rotating shifts, big/small weeks, single rest days, and long-term on-call | Explicit configured schedules exclude; occasional or unclear duties require review |
| Primary technology | Select disallowed technologies from a product-maintained finite catalog | Only primary or mandatory requirements exclude; incidental, optional, migration-source, or negated mentions do not |

All rules start disabled and require an explicit user choice. New rule families are deferred to later catalog versions rather than added through free-form escape hatches.

## Consequences

- The extension remains compatible with user-selected native filters without needing to understand every Liepin query parameter.
- Search quality partly depends on how the user configures Liepin before scanning.
- The extension must distinguish observed list-card fields from verified detail-page fields.
- Rule pattern changes are behavioral changes that require versioned synthetic fixtures and regression tests.
- Each rule version requires clear-match, non-match, negation, optional/preference, and ambiguous fixtures.
- Existing free-form custom include, exclude, and review keyword settings do not fit the confirmed product model and must be removed or migrated.
