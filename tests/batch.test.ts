import { describe, expect, it } from "vitest";
import {
  completeCurrentItem,
  completeDeliveryPartialAndPause,
  completeDeliverySucceeded,
  createBatchRun,
  pauseCurrentItemBeforeWrite,
  secureRandomIntegerInRange,
  startDeliveryWait,
  isAutomaticallyTerminal
} from "../src/domain/batch";
import type { ListCandidate, ScanPreview } from "../src/types";

const candidate = (jobId: string): ListCandidate => ({
  platform: "liepin",
  jobId,
  url: "https://www.liepin.com/job/" + jobId + ".shtml",
  canonicalUrl: "https://www.liepin.com/job/" + jobId + ".shtml",
  title: "合成职位 " + jobId,
  company: "合成公司",
  location: "北京",
  salary: "20-30k",
  experience: "3年",
  education: "本科",
  cardText: "",
  index: Number(jobId)
});

const preview: ScanPreview = {
  sourceUrl: "https://www.liepin.com/zhaopin/",
  candidates: [candidate("1"), candidate("2"), candidate("3")],
  observedCount: 3,
  newCount: 3,
  duplicateCount: 0,
  excludedCount: 0,
  draftedCount: 0,
  processableJobIds: ["1", "2", "3"],
  selectedJobIds: ["1", "2"]
};

