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
import { recordStatusLabel } from "./ui/delivery";
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
    note: "匹配职位将自动投递并打招呼",
    button: "一键投递并打招呼"
  }
};

const appElement = document.querySelector<HTMLDivElement>("#app");
if (!appElement) throw new Error("侧边栏根节点不存在");
const app: HTMLDivElement = appElement;
let scanBusy = false;
let startBusy = false;
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
  return [
    '<div class="metrics">',
    '<div><strong>' + preview.observedCount + '</strong><span>已发现</span></div>',
    '<div><strong>' + preview.newCount + '</strong><span>新职位</span></div>',
    '<div><strong>' + preview.duplicateCount + '</strong><span>重复</span></div>',
    '<div><strong>' + preview.draftedCount + '</strong><span>已有草稿</span></div>',
    '</div>',
    preview.candidates.length
      ? '<div class="candidate-list">'
      : '<p class="scan-empty">当前页面未识别到职位，页面仍在加载时可稍后重试。</p>',
    preview.candidates.map((candidate) => {
      const selected = selectedJobs.has(candidate.jobId);
      const processable = preview.processableJobIds.includes(candidate.jobId);
      return '<label class="candidate ' + (processable ? "" : "disabled") + '"><input type="checkbox" data-job-id="' + escapeHtml(candidate.jobId)
        + '" ' + (selected ? "checked" : "") + " " + (processable ? "" : "disabled") + '><span><b>' + escapeHtml(candidate.title)
        + '</b><small>' + escapeHtml(candidate.company) + " · " + escapeHtml(candidate.salary)
        + '</small></span></label>';
    }).join(""),
    preview.candidates.length ? '</div>' : ""
  ].join("");
}

