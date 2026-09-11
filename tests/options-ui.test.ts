// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/defaults";
import type { AppState, ResumeProfile } from "../src/types";

const syntheticResume = [
  "合成候选人简历",
  "在示例软件公司负责高可用任务平台的设计、开发、交付和稳定性治理。",
  "使用 TypeScript 建设可恢复任务队列，编写自动化测试并参与故障复盘。",
  "与产品和研发团队协作完成需求分析、方案设计、上线验证和持续改进。"
].join("\n");

function profile(): ResumeProfile {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    version: 1,
    state: "draft",
    sourceHash: "a".repeat(64),
    sourceName: "合成简历.txt",
    sourceKind: "text",
    analyzedAt: "2026-09-11T00:00:00.000Z",
    summary: "具备平台研发经验。",
    targetRoles: ["平台研发"],
    skills: ["TypeScript"],
    facts: [
      {
        id: "fact-1",
        text: "负责高可用任务平台。",
        keywords: ["高可用", "任务平台"],
        evidence: "负责高可用任务平台的设计、开发和交付。",
        approved: false
      },
      {
        id: "fact-2",
        text: "建设可恢复任务队列。",
        keywords: ["任务队列"],
        evidence: "使用 TypeScript 建设可恢复任务队列。",
        approved: false
      }
    ],
    constraints: []
  };
}

function appState(resumeProfile: ResumeProfile | null = null): AppState {
  return {
    auth: {
      status: "signed_in",
      userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      email: "candidate@example.invalid",
      emailVerificationStatus: "unverified",
      vip: false
    },
    settings: structuredClone(DEFAULT_SETTINGS),
    resumeProfile,
    resumeProfiles: resumeProfile ? [resumeProfile] : [],
    localResumeState: resumeProfile ? "available" : "missing",
    scanPreview: null,
    run: null,
    opportunities: [],
    evaluations: [],
    events: [],
    drafts: []
  };
}

