import {
  CirclePause,
  CirclePlay,
  ExternalLink,
  RefreshCw,
  ScanSearch,
  Settings,
  Square,
  createElement
} from "lucide";
import { escapeHtml, sendCommand } from "./ui/command";
import { deliveryDisplayReason, recordStatusLabel } from "./ui/delivery";
import {
  LIEPIN_DETAIL_NAVIGATION_DELAY_MAX_SECONDS,
  LIEPIN_DETAIL_NAVIGATION_DELAY_MIN_SECONDS,
  LIEPIN_DETAIL_MIN_DWELL_SECONDS
} from "./defaults";
import type { AppState, BatchRun, DeliveryRecord, OpportunityRecord, ScanPreview } from "./types";

type ScanFeedback = {
  kind: "idle" | "progress" | "success" | "error";
  message: string;
};

const BATCH_STATUS_LABELS: Record<BatchRun["status"], string> = {
  queued: "等待开始",
  running: "处理中",
  paused: "已暂停",
  completed: "已完成",
  cancelled: "已取消",
  failed: "批次失败"
};

const ITEM_STATUS_LABELS: Record<BatchRun["items"][number]["status"], string> = {
  queued: "等待处理",
  opening: "正在打开职位详情",
  extracting: "正在读取职位详情",
  evaluating: "正在调用模型评估",
  generating: "正在生成招呼语",
  draft_ready: "草稿已生成",
  delivery_ready: "等待投递",
  waiting_navigation: "等待详情访问间隔",
  waiting_interval: "等待随机间隔",
  delivery_preflighting: "投递前检查",
  delivery_in_progress: "正在真实投递",
  delivery_succeeded: "投递并打招呼完成",
  delivery_partial: "投递结果需复核",
  blocked: "批次已阻塞",
  excluded: "已排除",
  review_required: "需要人工复核",
  failed: "处理失败"
};

const POLICY_LABELS: Record<AppState["settings"]["executionPolicy"], { title: string; note: string; button: string }> = {
  draft_only: {
    title: "仅生成",
    note: "本批只生成草稿，不执行猎聘真实写入",
    button: "开始生成"
  },
  reviewed_send: {
    title: "逐条确认",
    note: "本批只生成草稿，后续在管理台逐条确认",
    button: "开始生成"
  },
  automatic_send: {
    title: "自动投递",
    note: "匹配职位将自动投递并打招呼 · 详情访问间隔 "
      + LIEPIN_DETAIL_NAVIGATION_DELAY_MIN_SECONDS + "-" + LIEPIN_DETAIL_NAVIGATION_DELAY_MAX_SECONDS
      + " 秒 · 最短停留 " + LIEPIN_DETAIL_MIN_DWELL_SECONDS + " 秒",
    button: "一键投递并打招呼"
  }
};

const appElement = document.querySelector<HTMLDivElement>("#app");
if (!appElement) throw new Error("侧边栏根节点不存在");
const app: HTMLDivElement = appElement;
let scanBusy = false;
let startBusy = false;
let refreshBusy = false;
let scanFeedback: ScanFeedback = { kind: "idle", message: "" };
let selectedJobIds: Set<string> | null = null;
let selectedSourceUrl = "";
let waitCountdownTimer: number | null = null;

function iconButton(
  id: string,
  label: string,
  icon: Parameters<typeof createElement>[0],
  disabled = false
): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.className = "icon-button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.disabled = disabled;
  button.append(createElement(icon, { width: 18, height: 18, "stroke-width": 2 }));
  return button;
}

function scanButton(disabled: boolean): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = "scan";
  button.type = "button";
  button.className = "primary scan-button";
  button.title = "扫描当前猎聘页面";
  button.setAttribute("aria-label", "扫描当前猎聘页面");
  button.setAttribute("aria-busy", String(scanBusy));
  button.dataset.busy = String(scanBusy);
  button.disabled = disabled || scanBusy;
  button.append(
    createElement(ScanSearch, { width: 17, height: 17, "stroke-width": 2 }),
    Object.assign(document.createElement("span"), {
      textContent: scanBusy ? "正在扫描" : "扫描当前页"
    })
  );
  return button;
}

