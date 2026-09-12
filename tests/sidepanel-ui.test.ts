// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/defaults";
import type { AppState, BatchRun, OpportunityRecord, ScanPreview } from "../src/types";

function preview(count = 2): ScanPreview {
  const candidates = Array.from({ length: count }, (_, index) => ({
    platform: "liepin" as const,
    jobId: String(1980000200 + index),
    url: `https://www.liepin.com/job/${1980000200 + index}.shtml`,
    canonicalUrl: `https://www.liepin.com/job/${1980000200 + index}.shtml`,
    title: `合成职位 ${index + 1}`,
    company: "合成公司",
    location: "北京",
    salary: "30-50k",
    experience: "3-5年",
    education: "本科",
    cardText: "合成职位卡片",
    index
  }));
  return {
    sourceUrl: "https://c.liepin.com/",
    candidates,
    observedCount: count,
    newCount: count,
    duplicateCount: 0,
    excludedCount: 0,
    draftedCount: 0,
    processableJobIds: candidates.map((candidate) => candidate.jobId),
    selectedJobIds: candidates.map((candidate) => candidate.jobId)
  };
}

function appState(scanPreview: ScanPreview | null = null): AppState {
  return {
    auth: {
      status: "signed_in",
      userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      email: "candidate@example.invalid",
      emailVerificationStatus: "unverified",
      vip: false
    },
    settings: structuredClone(DEFAULT_SETTINGS),
    resumeProfile: null,
    resumeProfiles: [],
    localResumeState: "missing",
    scanPreview,
    run: null,
    opportunities: [],
    evaluations: [],
    events: [],
    drafts: [],
    deliveries: []
  };
}

function batchRun(scanPreview: ScanPreview, selectedJobIds: string[], error?: string): BatchRun {
  const selected = new Set(selectedJobIds);
  const failed = Boolean(error);
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    platform: "liepin",
    status: failed ? "completed" : "running",
    sourceUrl: scanPreview.sourceUrl,
    executionPolicy: "reviewed_send",
    authorizedAt: "2026-09-11T00:00:00.000Z",
    createdAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:01.000Z",
    currentIndex: failed ? selectedJobIds.length : 0,
    items: scanPreview.candidates.filter((candidate) => selected.has(candidate.jobId)).map((candidate) => ({
      candidate,
      status: failed ? "failed" : "queued",
      error,
      attempt: failed ? 1 : 0
    })),
    draftCount: 0,
    excludedCount: 0,
    reviewCount: 0,
    failedCount: failed ? selectedJobIds.length : 0,
    deliverySucceededCount: 0,
    deliveryPartialCount: 0
  };
}

function failedOpportunity(scanPreview: ScanPreview, reason: string): OpportunityRecord {
  const candidate = scanPreview.candidates[0]!;
  return {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    platform: candidate.platform,
    platformJobId: candidate.jobId,
    canonicalUrl: candidate.canonicalUrl,
    title: candidate.title,
    company: candidate.company,
    location: candidate.location,
    salary: candidate.salary,
    experience: candidate.experience,
    education: candidate.education,
    cardText: candidate.cardText,
    status: "failed",
    firstSeenAt: "2026-09-11T00:00:00.000Z",
    lastSeenAt: "2026-09-11T00:00:01.000Z",
    latestReason: reason
  };
}

async function openSidePanel(sendMessage: ReturnType<typeof vi.fn>): Promise<void> {
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage,
      openOptionsPage: vi.fn(),
      onMessage: { addListener: vi.fn() }
    }
  });
  await import("../src/sidepanel");
  await vi.waitFor(() => expect(document.querySelector("#scan")).not.toBeNull());
}

