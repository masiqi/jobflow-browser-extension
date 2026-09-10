import type { BatchItem, BatchRun, ScanPreview } from "./types";

export function createBatchRun(
  preview: ScanPreview,
  selectedJobIds: string[],
  createdAt: string,
  id: string
): BatchRun {
  const selected = new Set(selectedJobIds);
  const candidates = preview.candidates.filter((candidate) => selected.has(candidate.jobId));
  if (!candidates.length) throw new Error("请选择至少一个新职位");
  return {
    id,
    platform: "liepin",
    status: "running",
    sourceUrl: preview.sourceUrl,
    createdAt,
    updatedAt: createdAt,
    currentIndex: 0,
    items: candidates.map((candidate): BatchItem => ({
      candidate,
      status: "queued",
      attempt: 0
    })),
    draftCount: 0,
    excludedCount: 0,
    reviewCount: 0,
    failedCount: 0
  };
}

export function completeCurrentItem(
  run: BatchRun,
  status: BatchItem["status"],
  finishedAt: string,
  error?: string
): BatchRun {
  const item = run.items[run.currentIndex];
  if (!item) throw new Error("当前批次项目不存在");
  const next = structuredClone(run);
  const nextItem = next.items[next.currentIndex];
  if (!nextItem) throw new Error("当前批次项目不存在");
  nextItem.status = status;
  nextItem.error = error;
  nextItem.finishedAt = finishedAt;
  nextItem.tabId = undefined;
  nextItem.leaseId = undefined;
  next.currentIndex += 1;
  next.updatedAt = finishedAt;
  if (status === "draft_ready") next.draftCount += 1;
  if (status === "excluded") next.excludedCount += 1;
  if (status === "review_required") next.reviewCount += 1;
  if (status === "failed") next.failedCount += 1;
  if (next.currentIndex >= next.items.length) next.status = "completed";
  return next;
}

export function isAutomaticallyTerminal(status: string): boolean {
  return [
    "deterministic_excluded",
    "model_excluded",
    "review_required",
    "user_excluded",
    "draft_ready"
  ].includes(status);
}