function selectedJobsForState(preview: ScanPreview | null, run: BatchRun | null): Set<string> {
  if (!preview) {
    selectedJobIds = null;
    selectedSourceUrl = "";
    return new Set();
  }
  if (!selectedJobIds || selectedSourceUrl !== preview.sourceUrl) {
    const runSelection = run?.sourceUrl === preview.sourceUrl
      ? run.items.map((item) => item.candidate.jobId)
      : null;
    selectedJobIds = new Set(runSelection ?? preview.selectedJobIds);
    selectedSourceUrl = preview.sourceUrl;
  }
  return selectedJobIds;
}

function resetSelectedJobs(preview: ScanPreview): void {
  selectedJobIds = new Set(preview.selectedJobIds);
  selectedSourceUrl = preview.sourceUrl;
}

function previewMarkup(preview: ScanPreview | null, selectedJobs: Set<string>): string {
  if (!preview) return '<p class="empty">扫描当前猎聘结果页后，可选择新职位生成草稿。</p>';
  const processableJobIds = new Set(preview.processableJobIds);
  const selectedProcessableCount = [...processableJobIds].filter((jobId) => selectedJobs.has(jobId)).length;
  const allProcessableSelected = processableJobIds.size > 0 && selectedProcessableCount === processableJobIds.size;
  return [
    '<div class="metrics">',
    '<div><strong>' + preview.observedCount + '</strong><span>已发现</span></div>',
    '<div><strong>' + preview.newCount + '</strong><span>新职位</span></div>',
    '<div><strong>' + preview.duplicateCount + '</strong><span>重复</span></div>',
    '<div><strong>' + preview.draftedCount + '</strong><span>已有草稿</span></div>',
    '</div>',
    preview.candidates.length
      ? '<div class="candidate-toolbar"><label class="select-all"><input id="selectAll" type="checkbox" aria-label="全选可处理职位" '
        + (allProcessableSelected ? "checked" : "") + (processableJobIds.size ? "" : " disabled")
        + '><span>全选可处理职位</span></label><small>可处理 ' + String(processableJobIds.size) + ' 个</small></div><div class="candidate-list">'
      : '<p class="scan-empty">当前页面未识别到职位，页面仍在加载时可稍后重试。</p>',
    preview.candidates.map((candidate) => {
      const selected = selectedJobs.has(candidate.jobId);
      const processable = processableJobIds.has(candidate.jobId);
      return '<label class="candidate ' + (processable ? "" : "disabled") + '"><input type="checkbox" data-job-id="' + escapeHtml(candidate.jobId)
        + '" ' + (selected ? "checked" : "") + " " + (processable ? "" : "disabled") + '><span><b>' + escapeHtml(candidate.title)
        + '</b><small>' + escapeHtml(candidate.company) + " · " + escapeHtml(candidate.salary)
        + '</small></span></label>';
    }).join(""),
    preview.candidates.length ? '</div>' : ""
  ].join("");
}