describe("side-panel scan interaction", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
  });

  it("uses a recognizable text-and-icon primary scan action", async () => {
    const state = appState();
    const sendMessage = vi.fn(async (request: { type: string }) =>
      request.type === "GET_APP_STATE" ? { ok: true, data: state } : { ok: true });
    await openSidePanel(sendMessage);
    const scan = document.querySelector("#scan") as HTMLButtonElement;
    expect(scan.textContent).toContain("扫描当前页");
    expect(scan.classList).toContain("primary");
    expect(scan.querySelector("svg")).not.toBeNull();
  });

  it("shows progress immediately, blocks duplicates, and reports completion", async () => {
    let state = appState();
    let releaseScan!: () => void;
    const pendingScan = new Promise<void>((resolve) => {
      releaseScan = resolve;
    });
    const sendMessage = vi.fn(async (request: { type: string }) => {
      if (request.type === "GET_APP_STATE") return { ok: true, data: state };
      if (request.type === "SCAN_CURRENT_TAB") {
        await pendingScan;
        const result = preview();
        state = appState(result);
        return { ok: true, data: result };
      }
      return { ok: true };
    });
    await openSidePanel(sendMessage);

    const scan = document.querySelector("#scan") as HTMLButtonElement;
    scan.click();
    await vi.waitFor(() => expect(sendMessage)
      .toHaveBeenCalledWith(expect.objectContaining({ type: "SCAN_CURRENT_TAB" })));
    expect(scan.disabled).toBe(true);
    expect(scan.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelector("#scanStatus")?.textContent).toContain("正在扫描当前页");

    scan.click();
    expect(sendMessage.mock.calls.filter(([request]) => request.type === "SCAN_CURRENT_TAB")).toHaveLength(1);

    releaseScan();
    await vi.waitFor(() => expect(document.querySelector("#scanStatus")?.textContent).toContain("发现 2 个职位"));
    expect((document.querySelector("#scan") as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps scan failures visible and restores retry", async () => {
    const state = appState();
    const sendMessage = vi.fn(async (request: { type: string }) =>
      request.type === "GET_APP_STATE"
        ? { ok: true, data: state }
        : { ok: false, error: "当前页面无法识别职位列表" });
    await openSidePanel(sendMessage);

    (document.querySelector("#scan") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector("#scanStatus")?.textContent)
      .toContain("当前页面无法识别职位列表"));
    expect((document.querySelector("#scan") as HTMLButtonElement).disabled).toBe(false);
  });

  it("distinguishes an empty scan from an unstarted scan", async () => {
    const state = appState(preview(0));
    const sendMessage = vi.fn(async (request: { type: string }) =>
      request.type === "GET_APP_STATE" ? { ok: true, data: state } : { ok: true });
    await openSidePanel(sendMessage);
    expect(document.querySelector(".scan-empty")?.textContent).toContain("当前页面未识别到职位");
  });

  it("preserves the user's one-item selection after starting a batch", async () => {
    const scanPreview = preview(3);
    let state = appState(scanPreview);
    const submitted: string[][] = [];
    const sendMessage = vi.fn(async (request: { type: string; selectedJobIds?: string[]; expectedExecutionPolicy?: string }) => {
      if (request.type === "GET_APP_STATE") return { ok: true, data: state };
      if (request.type === "START_BATCH") {
        submitted.push(request.selectedJobIds ?? []);
        const run = batchRun(scanPreview, request.selectedJobIds ?? []);
        state = { ...state, run };
        return { ok: true, data: run };
      }
      return { ok: true };
    });
    await openSidePanel(sendMessage);

    const inputs = [...document.querySelectorAll<HTMLInputElement>("[data-job-id]")];
    inputs[1]!.click();
    inputs[2]!.click();
    expect(document.querySelector("#selectionSummary")?.textContent).toContain("已选 1 / 上限 10");
    (document.querySelector("#start") as HTMLButtonElement).click();

    await vi.waitFor(() => expect(document.querySelector(".run")?.textContent).toContain("0/1"));
    expect(submitted).toEqual([[scanPreview.candidates[0]!.jobId]]);
    expect(sendMessage.mock.calls.find(([request]) => request.type === "START_BATCH")?.[0])
      .toMatchObject({ expectedExecutionPolicy: "reviewed_send" });
    expect(document.querySelector(".run-current")?.textContent).toContain("等待处理");
    const selectedAfterRender = [...document.querySelectorAll<HTMLInputElement>("[data-job-id]:checked")];
    expect(selectedAfterRender).toHaveLength(1);
    expect(selectedAfterRender[0]!.dataset.jobId).toBe(scanPreview.candidates[0]!.jobId);
    expect((document.querySelector("#start") as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector("#start")?.textContent).toContain("批次进行中");
  });

  it("labels automatic mode as one-click real submit and contact without changing selection", async () => {
    const scanPreview = preview(2);
    let state = appState(scanPreview);
    state.settings.executionPolicy = "automatic_send";
    state.settings.automaticSendDelayMinSeconds = 10;
    state.settings.automaticSendDelayMaxSeconds = 20;
    const sendMessage = vi.fn(async () => ({ ok: true, data: state }));
    await openSidePanel(sendMessage);

    expect(document.querySelector(".status-band")?.textContent).toContain("自动投递");
    expect(document.querySelector(".status-band")?.textContent).toContain("10-20 秒");
    expect(document.querySelector("#start")?.textContent).toContain("一键投递并打招呼 2 个职位");

    (document.querySelector("#start") as HTMLButtonElement).click();
    type StartRequest = { type: string; selectedJobIds?: string[]; expectedExecutionPolicy?: string };
    const calls = sendMessage.mock.calls as unknown as Array<[StartRequest]>;
    await vi.waitFor(() => expect(calls.some(([request]) => request.type === "START_BATCH")).toBe(true));
    expect(calls.find(([request]) => request.type === "START_BATCH")?.[0])
      .toMatchObject({
        selectedJobIds: scanPreview.candidates.map((candidate) => candidate.jobId),
        expectedExecutionPolicy: "automatic_send"
      });
  });

  it("enters a start-batch busy state before awaiting and blocks duplicate starts", async () => {
    const scanPreview = preview(2);
    let state = appState(scanPreview);
    let releaseStart!: () => void;
    const pendingStart = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const sendMessage = vi.fn(async (request: { type: string; selectedJobIds?: string[] }) => {
      if (request.type === "GET_APP_STATE") return { ok: true, data: state };
      if (request.type === "START_BATCH") {
        await pendingStart;
        state = { ...state, run: batchRun(scanPreview, request.selectedJobIds ?? []) };
        return { ok: true, data: state.run };
      }
      return { ok: true };
    });
    await openSidePanel(sendMessage);

    const start = document.querySelector("#start") as HTMLButtonElement;
    start.click();
    await vi.waitFor(() => expect(sendMessage.mock.calls.some(([request]) => request.type === "START_BATCH")).toBe(true));
    expect(start.disabled).toBe(true);
    expect(start.getAttribute("aria-busy")).toBe("true");

    start.click();
    start.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(sendMessage.mock.calls.filter(([request]) => request.type === "START_BATCH")).toHaveLength(1);
    const input = document.querySelector<HTMLInputElement>("[data-job-id]")!;
    input.click();
    expect((document.querySelector("#start") as HTMLButtonElement).disabled).toBe(true);

    releaseStart();
    await vi.waitFor(() => expect(sendMessage.mock.calls.filter(([request]) => request.type === "GET_APP_STATE").length)
      .toBeGreaterThan(1));
  });

  it("updates the visible wait countdown while the side panel stays open", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-12T00:00:00.000Z"));
    const scanPreview = preview(1);
    const state = appState(scanPreview);
    state.run = {
      ...batchRun(scanPreview, [scanPreview.candidates[0]!.jobId]),
      executionPolicy: "automatic_send",
      nextWriteEligibleAt: "2026-09-12T00:00:03.000Z",
      items: [{
        candidate: scanPreview.candidates[0]!,
        status: "waiting_interval",
        attempt: 1
      }]
    };
    const sendMessage = vi.fn(async () => ({ ok: true, data: state }));
    try {
      await openSidePanel(sendMessage);
      expect(document.querySelector(".run-wait")?.textContent).toContain("3 秒");

      vi.advanceTimersByTime(1100);
      expect(document.querySelector(".run-wait")?.textContent).toContain("2 秒");

      state.run.nextWriteEligibleAt = undefined;
      state.run.items[0]!.status = "delivery_ready";
      const addListener = chrome.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>;
      addListener.mock.calls[0]?.[0]?.({ type: "RUN_UPDATED" });
      await vi.runOnlyPendingTimersAsync();
      expect(document.querySelector(".run-wait")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores the start control after a batch-start failure", async () => {
    const scanPreview = preview(1);
    const state = appState(scanPreview);
    const sendMessage = vi.fn(async (request: { type: string }) => {
      if (request.type === "GET_APP_STATE") return { ok: true, data: state };
      if (request.type === "START_BATCH") return { ok: false, error: "执行策略已变化" };
      return { ok: true };
    });
    await openSidePanel(sendMessage);

    const start = document.querySelector("#start") as HTMLButtonElement;
    start.click();

    await vi.waitFor(() => expect(document.querySelector("#toast")?.textContent).toContain("执行策略已变化"));
    expect((document.querySelector("#start") as HTMLButtonElement).disabled).toBe(false);
    expect(document.querySelector("#start")?.getAttribute("aria-busy")).toBe("false");
  });

  it("shows failure reasons in the batch and recent record", async () => {
    const scanPreview = preview(1);
    const reason = "详情页读取超时";
    const state = {
      ...appState(scanPreview),
      run: batchRun(scanPreview, [scanPreview.candidates[0]!.jobId], reason),
      opportunities: [failedOpportunity(scanPreview, reason)]
    };
    const sendMessage = vi.fn(async () => ({ ok: true, data: state }));
    await openSidePanel(sendMessage);

    expect(document.querySelector(".run-failure")?.textContent).toContain(reason);
    expect(document.querySelector(".record-reason")?.textContent).toContain(reason);
  });

  it("projects completed delivery status and reason over the draft opportunity summary", async () => {
    const scanPreview = preview(1);
    const opportunity = failedOpportunity(scanPreview, "草稿已生成");
    opportunity.status = "draft_ready";
    const state = appState(scanPreview);
    state.opportunities = [opportunity];
    state.deliveries = [{
      opportunityId: opportunity.id,
      platform: "liepin",
      platformJobId: opportunity.platformJobId,
      resumeMode: "platform_default",
      overallStatus: "succeeded",
      applicationStatus: "verified",
      greetingStatus: "verified",
      latestReason: "正式投递已从猎聘页面验证",
      updatedAt: "2026-09-11T00:00:02.000Z"
    }];
    const sendMessage = vi.fn(async () => ({ ok: true, data: state }));
    await openSidePanel(sendMessage);

    expect(document.querySelector(".record")?.textContent).toContain("已投递并联系");
    expect(document.querySelector(".record-reason")?.textContent).toContain("正式投递已从猎聘页面验证");
    expect(document.querySelector(".record-reason")?.textContent).not.toContain("草稿已生成");
  });
});