async function openResumeView(state: AppState, sendMessage: ReturnType<typeof vi.fn>): Promise<void> {
  vi.stubGlobal("chrome", {
    runtime: { sendMessage },
    tabs: { create: vi.fn() }
  });
  await import("../src/options");
  await vi.waitFor(() => expect(document.querySelector('[data-view="resume"]')).not.toBeNull());
  (document.querySelector('[data-view="resume"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector("#pastedResume")).not.toBeNull());
  expect(state.auth.status).toBe("signed_in");
}

describe("resume profile interactions", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    if (!globalThis.crypto?.subtle) {
      Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
    }
  });

  it("shows staged progress immediately and blocks duplicate imports", async () => {
    let state = appState();
    let releaseImport!: () => void;
    const pendingImport = new Promise<void>((resolve) => {
      releaseImport = resolve;
    });
    const sendMessage = vi.fn(async (request: { type: string }) => {
      if (request.type === "GET_APP_STATE") return { ok: true, data: state };
      if (request.type === "IMPORT_RESUME") {
        await pendingImport;
        const generated = profile();
        state = appState(generated);
        return { ok: true, data: generated };
      }
      return { ok: true };
    });
    await openResumeView(state, sendMessage);

    const pasted = document.querySelector("#pastedResume") as HTMLTextAreaElement;
    const button = document.querySelector('[data-action="import-resume"]') as HTMLButtonElement;
    pasted.value = syntheticResume;
    button.click();

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "IMPORT_RESUME" }));
    });
    const status = document.querySelector("#resumeImportStatus") as HTMLElement;
    expect(status.textContent).toContain("正在调用模型生成画像");
    expect(document.querySelector(".import-band")?.getAttribute("aria-busy")).toBe("true");
    expect(button.disabled).toBe(true);
    expect(pasted.disabled).toBe(true);

    button.click();
    expect(sendMessage.mock.calls.filter(([request]) => request.type === "IMPORT_RESUME")).toHaveLength(1);

    releaseImport();
    await vi.waitFor(() => expect(document.querySelector("#resumeImportStatus")?.textContent)
      .toContain("画像已生成"));
    expect(document.querySelector('[data-action="import-resume"]')?.hasAttribute("disabled")).toBe(false);
  });

  it("shows an inline failure and restores the import controls", async () => {
    const state = appState();
    const sendMessage = vi.fn(async (request: { type: string }) => {
      if (request.type === "GET_APP_STATE") return { ok: true, data: state };
      if (request.type === "IMPORT_RESUME") return { ok: false, error: "模型响应超时，请重试" };
      return { ok: true };
    });
    await openResumeView(state, sendMessage);

    const pasted = document.querySelector("#pastedResume") as HTMLTextAreaElement;
    pasted.value = syntheticResume;
    (document.querySelector('[data-action="import-resume"]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(document.querySelector("#resumeImportStatus")?.textContent)
      .toContain("模型响应超时，请重试"));
    expect(document.querySelector(".import-band")?.getAttribute("aria-busy")).toBe("false");
    expect((document.querySelector('[data-action="import-resume"]') as HTMLButtonElement).disabled).toBe(false);
    expect(pasted.disabled).toBe(false);
  });

  it("supports approving all facts and reflects a partial selection", async () => {
    const state = appState(profile());
    const sendMessage = vi.fn(async (request: { type: string }) =>
      request.type === "GET_APP_STATE" ? { ok: true, data: state } : { ok: true });
    await openResumeView(state, sendMessage);

    const master = document.querySelector("#approveAllFacts") as HTMLInputElement;
    const facts = [...document.querySelectorAll<HTMLInputElement>("[data-fact-approved]")];
    expect(master.checked).toBe(false);
    expect(master.indeterminate).toBe(false);

    master.click();
    expect(facts.every((fact) => fact.checked)).toBe(true);
    expect(master.checked).toBe(true);

    master.click();
    expect(facts.every((fact) => !fact.checked)).toBe(true);
    expect(master.checked).toBe(false);

    facts[0]!.click();
    expect(master.checked).toBe(false);
    expect(master.indeterminate).toBe(true);
  });

  it("renders persisted job details and recruiter metadata without opening Liepin", async () => {
    const state = appState();
    state.opportunities = [{
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      userId: state.auth.userId!,
      platform: "liepin",
      platformJobId: "1980000301",
      canonicalUrl: "https://www.liepin.com/a/1980000301.shtml",
      title: "合成智能体工程师",
      company: "合成科技",
      location: "北京",
      salary: "30-50k",
      experience: "3-5年",
      education: "本科",
      cardText: "合成职位卡片",
      description: "岗位职责：负责合成智能体平台研发。任职要求：熟悉 TypeScript 与分布式系统。",
      recruiter: "陈女士",
      recruiterTitle: "招聘顾问",
      jdHash: "a".repeat(64),
      status: "failed",
      latestReason: "合成失败原因",
      firstSeenAt: "2026-09-11T00:00:00.000Z",
      lastSeenAt: "2026-09-11T00:00:01.000Z"
    }];
    const sendMessage = vi.fn(async () => ({ ok: true, data: state }));
    vi.stubGlobal("chrome", {
      runtime: { sendMessage },
      tabs: { create: vi.fn() }
    });

    await import("../src/options");
    await vi.waitFor(() => expect(document.querySelector(".job-description")).not.toBeNull());
    expect(document.querySelector(".job-description")?.textContent).toContain("合成智能体平台研发");
    expect(document.querySelector(".recruiter-metadata")?.textContent).toContain("陈女士");
    expect(document.querySelector(".recruiter-metadata")?.textContent).toContain("招聘顾问");
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it("retries a failed record from stored details with persistent progress and success", async () => {
    let state = appState(profile());
    state.resumeProfile = { ...state.resumeProfile!, state: "active" };
    state.resumeProfiles = [state.resumeProfile];
    state.opportunities = [{
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      userId: state.auth.userId!,
      platform: "liepin",
      platformJobId: "1980000302",
      canonicalUrl: "https://www.liepin.com/a/1980000302.shtml",
      title: "合成平台工程师",
      company: "合成科技",
      location: "北京",
      salary: "30-50k",
      experience: "3-5年",
      education: "本科",
      cardText: "合成职位卡片",
      description: "岗位职责：负责合成平台研发。任职要求：熟悉 TypeScript。",
      status: "failed",
      latestReason: "模型输出结构无效",
      firstSeenAt: "2026-09-11T00:00:00.000Z",
      lastSeenAt: "2026-09-11T00:00:01.000Z"
    }];
    let releaseRetry!: () => void;
    const pendingRetry = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    const sendMessage = vi.fn(async (request: { type: string }) => {
      if (request.type === "GET_APP_STATE") return { ok: true, data: state };
      if (request.type === "RETRY_STORED_OPPORTUNITY") {
        await pendingRetry;
        state = structuredClone(state);
        state.opportunities[0]!.status = "draft_ready";
        state.opportunities[0]!.latestReason = "招呼语草稿已生成";
        return { ok: true };
      }
      return { ok: true };
    });
    const createTab = vi.fn();
    vi.stubGlobal("chrome", { runtime: { sendMessage }, tabs: { create: createTab } });

    await import("../src/options");
    await vi.waitFor(() => expect(document.querySelector('[data-action="retry-stored-opportunity"]')).not.toBeNull());
    const button = document.querySelector('[data-action="retry-stored-opportunity"]') as HTMLButtonElement;
    button.click();

    expect(button.disabled).toBe(true);
    expect(document.querySelector("#storedRetryStatus")?.textContent).toContain("正在使用已保存的职位详情重试");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(sendMessage.mock.calls.filter(([request]) => request.type === "RETRY_STORED_OPPORTUNITY")).toHaveLength(1);
    expect(createTab).not.toHaveBeenCalled();

    releaseRetry();
    await vi.waitFor(() => expect(document.querySelector("#storedRetryStatus")?.textContent).toContain("重试完成"));
    expect(document.querySelector('[data-action="retry-stored-opportunity"]')).toBeNull();
    expect(createTab).not.toHaveBeenCalled();
  });

  it("keeps a stored-detail retry failure visible and restores retry", async () => {
    const state = appState(profile());
    state.opportunities = [{
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      userId: state.auth.userId!,
      platform: "liepin",
      platformJobId: "1980000303",
      canonicalUrl: "https://www.liepin.com/a/1980000303.shtml",
      title: "合成后端工程师",
      company: "合成科技",
      location: "上海",
      salary: "25-40k",
      experience: "3-5年",
      education: "本科",
      cardText: "合成职位卡片",
      description: "岗位职责：负责合成服务研发。任职要求：熟悉 TypeScript。",
      status: "failed",
      latestReason: "首次模型调用失败",
      firstSeenAt: "2026-09-11T00:00:00.000Z",
      lastSeenAt: "2026-09-11T00:00:01.000Z"
    }];
    const sendMessage = vi.fn(async (request: { type: string }) => {
      if (request.type === "GET_APP_STATE") return { ok: true, data: state };
      if (request.type === "RETRY_STORED_OPPORTUNITY") return { ok: false, error: "模型响应仍不符合格式" };
      return { ok: true };
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage }, tabs: { create: vi.fn() } });

    await import("../src/options");
    await vi.waitFor(() => expect(document.querySelector('[data-action="retry-stored-opportunity"]')).not.toBeNull());
    (document.querySelector('[data-action="retry-stored-opportunity"]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(document.querySelector("#storedRetryStatus")?.textContent)
      .toContain("模型响应仍不符合格式"));
    expect(document.querySelector("#storedRetryStatus")?.classList.contains("error")).toBe(true);
    expect((document.querySelector('[data-action="retry-stored-opportunity"]') as HTMLButtonElement).disabled).toBe(false);
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });
});