function runMarkup(run: BatchRun | null, deliveries: DeliveryRecord[] = []): string {
  if (!run) return '<p class="empty">尚未运行批次。</p>';
  const failures = run.items.filter((item) => item.status === "failed" && item.error);
  const currentItem = run.items[run.currentIndex];
  const partialItem = run.items
    .slice(0, run.currentIndex)
    .reverse()
    .find((item) => item.status === "delivery_partial" && item.opportunityId);
  const partialDelivery = partialItem?.opportunityId
    ? deliveries.find((delivery) => delivery.opportunityId === partialItem.opportunityId)
    : undefined;
  const pauseReason = deliveryDisplayReason(partialDelivery) ?? run.pauseReason;
  const nextActionEligibleAt = run.nextNavigationEligibleAt ?? run.nextWriteEligibleAt;
  const waitSeconds = nextActionEligibleAt
    ? Math.max(0, Math.ceil((new Date(nextActionEligibleAt).getTime() - Date.now()) / 1000))
    : null;
  return [
    '<div class="run"><div class="progress"><span style="width:',
    String(Math.round(run.currentIndex / Math.max(1, run.items.length) * 100)),
    '%"></span></div><p><b>', escapeHtml(BATCH_STATUS_LABELS[run.status]), "</b> · ",
    String(run.currentIndex), "/", String(run.items.length),
    '</p><small>草稿 ', String(run.draftCount), " · 排除 ", String(run.excludedCount),
    " · 复核 ", String(run.reviewCount), " · 失败 ", String(run.failedCount),
    " · 已投递 ", String(run.deliverySucceededCount), " · 待复核投递 ", String(run.deliveryPartialCount), "</small>",
    pauseReason ? '<p class="run-pause-reason">暂停原因：' + escapeHtml(pauseReason) + "</p>" : "",
    waitSeconds !== null && nextActionEligibleAt
      ? '<p class="run-wait" aria-live="polite">距离下一次'
        + (run.nextNavigationEligibleAt ? "职位详情访问" : " JobFlow 投递")
        + '约 <span data-next-action-at="' + escapeHtml(nextActionEligibleAt) + '">' + String(waitSeconds) + "</span> 秒</p>"
      : "",
    currentItem ? '<div class="run-current"><b>' + escapeHtml(currentItem.candidate.title) + '</b><span>'
      + escapeHtml(ITEM_STATUS_LABELS[currentItem.status]) + "</span></div>" : "",
    failures.length ? '<div class="run-failures">' + failures.map((item) =>
      '<div class="run-failure"><b>' + escapeHtml(item.candidate.title) + '</b><span>'
      + escapeHtml(item.error) + "</span></div>"
    ).join("") + "</div>" : "",
    "</div>"
  ].join("");
}

function clearWaitCountdownTimer(): void {
  if (waitCountdownTimer !== null) {
    window.clearInterval(waitCountdownTimer);
    waitCountdownTimer = null;
  }
}

function updateWaitCountdownText(): void {
  const countdown = document.querySelector<HTMLElement>("[data-next-action-at]");
  if (!countdown) {
    clearWaitCountdownTimer();
    return;
  }
  const waitUntil = new Date(countdown.dataset.nextActionAt || "").getTime();
  if (!Number.isFinite(waitUntil)) {
    clearWaitCountdownTimer();
    return;
  }
  countdown.textContent = String(Math.max(0, Math.ceil((waitUntil - Date.now()) / 1000)));
}

function configureWaitCountdownTimer(): void {
  clearWaitCountdownTimer();
  if (!document.querySelector("[data-next-action-at]")) return;
  updateWaitCountdownText();
  waitCountdownTimer = window.setInterval(updateWaitCountdownText, 1000);
}

function recordsMarkup(records: OpportunityRecord[], deliveries: DeliveryRecord[]): string {
  return records.slice(0, 8).map((record) => {
    const delivery = deliveries.find((item) => item.opportunityId === record.id);
    const latestReason = deliveryDisplayReason(delivery) ?? record.latestReason;
    return '<div class="record"><span class="status ' + escapeHtml(delivery?.overallStatus ?? record.status) + '"></span><div><b>'
    + escapeHtml(record.title) + '</b><small>' + escapeHtml(record.company) + " · "
    + escapeHtml(recordStatusLabel(record, delivery)) + '</small>'
    + (latestReason ? '<small class="record-reason">原因：' + escapeHtml(latestReason) + "</small>" : "")
    + "</div></div>";
  }).join("") || '<p class="empty">暂无职位记录。</p>';
}

