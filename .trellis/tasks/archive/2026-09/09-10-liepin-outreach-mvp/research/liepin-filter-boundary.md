# Liepin filtering boundary

- Researched: 2026-09-10
- Scope: public evidence for native coarse filters and JD-only fine filters

## Public observations

The publicly crawlable Liepin mobile search page exposes a large city taxonomy. A public company jobs page exposes filter headings for position, experience, city, and salary. Public job cards commonly include title, salary, location, experience, and education.

Observed sources:

- [Liepin mobile job search](https://m.liepin.com/zhaopin/)
- [Example public Liepin company jobs page](https://m.liepin.com/company/7893220/)

The logged-in desktop search experience is client-rendered and may vary by route, session, experiment, and platform update. Public crawling did not provide reliable evidence that every desktop filter or its query representation remains stable. Exact desktop filter availability therefore requires manual inspection in the supported Chrome workflow and must not be hard-coded from this research alone.

## Boundary

Delegate broad structured selection to the user's current Liepin experience wherever the platform offers it, including role/search terms and available location, salary, experience, education, or company filters. The extension should not operate those controls or attempt to keep a duplicate set synchronized.

Treat the currently rendered result set as unverified job leads. The extension may capture the source URL and observable card/filter context for traceability, then use the full public job detail for its own finite JD rules.

## Candidate first rule catalog

The following rules target information frequently expressed in the JD rather than reliably represented by a native coarse filter:

| Rule family | Structured user choice | Example product-owned signals | Recommended outcome |
| --- | --- | --- | --- |
| School pedigree | Reject mandatory elite-school requirements | `985`, `211`, `双一流`, `重点院校`, qualified by mandatory or preference language | Exclude when mandatory; review when merely preferred or ambiguous |
| Travel and mobility | No travel, occasional travel allowed, or unrestricted | `出差`, `长期出差`, `高频出差`, `驻场`, `驻点`, `外派`, `异地调动` | Exclude when clearly beyond tolerance; otherwise review |
| Engagement model | Reject outsourcing, dispatch, or long-term client-site work | `外包`, `派遣`, `驻场开发`, `乙方驻场`, `项目制外派` | Exclude when the employment or placement requirement is explicit |
| Work schedule | Reject configured schedules | `夜班`, `倒班`, `大小周`, `单休`, `轮班`, `长期 on-call` | Exclude when explicitly required; otherwise review |
| Primary technology | Reject selected technologies when they are core job requirements | a product-maintained technology vocabulary such as `Java` plus requirement context | Exclude only when core/required; incidental mentions do not match |

The five rule families were accepted for the first milestone on 2026-09-10. Every phrase set needs synthetic positive, negative, negated, and ambiguous fixtures. Keyword presence alone is insufficient when context changes the meaning, for example “无需出差,” “偶尔出差,” “Java 经验非必需,” or “985/211 优先.”

## Sources and limitations

Search results outside Liepin were not used as authoritative product evidence for Liepin's filter UI. No logged-in account, private API, cookie, or platform write operation was used during this research. The exact supported desktop flow must be captured through a later manual, read-only Chrome acceptance pass with sanitized fixtures for automated tests.
