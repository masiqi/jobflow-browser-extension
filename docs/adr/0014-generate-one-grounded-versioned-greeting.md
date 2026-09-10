# ADR 0014: Generate one grounded, versioned greeting

- Status: Accepted
- Date: 2026-09-10

## Context

The first milestone exists partly to calibrate greeting quality before any platform write is allowed. Producing several candidates per job increases model cost and review burden, while rigid requirements such as exactly two resume facts or a mandatory closing question make messages formulaic.

Generated content must remain truthful, inspectable, and editable without destroying the evidence needed to debug the model.

## Decision

For each opportunity with an LLM proceed decision, generate one current pending-message draft:

- Chinese plain text;
- target length of 80 to 140 Chinese characters;
- absolute maximum of 200 characters;
- at least one specific JD requirement connected to one or two approved resume facts;
- structured references to the JD evidence and resume fact IDs;
- an optional, natural, low-friction question rather than a mandatory question-mark ending.

Reject generated content that fabricates or overstates experience, responsibility, metrics, skills, education, or commitments. Do not introduce contact details, salary, start-date, or travel commitments unless the user has explicitly approved those facts for communication. Do not emit Markdown, lists, headings, or model explanations in the message body.

Keep generated revisions immutable. Store the current user-edited text separately. Manual regeneration creates a new generated revision and preserves earlier generated and edited revisions.

Each generated revision records the opportunity and JD evidence, profile revision and fact IDs, model route/provider/model, prompt version, and creation time.

If the model cannot ground a truthful greeting in approved facts, require manual review and create no generic or fabricated pending message.

## Consequences

- The outbox remains compact with one current message per opportunity.
- Users can compare history after regeneration without choosing among several up-front variants.
- Validation needs both structural checks and claim grounding against approved facts.
- The current hard-coded 100 to 160 character, exactly-two-facts, mandatory-question contract must be replaced.