async function render(stateOverride?: AppState): Promise<void> {
  let state: AppState;
  if (stateOverride) {
    state = stateOverride;
  } else {
    try {
      state = await sendCommand<AppState>({ type: "GET_APP_STATE" });
    } catch (error) {
      app.innerHTML = '<div class="error">' + escapeHtml(error instanceof Error ? error.message : error) + "</div>";
      return;
    }
  }
  const run = state.run;
  const selectedJobs = selectedJobsForState(state.scanPreview, run);
  const selectedCount = selectedProcessableCount(state.scanPreview, selectedJobs);
  const batchActive = run?.status === "running" || run?.status === "paused" || run?.status === "queued";
  const selectionReady = selectedCount > 0
    && !batchActive
    && !startBusy;
  const policy = POLICY_LABELS[state.settings.executionPolicy];
  const delayRange = state.settings.automaticSendDelayMinSeconds + "-" + state.settings.automaticSendDelayMaxSeconds + " 秒";
  const startLabel = state.settings.executionPolicy === "automatic_send" && !batchActive
    ? policy.button + " " + selectedCount + " 个职位"
    : batchActive ? "批次进行中" : policy.button;
  app.innerHTML = [
    '<header><div><h1>JobFlow</h1><p>',
    state.auth.status === "signed_in"
      ? escapeHtml(state.auth.email) + (state.auth.vip ? " · VIP" : "")
      : "未登录",
    '</p><small>' + escapeHtml(state.settings.model.route.toUpperCase()) + " · "
      + escapeHtml(state.settings.model.provider) + " / " + escapeHtml(state.settings.model.model)
      + '</small></div><div id="header-actions"></div></header>',
    '<section class="status-band policy-' + escapeHtml(state.settings.executionPolicy) + '"><span class="dot"></span><div><b>' + escapeHtml(policy.title)
      + '</b><small>' + escapeHtml(policy.note)
      + (state.settings.executionPolicy === "automatic_send" ? " · 随机间隔 " + escapeHtml(delayRange) : "")
      + '</small></div></section>',
    '<section><div class="section-title"><h2>当前结果</h2><div id="scan-actions"></div></div>',
    '<div id="scanStatus" class="scan-status ' + escapeHtml(scanFeedback.kind)
      + '" role="status" aria-live="polite">' + escapeHtml(scanFeedback.message) + "</div>",
    previewMarkup(state.scanPreview, selectedJobs),
    '<div class="batch-row"><div class="batch-start"><small id="selectionSummary">已选 ', String(selectedCount), '</small><button id="start" class="primary '
    + (state.settings.executionPolicy === "automatic_send" ? "automatic-action" : "") + '" type="button"',
    selectionReady ? "" : " disabled",
    ' aria-busy="' + String(startBusy) + '">',
    escapeHtml(startBusy ? "正在启动" : startLabel), "</button></div></div></section>",
    '<section><div class="section-title"><h2>批次</h2><div id="run-actions"></div></div>',
    runMarkup(run, state.deliveries),
    '</section>',
    '<section><div class="section-title"><h2>最近记录</h2><button id="viewAll" class="link-button" type="button">查看全部</button></div>',
    '<div class="records">', recordsMarkup(state.opportunities, state.deliveries),
    '</div></section>',
    '<div id="toast" role="status" aria-live="polite"></div>'
  ].join("");

  const headerActions = document.querySelector("#header-actions");
  headerActions?.append(iconButton("settings", "打开管理台", Settings));
  const scanActions = document.querySelector("#scan-actions");
  scanActions?.append(scanButton(state.auth.status !== "signed_in"));
  const refresh = iconButton("refresh", refreshBusy ? "正在刷新状态" : "刷新状态", RefreshCw, refreshBusy || scanBusy);
  refresh.setAttribute("aria-busy", String(refreshBusy));
  refresh.dataset.busy = String(refreshBusy);
  scanActions?.append(refresh);
  const runActions = document.querySelector("#run-actions");
  runActions?.append(iconButton("pause", "暂停批次", CirclePause, run?.status !== "running"));
  runActions?.append(iconButton("resume", "继续批次", CirclePlay, run?.status !== "paused"));
  runActions?.append(iconButton("cancel", "取消批次", Square, !run || ["completed", "cancelled"].includes(run.status)));

  document.querySelector("#settings")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
  document.querySelector("#viewAll")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
  document.querySelector("#refresh")?.addEventListener("click", () => void refreshState());
  document.querySelector("#scan")?.addEventListener("click", () => void scanCurrentPage());
  document.querySelector("#pause")?.addEventListener("click", () => void perform({ type: "PAUSE_BATCH" }));
  document.querySelector("#resume")?.addEventListener("click", () => void perform({ type: "RESUME_BATCH" }));
  document.querySelector("#cancel")?.addEventListener("click", () => void perform({ type: "CANCEL_BATCH" }));
  document.querySelectorAll<HTMLInputElement>("[data-job-id]").forEach((input) => {
    input.addEventListener("change", () => {
      const jobId = input.dataset.jobId;
      if (!jobId || !selectedJobIds) return;
      if (input.checked) selectedJobIds.add(jobId);
      else selectedJobIds.delete(jobId);
      updateSelectionControls(state.scanPreview, batchActive);
    });
  });
  document.querySelector("#selectAll")?.addEventListener("change", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    toggleAllProcessableJobs(state.scanPreview, input.checked);
    updateSelectionControls(state.scanPreview, batchActive);
  });
  document.querySelector("#start")?.addEventListener("click", () => {
    const candidateIds = state.scanPreview?.candidates.map((candidate) => candidate.jobId) ?? [];
    const selected = candidateIds.filter((jobId) => selectedJobIds?.has(jobId));
    void startBatchFromPanel({
      type: "START_BATCH",
      selectedJobIds: selected,
      expectedExecutionPolicy: state.settings.executionPolicy
    }, state.scanPreview, batchActive);
  });
  syncSelectAllControl(state.scanPreview, selectedJobs);
  configureWaitCountdownTimer();
}

