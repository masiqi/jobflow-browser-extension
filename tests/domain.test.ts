import { describe, expect, it } from "vitest";
import { applyDeliveryPatch, deriveDeliveryOverallStatus, deliveryPartialReason } from "../src/domain/delivery";
import { canContinueAsException, projectOpportunity, projectRuleEvidence } from "../src/domain/events";
import type { DeliveryRecord, OpportunityEvent, OpportunityRecord } from "../src/types";

const initial: OpportunityRecord = {
  id: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  platform: "liepin",
  platformJobId: "synthetic-1",
  canonicalUrl: "https://www.liepin.com/job/1.shtml",
  title: "合成职位",
  company: "合成公司",
  location: "上海",
  salary: "20-30k",
  experience: "3年",
  education: "本科",
  cardText: "",
  status: "discovered",
  firstSeenAt: "2026-01-01T00:00:00.000Z",
  lastSeenAt: "2026-01-01T00:00:00.000Z"
};

const event = (
  kind: OpportunityEvent["kind"],
  createdAt: string,
  payload: Record<string, unknown> = {}
): OpportunityEvent => ({
  id: crypto.randomUUID(),
  opportunityId: initial.id,
  kind,
  version: 1,
  actor: kind === "evaluation_completed" ? "model" : "system",
  payload,
  createdAt
});

describe("opportunity projection", () => {
  it("replays ordered events through one reducer", () => {
    const result = projectOpportunity(initial, [
      event("generation_completed", "2026-01-01T00:00:04.000Z"),
      event("evaluation_completed", "2026-01-01T00:00:03.000Z", { outcome: "proceed" }),
      event("details_captured", "2026-01-01T00:00:02.000Z")
    ]);
    expect(result.status).toBe("draft_ready");
    expect(result.lastSeenAt).toBe("2026-01-01T00:00:04.000Z");
  });

  it("preserves the original exclusion while a user override changes the projection", () => {
    const result = projectOpportunity(initial, [
      event("evaluation_completed", "2026-01-01T00:00:01.000Z", { outcome: "exclude", reason: "核心方向冲突" }),
      { ...event("user_override", "2026-01-01T00:00:02.000Z"), actor: "user" }
    ]);
    expect(result.status).toBe("generating");
    expect(result.latestReason).toBe("核心方向冲突");
  });

  it("offers exception continuation only for excluded projections", () => {
    expect(canContinueAsException("model_excluded")).toBe(true);
    expect(canContinueAsException("deterministic_excluded")).toBe(true);
    expect(canContinueAsException("user_excluded")).toBe(true);
    expect(canContinueAsException("review_required")).toBe(false);
    expect(canContinueAsException("draft_ready")).toBe(false);
  });

  it("projects deterministic reasons and JD evidence from event payloads", () => {
    const events = [event("deterministic_excluded", "2026-01-01T00:00:01.000Z", {
      filter: {
        outcome: "exclude",
        decisions: [{
          ruleId: "travel_mobility",
          reason: "职位要求长期出差",
          evidence: [{ text: "需要长期出差", start: 0, end: 6 }]
        }]
      }
    })];
    expect(projectRuleEvidence(events)).toEqual([{
      ruleId: "travel_mobility",
      reason: "职位要求长期出差",
      evidence: ["需要长期出差"]
    }]);
  });
});

describe("reviewed delivery projection", () => {
  const delivery: DeliveryRecord = {
    opportunityId: initial.id,
    platform: "liepin",
    platformJobId: initial.platformJobId,
    resumeMode: "platform_default",
    overallStatus: "ready",
    applicationStatus: "pending",
    greetingStatus: "pending",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };

  it("derives complete only from independent application and greeting evidence", () => {
    expect(deriveDeliveryOverallStatus("verified", "verified")).toBe("succeeded");
    expect(deriveDeliveryOverallStatus("verified", "attempted")).toBe("partial");
    expect(deriveDeliveryOverallStatus("attempted", "verified")).toBe("partial");
    expect(deriveDeliveryOverallStatus("attempted", "attempted")).toBe("in_progress");
    expect(deriveDeliveryOverallStatus("failed", "pending")).toBe("failed");
  });

  it("does not replay an already verified component", () => {
    const verified = applyDeliveryPatch(delivery, { applicationStatus: "verified" }, "2026-01-01T00:00:01.000Z");
    const replayed = applyDeliveryPatch(verified, { applicationStatus: "attempted", greetingStatus: "verified" }, "2026-01-01T00:00:02.000Z");
    expect(replayed.applicationStatus).toBe("verified");
    expect(replayed.greetingStatus).toBe("verified");
    expect(replayed.overallStatus).toBe("succeeded");
  });

  it("allows an explicitly reviewed retry to move a failed component back to attempted", () => {
    const failed = applyDeliveryPatch(delivery, { greetingStatus: "failed" }, "2026-01-01T00:00:01.000Z");
    const retried = applyDeliveryPatch(failed, { greetingStatus: "attempted" }, "2026-01-01T00:00:02.000Z");
    expect(retried.greetingStatus).toBe("attempted");
    expect(retried.overallStatus).toBe("in_progress");
  });

  it("names the unverified component in a partial delivery reason", () => {
    const partial: DeliveryRecord = {
      ...delivery,
      overallStatus: "partial",
      applicationStatus: "attempted",
      greetingStatus: "verified",
      latestReason: "招呼语已从猎聘页面验证"
    };

    expect(deliveryPartialReason(partial)).toBe(
      "正式投递已尝试，尚未取得独立平台证据；招呼语已从猎聘页面验证"
    );
  });
});