describe("batch state", () => {
  it("creates a batch only from explicitly selected jobs in DOM order", () => {
    const run = createBatchRun(preview, ["2", "1"], "2026-01-01T00:00:00.000Z", "run-1", "automatic_send");
    expect(run.items.map((item) => item.candidate.jobId)).toEqual(["1", "2"]);
    expect(run.status).toBe("running");
    expect(run.executionPolicy).toBe("automatic_send");
    expect(run.authorizedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(run.deliverySucceededCount).toBe(0);
    expect(() => createBatchRun(preview, [], "2026-01-01T00:00:00.000Z", "run-2", "reviewed_send")).toThrow();
  });

  it("advances counts and completes the final item", () => {
    const run = createBatchRun(preview, ["1", "2"], "2026-01-01T00:00:00.000Z", "run-1", "reviewed_send");
    const first = completeCurrentItem(run, "review_required", "2026-01-01T00:01:00.000Z");
    expect(first).toMatchObject({ currentIndex: 1, reviewCount: 1, status: "running" });
    const second = completeCurrentItem(first, "draft_ready", "2026-01-01T00:02:00.000Z");
    expect(second).toMatchObject({ currentIndex: 2, draftCount: 1, status: "completed" });
    expect(run.currentIndex).toBe(0);
  });

  it("does not automatically repeat terminal opportunity states", () => {
    for (const status of [
      "deterministic_excluded",
      "model_excluded",
      "review_required",
      "user_excluded",
      "draft_ready"
    ]) {
      expect(isAutomaticallyTerminal(status)).toBe(true);
    }
    expect(isAutomaticallyTerminal("discovered")).toBe(false);
    expect(isAutomaticallyTerminal("failed")).toBe(false);
  });

  it("pauses pre-write blockers without advancing and post-write partials after advancing", () => {
    const run = createBatchRun(preview, ["1", "2"], "2026-01-01T00:00:00.000Z", "run-1", "automatic_send");
    const ready = {
      ...run,
      items: run.items.map((item, index) => index === 0
        ? {
          ...item,
          status: "delivery_ready" as const,
          opportunityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          draftRevisionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          draftSha256: "c".repeat(64)
        }
        : item)
    };
    const preWrite = pauseCurrentItemBeforeWrite(ready, "login_required", "请先登录猎聘", "2026-01-01T00:00:10.000Z");
    expect(preWrite).toMatchObject({
      status: "paused",
      currentIndex: 0,
      pauseReason: "请先登录猎聘"
    });
    expect(preWrite.items[0]).toMatchObject({
      status: "blocked",
      blockerPhase: "pre_write",
      blockerCode: "login_required"
    });

    const inProgress = structuredClone(ready);
    inProgress.items[0]!.status = "delivery_in_progress";
    const partial = completeDeliveryPartialAndPause(inProgress, "write_result_unavailable", "写入结果需要复核", "2026-01-01T00:00:20.000Z");
    expect(partial).toMatchObject({
      status: "paused",
      currentIndex: 1,
      deliveryPartialCount: 1,
      pauseReason: "写入结果需要复核"
    });
    expect(partial.items[0]).toMatchObject({
      status: "delivery_partial",
      blockerPhase: "post_write",
      blockerCode: "write_result_unavailable"
    });
  });

  it("tracks delivery success and persisted wait stages", () => {
    const run = createBatchRun(preview, ["1"], "2026-01-01T00:00:00.000Z", "run-1", "automatic_send");
    run.items[0]!.status = "delivery_ready";
    const waiting = startDeliveryWait(run, "2026-01-01T00:00:17.000Z", "2026-01-01T00:00:01.000Z");
    expect(waiting.nextWriteEligibleAt).toBe("2026-01-01T00:00:17.000Z");
    expect(waiting.items[0]?.status).toBe("waiting_interval");
    waiting.items[0]!.status = "delivery_in_progress";
    const done = completeDeliverySucceeded(waiting, "2026-01-01T00:00:18.000Z");
    expect(done).toMatchObject({
      status: "completed",
      currentIndex: 1,
      deliverySucceededCount: 1
    });
    expect(done.items[0]?.status).toBe("delivery_succeeded");
  });

  it("rejects illegal automatic delivery transitions", () => {
    const automatic = createBatchRun(preview, ["1"], "2026-01-01T00:00:00.000Z", "run-1", "automatic_send");
    const reviewed = createBatchRun(preview, ["1"], "2026-01-01T00:00:00.000Z", "run-2", "reviewed_send");

    expect(() => startDeliveryWait(automatic, "2026-01-01T00:00:17.000Z", "2026-01-01T00:00:01.000Z"))
      .toThrow(/delivery_ready/);
    reviewed.items[0]!.status = "delivery_ready";
    expect(() => startDeliveryWait(reviewed, "2026-01-01T00:00:17.000Z", "2026-01-01T00:00:01.000Z"))
      .toThrow(/automatic_send/);
    automatic.items[0]!.status = "queued";
    expect(() => pauseCurrentItemBeforeWrite(automatic, "login_required", "请先登录", "2026-01-01T00:00:02.000Z"))
      .toThrow(/pre-write/);
    expect(() => completeDeliveryPartialAndPause(automatic, "ambiguous", "结果不明确", "2026-01-01T00:00:03.000Z"))
      .toThrow(/delivery_in_progress/);
    expect(() => completeDeliverySucceeded(automatic, "2026-01-01T00:00:04.000Z"))
      .toThrow(/delivery_in_progress/);
  });

  it("clears stale pause and blocker fields on successful delivery", () => {
    const run = createBatchRun(preview, ["1"], "2026-01-01T00:00:00.000Z", "run-1", "automatic_send");
    run.pauseReason = "旧阻塞原因";
    run.nextWriteEligibleAt = "2026-01-01T00:00:17.000Z";
    run.items[0] = {
      ...run.items[0]!,
      status: "delivery_in_progress",
      blockerPhase: "pre_write",
      blockerCode: "old_blocker",
      error: "旧错误"
    };

    const done = completeDeliverySucceeded(run, "2026-01-01T00:00:18.000Z");

    expect(done.pauseReason).toBeUndefined();
    expect(done.nextWriteEligibleAt).toBeUndefined();
    expect(done.items[0]).toMatchObject({ status: "delivery_succeeded" });
    expect(done.items[0]?.blockerPhase).toBeUndefined();
    expect(done.items[0]?.blockerCode).toBeUndefined();
    expect(done.items[0]?.error).toBeUndefined();
  });

  it("draws secure inclusive random integers without global mutable state", () => {
    expect(secureRandomIntegerInRange(10, 20, (array) => { array[0] = 0; })).toBe(10);
    expect(secureRandomIntegerInRange(10, 20, (array) => { array[0] = 10; })).toBe(20);
    expect(() => secureRandomIntegerInRange(20, 10)).toThrow();
  });

  it("uses rejection sampling instead of modulo bias", () => {
    const draws = [4_294_967_294, 9];
    const provider = (array: Uint32Array) => {
      array[0] = draws.shift() ?? 0;
    };

    expect(secureRandomIntegerInRange(5, 14, provider)).toBe(14);
    expect(draws).toHaveLength(0);
  });
});