function selectedProcessableCount(preview: ScanPreview | null, selectedJobs: Set<string>): number {
  if (!preview) return 0;
  const processableJobIds = new Set(preview.processableJobIds);
  return [...selectedJobs].filter((jobId) => processableJobIds.has(jobId)).length;
}

function toggleAllProcessableJobs(preview: ScanPreview | null, checked: boolean): void {
  if (!preview || !selectedJobIds) return;
  for (const jobId of preview.processableJobIds) {
    if (checked) selectedJobIds.add(jobId);
    else selectedJobIds.delete(jobId);
  }
}

function syncSelectAllControl(preview: ScanPreview | null, selectedJobs: Set<string>): void {
  const control = document.querySelector<HTMLInputElement>("#selectAll");
  if (!control || !preview) return;
  const processableJobIds = new Set(preview.processableJobIds);
  const selectedProcessableCount = [...processableJobIds].filter((jobId) => selectedJobs.has(jobId)).length;
  control.checked = processableJobIds.size > 0 && selectedProcessableCount === processableJobIds.size;
  control.indeterminate = selectedProcessableCount > 0 && selectedProcessableCount < processableJobIds.size;
  control.disabled = processableJobIds.size === 0;
}

function syncCandidateControls(selectedJobs: Set<string>): void {
  document.querySelectorAll<HTMLInputElement>("[data-job-id]").forEach((input) => {
    const jobId = input.dataset.jobId;
    if (jobId) input.checked = selectedJobs.has(jobId);
  });
}

function updateSelectionControls(preview: ScanPreview | null, batchActive: boolean): void {
  const count = selectedProcessableCount(preview, selectedJobIds ?? new Set());
  const summary = document.querySelector<HTMLElement>("#selectionSummary");
  const start = document.querySelector<HTMLButtonElement>("#start");
  if (summary) summary.textContent = "已选 " + count;
  if (start) start.disabled = startBusy || batchActive || count === 0;
  const selectedJobs = selectedJobIds ?? new Set();
  syncCandidateControls(selectedJobs);
  syncSelectAllControl(preview, selectedJobs);
}

