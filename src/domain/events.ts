import type { OpportunityEvent, OpportunityRecord, OpportunityStatus } from "./types";

const EVENT_STATUS: Partial<Record<OpportunityEvent["kind"], OpportunityStatus>> = {
  opportunity_observed: "discovered",
  details_captured: "extracting",
  deterministic_excluded: "deterministic_excluded",
  evaluation_started: "evaluating",
  review_requested: "review_required",
  user_excluded: "user_excluded",
  generation_started: "generating",
  generation_completed: "draft_ready",
  draft_edited: "draft_ready",
  processing_failed: "failed"
};

export function projectOpportunity(
  initial: OpportunityRecord,
  events: OpportunityEvent[]
): OpportunityRecord {
  return [...events]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .reduce((record, event) => {
      if (event.opportunityId !== record.id) return record;
      const next = { ...record, lastSeenAt: event.createdAt };
      if (event.kind === "evaluation_completed") {
        const outcome = event.payload.outcome;
        next.status =
          outcome === "exclude"
            ? "model_excluded"
            : outcome === "review"
              ? "review_required"
              : "generating";
      } else if (event.kind === "user_override") {
        next.status = "generating";
      } else {
        const status = EVENT_STATUS[event.kind];
        if (status) next.status = status;
      }
      if (typeof event.payload.reason === "string") next.latestReason = event.payload.reason;
      return next;
    }, initial);
}

export function canContinueAsException(status: OpportunityStatus): boolean {
  return ["deterministic_excluded", "model_excluded", "user_excluded"].includes(status);
}

export interface ProjectedRuleEvidence {
  ruleId: string;
  reason: string;
  evidence: string[];
}

export function projectRuleEvidence(events: OpportunityEvent[]): ProjectedRuleEvidence[] {
  const output: ProjectedRuleEvidence[] = [];
  for (const event of events) {
    const filter = event.payload.filter;
    if (!filter || typeof filter !== "object") continue;
    const decisions = (filter as { decisions?: unknown }).decisions;
    if (!Array.isArray(decisions)) continue;
    for (const value of decisions) {
      if (!value || typeof value !== "object") continue;
      const item = value as { ruleId?: unknown; reason?: unknown; evidence?: unknown };
      if (typeof item.ruleId !== "string" || typeof item.reason !== "string") continue;
      const snippets = Array.isArray(item.evidence)
        ? item.evidence.flatMap((entry) =>
            entry && typeof entry === "object" && typeof (entry as { text?: unknown }).text === "string"
              ? [(entry as { text: string }).text]
              : []
          )
        : [];
      output.push({ ruleId: item.ruleId, reason: item.reason, evidence: snippets });
    }
  }
  return output;
}