function runMarkup(run: BatchRun | null): string {
  if (!run) return '<p class="empty">尚未运行批次。</p>';
  const failures = run.items.filter((item) => item.status === "failed" && item.error);
  const currentItem = run.items[run.currentIndex];
  const waitSeconds = run.nextWriteEligibleAt
    ? Math.max(0, Math.ceil((new Date(run.nextWriteEligibleAt).getTime() - Date.now()) / 1000))
    : null;
  return [
    '<div class="run"><div class="progress"><span style="width:',
    String(Math.round(run.currentIndex / Math.max(1, run.items.length) * 100)),
    '%"></span></div><p><b>', escapeHtml(BATCH_STATUS_LABELS[run.status]), "</b> · ",
    String(run.currentIndex), "/", String(run.items.length),
    '</p><small>草稿 ', String(run.draftCount), " · 排除 ", String(run.excludedCount),
    " · 复核 ", String(run.reviewCount), " · 失败 ", String(run.failedCount),
    " · 已投递 ", String(run.deliverySucceededCount), " · 待复核投递 ", String(run.deliveryPartialCount), "</small>",
    run.pauseReason ? '<p class="run-pause-reason">暂停原因：' + escapeHtml(run.pauseReason) + "</p>" : "",
    waitSeconds !== null && run.nextWriteEligibleAt
      ? '<p class="run-wait" aria-live="polite">距离下一次 JobFlow 投递约 <span data-next-write-at="'
        + escapeHtml(run.nextWriteEligibleAt) + '">' + String(waitSeconds) + "</span> 秒</p>"
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
  const countdown = document.querySelector<HTMLElement>("[data-next-write-at]");
  if (!countdown) {
    clearWaitCountdownTimer();
    return;
  }
  const waitUntil = new Date(countdown.dataset.nextWriteAt || "").getTime();
  if (!Number.isFinite(waitUntil)) {
    clearWaitCountdownTimer();
    return;
  }
  countdown.textContent = String(Math.max(0, Math.ceil((waitUntil - Date.now()) / 1000)));
}

function configureWaitCountdownTimer(): void {
  clearWaitCountdownTimer();
  if (!document.querySelector("[data-next-write-at]")) return;
  updateWaitCountdownText();
  waitCountdownTimer = window.setInterval(updateWaitCountdownText, 1000);
}

function recordsMarkup(records: OpportunityRecord[], deliveries: DeliveryRecord[]): string {
  return records.slice(0, 8).map((record) => {
    const delivery = deliveries.find((item) => item.opportunityId === record.id);
    const latestReason = delivery?.latestReason ?? record.latestReason;
    return '<div class="record"><span class="status ' + escapeHtml(delivery?.overallStatus ?? record.status) + '"></span><div><b>'
    + escapeHtml(record.title) + '</b><small>' + escapeHtml(record.company) + " · "
    + escapeHtml(recordStatusLabel(record, delivery)) + '</small>'
    + (latestReason ? '<small class="record-reason">原因：' + escapeHtml(latestReason) + "</small>" : "")
    + "</div></div>";
  }).join("") || '<p class="empty">暂无职位记录。</p>';
}

async function render(): Promise<void> {
  let state: AppState;
  try {
    state = await sendCommand<AppState>({ type: "GET_APP_STATE" });
  } catch (error) {
    app.innerHTML = '<div class="error">' + escapeHtml(error instanceof Error ? error.message : error) + "</div>";
    return;
  }
  const run = state.run;
  const selectedJobs = selectedJobsForState(state.scanPreview, run);
  const selectedCount = selectedJobs.size;
  const batchActive = run?.status === "running" || run?.status === "paused" || run?.status === "queued";
  const selectionWithinLimit = selectedCount > 0
    && selectedCount <= state.settings.maxJobsPerBatch
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
    '<div class="batch-row"><label>本批上限<input id="batchLimit" type="number" min="1" max="20" value="',
    String(state.settings.maxJobsPerBatch),
    '"></label><div class="batch-start"><small id="selectionSummary">已选 ', String(selectedCount), " / 上限 ",
    String(state.settings.maxJobsPerBatch), '</small><button id="start" class="primary '
    + (state.settings.executionPolicy === "automatic_send" ? "automatic-action" : "") + '" type="button"',
    selectionWithinLimit ? "" : " disabled",
    ' aria-busy="' + String(startBusy) + '">',
    escapeHtml(startBusy ? "正在启动" : startLabel), "</button></div></div></section>",
    '<section><div class="section-title"><h2>批次</h2><div id="run-actions"></div></div>',
    runMarkup(run),
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
  scanActions?.append(iconButton("refresh", "刷新状态", RefreshCw));
  const runActions = document.querySelector("#run-actions");
  runActions?.append(iconButton("pause", "暂停批次", CirclePause, run?.status !== "running"));
  runActions?.append(iconButton("resume", "继续批次", CirclePlay, run?.status !== "paused"));
  runActions?.append(iconButton("cancel", "取消批次", Square, !run || ["completed", "cancelled"].includes(run.status)));

  document.querySelector("#settings")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
  document.querySelector("#viewAll")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
  document.querySelector("#refresh")?.addEventListener("click", () => void render());
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
      updateSelectionControls(state.settings.maxJobsPerBatch, batchActive);
    });
  });
  document.querySelector("#batchLimit")?.addEventListener("change", async (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const value = Math.max(1, Math.min(20, Number(input.value) || 10));
    await perform({
      type: "UPDATE_SETTINGS",
      settings: { ...state.settings, maxJobsPerBatch: value }
    });
  });
  document.querySelector("#start")?.addEventListener("click", () => {
    const candidateIds = state.scanPreview?.candidates.map((candidate) => candidate.jobId) ?? [];
    const selected = candidateIds.filter((jobId) => selectedJobIds?.has(jobId));
    void startBatchFromPanel({
      type: "START_BATCH",
      selectedJobIds: selected,
      expectedExecutionPolicy: state.settings.executionPolicy
    });
  });
  configureWaitCountdownTimer();
}

function updateSelectionControls(limit: number, batchActive: boolean): void {
  const count = selectedJobIds?.size ?? 0;
  const summary = document.querySelector<HTMLElement>("#selectionSummary");
  const start = document.querySelector<HTMLButtonElement>("#start");
  if (summary) summary.textContent = "已选 " + count + " / 上限 " + limit;
  if (start) start.disabled = startBusy || batchActive || count === 0 || count > limit;
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

async function startBatchFromPanel(request: Parameters<typeof sendCommand>[0]): Promise<void> {
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
    updateSelectionControls(
      Number(document.querySelector<HTMLInputElement>("#batchLimit")?.value || 10),
      false
    );
    if (toast) toast.textContent = error instanceof Error ? error.message : String(error);
  }
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (message && typeof message === "object" && (message as { type?: unknown }).type === "RUN_UPDATED") {
    void render();
  }
});

void render();
