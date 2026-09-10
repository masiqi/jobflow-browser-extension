import { describe, expect, it } from "vitest";
import { completeCurrentItem, createBatchRun, isAutomaticallyTerminal } from "../src/domain/batch";
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
    const run = createBatchRun(preview, ["2", "1"], "2026-01-01T00:00:00.000Z", "run-1");
    expect(run.items.map((item) => item.candidate.jobId)).toEqual(["1", "2"]);
    expect(run.status).toBe("running");
    expect(() => createBatchRun(preview, [], "2026-01-01T00:00:00.000Z", "run-2")).toThrow();
  });

  it("advances counts and completes the final item", () => {
    const run = createBatchRun(preview, ["1", "2"], "2026-01-01T00:00:00.000Z", "run-1");
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
});
