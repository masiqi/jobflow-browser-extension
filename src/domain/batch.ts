import type { BatchItem, BatchRun, ExecutionPolicy, ScanPreview } from "./types";

type RandomValuesProvider = (array: Uint32Array) => void;

export function secureRandomIntegerInRange(
  min: number,
  max: number,
  randomValues: RandomValuesProvider = (target) => crypto.getRandomValues(target)
): number {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 5 || max > 600 || min > max) {
    throw new Error("随机间隔必须是 5 到 600 秒之间的整数，且最小值不能大于最大值");
  }
  const range = max - min + 1;
  const array = new Uint32Array(1);
  const uint32Space = 0x1_0000_0000;
  const maxUnbiased = uint32Space - (uint32Space % range);
  do {
    randomValues(array);
  } while ((array[0] ?? 0) >= maxUnbiased);
  return min + (array[0] ?? 0) % range;
}

function assertAutomaticRun(run: BatchRun): void {
  if (run.executionPolicy !== "automatic_send") throw new Error("delivery transition requires automatic_send run");
}

function assertAutomaticRunning(run: BatchRun): void {
  assertAutomaticRun(run);
  if (run.status !== "running") throw new Error("delivery transition requires a running batch");
}

function clearBlockFields(item: BatchItem): void {
  item.blockerPhase = undefined;
  item.blockerCode = undefined;
  item.error = undefined;
}

export function createBatchRun(
  preview: ScanPreview,
  selectedJobIds: string[],
  createdAt: string,
  id: string,
  executionPolicy: ExecutionPolicy
): BatchRun {
  const selected = new Set(selectedJobIds);
  const candidates = preview.candidates.filter((candidate) => selected.has(candidate.jobId));
  if (!candidates.length) throw new Error("请选择至少一个新职位");
  return {
    id,
    platform: "liepin",
    status: "running",
    sourceUrl: preview.sourceUrl,
    executionPolicy,
    authorizedAt: createdAt,
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
    failedCount: 0,
    deliverySucceededCount: 0,
    deliveryPartialCount: 0
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

export function startDeliveryWait(run: BatchRun, nextWriteEligibleAt: string, updatedAt: string): BatchRun {
  assertAutomaticRunning(run);
  const next = structuredClone(run);
  const item = next.items[next.currentIndex];
  if (!item) throw new Error("当前批次项目不存在");
  if (item.status !== "delivery_ready" && item.status !== "waiting_interval" && item.status !== "delivery_preflighting") {
    throw new Error("delivery wait requires delivery_ready item");
  }
  item.status = "waiting_interval";
  clearBlockFields(item);
  next.nextWriteEligibleAt = nextWriteEligibleAt;
  next.pauseReason = undefined;
  next.updatedAt = updatedAt;
  return next;
}

export function pauseCurrentItemBeforeWrite(
  run: BatchRun,
  blockerCode: string,
  reason: string,
  updatedAt: string
): BatchRun {
  assertAutomaticRunning(run);
  const next = structuredClone(run);
  const item = next.items[next.currentIndex];
  if (!item) throw new Error("当前批次项目不存在");
  if (!["opening", "extracting", "delivery_ready", "waiting_interval", "delivery_preflighting"].includes(item.status)) {
    throw new Error("pre-write pause requires delivery_ready, waiting_interval, or delivery_preflighting item");
  }
  item.status = "blocked";
  item.blockerPhase = "pre_write";
  item.blockerCode = blockerCode;
  item.error = reason;
  item.finishedAt = updatedAt;
  next.status = "paused";
  next.pauseReason = reason;
  next.updatedAt = updatedAt;
  return next;
}

export function completeDeliveryPartialAndPause(
  run: BatchRun,
  blockerCode: string,
  reason: string,
  updatedAt: string
): BatchRun {
  assertAutomaticRun(run);
  const next = structuredClone(run);
  const item = next.items[next.currentIndex];
  if (!item) throw new Error("当前批次项目不存在");
  if (item.status !== "delivery_in_progress") {
    throw new Error("post-write partial requires delivery_in_progress item");
  }
  item.status = "delivery_partial";
  item.blockerPhase = "post_write";
  item.blockerCode = blockerCode;
  item.error = reason;
  item.finishedAt = updatedAt;
  item.tabId = undefined;
  item.leaseId = undefined;
  next.currentIndex += 1;
  next.status = run.status === "cancelled" ? "cancelled" : "paused";
  next.pauseReason = reason;
  next.deliveryPartialCount += 1;
  next.nextWriteEligibleAt = undefined;
  next.updatedAt = updatedAt;
  return next;
}

export function completeDeliverySucceeded(run: BatchRun, updatedAt: string): BatchRun {
  assertAutomaticRun(run);
  const next = structuredClone(run);
  const item = next.items[next.currentIndex];
  if (!item) throw new Error("当前批次项目不存在");
  if (item.status !== "delivery_in_progress") {
    throw new Error("delivery success requires delivery_in_progress item");
  }
  item.status = "delivery_succeeded";
  clearBlockFields(item);
  item.finishedAt = updatedAt;
  item.tabId = undefined;
  item.leaseId = undefined;
  next.currentIndex += 1;
  next.deliverySucceededCount += 1;
  if (run.status === "running") next.pauseReason = undefined;
  next.nextWriteEligibleAt = undefined;
  next.updatedAt = updatedAt;
  if (run.status === "running" && next.currentIndex >= next.items.length) next.status = "completed";
  else next.status = run.status;
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
