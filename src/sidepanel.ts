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
import type { AppState, ScanPreview } from "./types";

const appElement = document.querySelector<HTMLDivElement>("#app");
if (!appElement) throw new Error("侧边栏根节点不存在");
const app: HTMLDivElement = appElement;

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

function previewMarkup(preview: ScanPreview | null): string {
  if (!preview) return '<p class="empty">扫描当前猎聘结果页后，可选择新职位生成草稿。</p>';
  return [
    '<div class="metrics">',
    '<div><strong>' + preview.observedCount + '</strong><span>已发现</span></div>',
    '<div><strong>' + preview.newCount + '</strong><span>新职位</span></div>',
    '<div><strong>' + preview.duplicateCount + '</strong><span>重复</span></div>',
    '<div><strong>' + preview.draftedCount + '</strong><span>已有草稿</span></div>',
    '</div>',
    '<div class="candidate-list">',
    preview.candidates.map((candidate) => {
      const selected = preview.selectedJobIds.includes(candidate.jobId);
      const processable = preview.processableJobIds.includes(candidate.jobId);
      return '<label class="candidate ' + (processable ? "" : "disabled") + '"><input type="checkbox" data-job-id="' + escapeHtml(candidate.jobId)
        + '" ' + (selected ? "checked" : "") + " " + (processable ? "" : "disabled") + '><span><b>' + escapeHtml(candidate.title)
        + '</b><small>' + escapeHtml(candidate.company) + " · " + escapeHtml(candidate.salary)
        + '</small></span></label>';
    }).join(""),
    '</div>'
  ].join("");
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
  app.innerHTML = [
    '<header><div><h1>JobFlow</h1><p>',
    state.auth.status === "signed_in"
      ? escapeHtml(state.auth.email) + (state.auth.vip ? " · VIP" : "")
      : "未登录",
    '</p><small>' + escapeHtml(state.settings.model.route.toUpperCase()) + " · "
      + escapeHtml(state.settings.model.provider) + " / " + escapeHtml(state.settings.model.model)
      + '</small></div><div id="header-actions"></div></header>',
    '<section class="status-band"><span class="dot"></span><div><b>仅生成草稿</b><small>不会投递、发送或操作猎聘筛选器</small></div></section>',
    '<section><div class="section-title"><h2>当前结果</h2><div id="scan-actions"></div></div>',
    previewMarkup(state.scanPreview),
    '<div class="batch-row"><label>本批上限<input id="batchLimit" type="number" min="1" max="20" value="',
    String(state.settings.maxJobsPerBatch),
    '"></label><button id="start" class="primary" type="button"',
    state.scanPreview?.selectedJobIds.length ? "" : " disabled",
    '>开始生成</button></div></section>',
    '<section><div class="section-title"><h2>批次</h2><div id="run-actions"></div></div>',
    run
      ? '<div class="run"><div class="progress"><span style="width:' + Math.round(run.currentIndex / Math.max(1, run.items.length) * 100)
        + '%"></span></div><p><b>' + escapeHtml(run.status) + '</b> · '
        + run.currentIndex + "/" + run.items.length + '</p><small>草稿 ' + run.draftCount
        + " · 排除 " + run.excludedCount + " · 复核 " + run.reviewCount + " · 失败 " + run.failedCount + "</small></div>"
      : '<p class="empty">尚未运行批次。</p>',
    '</section>',
    '<section><div class="section-title"><h2>最近记录</h2><button id="viewAll" class="link-button" type="button">查看全部</button></div>',
    '<div class="records">',
    state.opportunities.slice(0, 8).map((record) =>
      '<div class="record"><span class="status ' + escapeHtml(record.status) + '"></span><div><b>'
      + escapeHtml(record.title) + '</b><small>' + escapeHtml(record.company) + " · "
      + escapeHtml(record.status) + '</small></div></div>'
    ).join("") || '<p class="empty">暂无职位记录。</p>',
    '</div></section>',
    '<div id="toast" role="status" aria-live="polite"></div>'
  ].join("");

  const headerActions = document.querySelector("#header-actions");
  headerActions?.append(iconButton("settings", "打开管理台", Settings));
  const scanActions = document.querySelector("#scan-actions");
  scanActions?.append(iconButton("scan", "扫描当前页面", ScanSearch, state.auth.status !== "signed_in"));
  scanActions?.append(iconButton("refresh", "刷新状态", RefreshCw));
  const runActions = document.querySelector("#run-actions");
  runActions?.append(iconButton("pause", "暂停批次", CirclePause, run?.status !== "running"));
  runActions?.append(iconButton("resume", "继续批次", CirclePlay, run?.status !== "paused"));
  runActions?.append(iconButton("cancel", "取消批次", Square, !run || ["completed", "cancelled"].includes(run.status)));

  document.querySelector("#settings")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
  document.querySelector("#viewAll")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
  document.querySelector("#refresh")?.addEventListener("click", () => void render());
  document.querySelector("#scan")?.addEventListener("click", () => void perform({ type: "SCAN_CURRENT_TAB" }));
  document.querySelector("#pause")?.addEventListener("click", () => void perform({ type: "PAUSE_BATCH" }));
  document.querySelector("#resume")?.addEventListener("click", () => void perform({ type: "RESUME_BATCH" }));
  document.querySelector("#cancel")?.addEventListener("click", () => void perform({ type: "CANCEL_BATCH" }));
  document.querySelector("#batchLimit")?.addEventListener("change", async (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const value = Math.max(1, Math.min(20, Number(input.value) || 10));
    await perform({
      type: "UPDATE_SETTINGS",
      settings: { ...state.settings, maxJobsPerBatch: value }
    });
  });
  document.querySelector("#start")?.addEventListener("click", () => {
    const selectedJobIds = [...document.querySelectorAll<HTMLInputElement>("[data-job-id]:checked")]
      .slice(0, state.settings.maxJobsPerBatch)
      .map((input) => input.dataset.jobId || "")
      .filter(Boolean);
    void perform({ type: "START_BATCH", selectedJobIds });
  });
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

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (message && typeof message === "object" && (message as { type?: unknown }).type === "RUN_UPDATED") {
    void render();
  }
});

void render();