function updateStartBusy(busy: boolean): void {
  startBusy = busy;
  const start = document.querySelector<HTMLButtonElement>("#start");
  if (!start) return;
  start.disabled = busy || start.disabled;
  start.setAttribute("aria-busy", String(busy));
  if (busy) start.textContent = "正在启动";
}

function updateScanFeedback(feedback: ScanFeedback, busy: boolean): void {
  scanFeedback = feedback;
  scanBusy = busy;
  const status = document.querySelector<HTMLElement>("#scanStatus");
  const button = document.querySelector<HTMLButtonElement>("#scan");
  if (status) {
    status.textContent = feedback.message;
    status.className = "scan-status " + feedback.kind;
  }
  if (button) {
    button.disabled = busy;
    button.setAttribute("aria-busy", String(busy));
    button.dataset.busy = String(busy);
    const label = button.querySelector("span");
    if (label) label.textContent = busy ? "正在扫描" : "扫描当前页";
  }
  updateRefreshControl();
}

function updateRefreshControl(): void {
  const button = document.querySelector<HTMLButtonElement>("#refresh");
  if (!button) return;
  const label = refreshBusy ? "正在刷新状态" : "刷新状态";
  button.disabled = refreshBusy || scanBusy;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-busy", String(refreshBusy));
  button.dataset.busy = String(refreshBusy);
}

async function refreshState(): Promise<void> {
  if (refreshBusy || scanBusy) return;
  refreshBusy = true;
  updateRefreshControl();
  updateScanFeedback({ kind: "progress", message: "正在刷新状态" }, false);
  try {
    const state = await sendCommand<AppState>({ type: "GET_APP_STATE" });
    refreshBusy = false;
    scanFeedback = { kind: "success", message: "状态已刷新" };
    await render(state);
  } catch (error) {
    refreshBusy = false;
    updateRefreshControl();
    updateScanFeedback({
      kind: "error",
      message: error instanceof Error ? error.message : String(error)
    }, false);
  }
}

async function scanCurrentPage(): Promise<void> {
  if (scanBusy) return;
  updateScanFeedback({ kind: "progress", message: "正在扫描当前页已加载的职位" }, true);
  try {
    const preview = await sendCommand<ScanPreview>({ type: "SCAN_CURRENT_TAB" });
    resetSelectedJobs(preview);
    await render();
    updateScanFeedback({
      kind: "success",
      message: preview.observedCount > 0
        ? "扫描完成，发现 " + preview.observedCount + " 个职位"
        : "扫描完成，当前页面未识别到职位"
    }, false);
  } catch (error) {
    updateScanFeedback({
      kind: "error",
      message: error instanceof Error ? error.message : String(error)
    }, false);
  }
}

async function perform(request: Parameters<typeof sendCommand>[0]): Promise<void> {
  const toast = document.querySelector<HTMLElement>("#toast");
  try {
    await sendCommand(request);
    await render();
  } catch (error) {
    if (toast) toast.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function startBatchFromPanel(
  request: Parameters<typeof sendCommand>[0],
  preview: ScanPreview | null,
  batchActive: boolean
): Promise<void> {
  if (startBusy) return;
  const toast = document.querySelector<HTMLElement>("#toast");
  updateStartBusy(true);
  try {
    await sendCommand(request);
    startBusy = false;
    await render();
  } catch (error) {
    startBusy = false;
    updateStartBusy(false);
    updateSelectionControls(preview, batchActive);
    if (toast) toast.textContent = error instanceof Error ? error.message : String(error);
  }
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (message && typeof message === "object" && (message as { type?: unknown }).type === "RUN_UPDATED") {
    void render();
  }
});

void render();
