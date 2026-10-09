// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/defaults";
import type { AppState, AppStateQuery, ResumeProfile } from "../src/types";

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
    drafts: [],
    deliveries: []
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

describe("scoped record reads", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
  });

  function recordsState(): AppState {
    const state = appState();
    state.opportunities = [1, 2].map((index) => ({
      id: index === 1 ? "cccccccc-cccc-4ccc-8ccc-cccccccccccc" : "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      userId: state.auth.userId!, platform: "liepin", platformJobId: "198000000" + index,
      canonicalUrl: "https://www.liepin.com/a/198000000" + index + ".shtml",
      title: "合成职位 " + index, company: "合成公司", location: "北京", salary: "20-30k",
      experience: "3年", education: "本科", cardText: "", status: "review_required",
      firstSeenAt: "2026-09-11T00:00:00.000Z", lastSeenAt: "2026-09-11T00:00:00.000Z"
    }));
    state.recordPage = { page: 0, hasNext: true };
    state.recordDetail = { ...state.opportunities[0]!, description: "仅所选职位的完整 JD" };
    return state;
  }

  async function open(sendMessage: ReturnType<typeof vi.fn>): Promise<void> {
    vi.stubGlobal("chrome", { runtime: { sendMessage }, tabs: { create: vi.fn() } });
    await import("../src/options");
    await vi.waitFor(() => expect(document.querySelector("#recordFilter")).not.toBeNull());
  }

  it("requests server pagination/filter/search and selected details without treating summaries as full records", async () => {
    const state = recordsState();
    const sendMessage = vi.fn(async (request: AppStateQuery) => ({ ok: true, data: {
      ...state,
      recordPage: { page: request.page ?? 0, hasNext: !request.page },
      recordDetail: {
        ...state.opportunities.find((record) => record.id === request.opportunityId) ?? state.opportunities[0]!,
        description: "仅所选职位的完整 JD"
      }
    } }));
    await open(sendMessage);
    expect(sendMessage).toHaveBeenCalledWith({ type: "GET_APP_STATE", view: "records", page: 0, recordFilter: "all", recordSearch: "" });
    expect(document.querySelector(".job-description")?.textContent).toBe("仅所选职位的完整 JD");
    const secondId = state.opportunities[1]!.id;
    document.querySelector<HTMLButtonElement>('[data-record-id="' + secondId + '"]')!.click();
    await vi.waitFor(() => expect(document.querySelector(".record-detail h3")?.textContent).toBe("合成职位 2"));
    expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ view: "records", opportunityId: secondId }));

    document.querySelector<HTMLButtonElement>("#nextRecords")!.click();
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>("#nextRecords")?.disabled).toBe(true));
    expect(sendMessage).toHaveBeenLastCalledWith({ type: "GET_APP_STATE", view: "records", page: 1, recordFilter: "all", recordSearch: "" });
    document.querySelector<HTMLButtonElement>("#previousRecords")!.click();
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>("#previousRecords")?.disabled).toBe(true));
    const filter = document.querySelector<HTMLSelectElement>("#recordFilter")!;
    filter.value = "failed";
    filter.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ page: 0, recordFilter: "failed" })));
    const search = document.querySelector<HTMLInputElement>("#recordSearch")!;
    search.value = "云平台";
    search.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ page: 0, recordSearch: "云平台" })));
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>("#refreshRecords")?.disabled).toBe(false));
    document.querySelector<HTMLButtonElement>("#refreshRecords")!.click();
    expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ refresh: true, view: "records" }));
  });

  it("coalesces identical pending reads and discards a delayed earlier view response", async () => {
    const state = recordsState();
    let resolveRules!: (value: unknown) => void;
    const pendingRules = new Promise((resolve) => { resolveRules = resolve; });
    const sendMessage = vi.fn(async (request: AppStateQuery) => request.view === "rules" ? pendingRules : { ok: true, data: state });
    await open(sendMessage);
    const rules = document.querySelector<HTMLButtonElement>('[data-view="rules"]')!;
    rules.click();
    rules.click();
    expect(sendMessage.mock.calls.filter(([request]) => request.view === "rules")).toHaveLength(1);
    document.querySelector<HTMLButtonElement>('[data-view="account"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-action="logout"]')).not.toBeNull());
    resolveRules({ ok: true, data: { ...state, auth: { ...state.auth, email: "stale@example.invalid" } } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('[data-action="logout"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("stale@example.invalid");
    expect(sendMessage).toHaveBeenLastCalledWith({ type: "GET_APP_STATE", view: "account" });
  });

  it("keeps selected detail outside the filtered page, and opens a platform tab without downloading state", async () => {
    const state = recordsState();
    state.opportunities = [];
    const sendMessage = vi.fn(async () => ({ ok: true, data: state }));
    await open(sendMessage);
    expect(document.querySelector(".record-detail h3")?.textContent).toBe("合成职位 1");
    document.querySelector<HTMLButtonElement>('[data-action="open-job"]')!.click();
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledOnce());
    expect(sendMessage).toHaveBeenCalledOnce();
  });
});

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

  it("saves execution policy and automatic delay settings from the account page", async () => {
    const state = appState(profile());
    state.settings.executionPolicy = "reviewed_send";
    state.settings.automaticSendDelayMinSeconds = 10;
    state.settings.automaticSendDelayMaxSeconds = 20;
    const sendMessage = vi.fn(async (request: { type: string; settings?: AppState["settings"] }) => {
      if (request.type === "GET_APP_STATE") return { ok: true, data: state };
      if (request.type === "UPDATE_SETTINGS" && request.settings) state.settings = request.settings;
      return { ok: true, data: request };
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage }, tabs: { create: vi.fn() } });

    await import("../src/options");
    await vi.waitFor(() => expect(document.querySelector('[data-view="account"]')).not.toBeNull());
    (document.querySelector('[data-view="account"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('[name="executionPolicy"][value="reviewed_send"]')).not.toBeNull());
    expect(document.querySelector("#executionPolicy")).toBeNull();
    expect((document.querySelector('[name="executionPolicy"][value="reviewed_send"]') as HTMLInputElement).checked).toBe(true);

    (document.querySelector('[name="executionPolicy"][value="automatic_send"]') as HTMLInputElement).click();
    expect((document.querySelector('[name="executionPolicy"][value="automatic_send"]') as HTMLInputElement).checked).toBe(true);
    (document.querySelector("#automaticSendDelayMinSeconds") as HTMLInputElement).value = "12";
    (document.querySelector("#automaticSendDelayMaxSeconds") as HTMLInputElement).value = "34";
    (document.querySelector('[data-action="save-interface"]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(sendMessage.mock.calls.some(([request]) => request.type === "UPDATE_SETTINGS")).toBe(true));
    expect(sendMessage.mock.calls.find(([request]) => request.type === "UPDATE_SETTINGS")?.[0])
      .toMatchObject({
        settings: {
          executionPolicy: "automatic_send",
          automaticSendDelayMinSeconds: 12,
          automaticSendDelayMaxSeconds: 34
        }
      });
    await vi.waitFor(() => expect(document.querySelector(".mode")?.textContent).toContain("选中批次自动投递"));
    expect(document.querySelector(".mode")?.textContent).toContain("仅侧边栏一键按钮授权本批");
  });

  it("rejects invalid automatic delay settings without saving", async () => {
    const state = appState(profile());
    const sendMessage = vi.fn(async (request: { type: string }) =>
      request.type === "GET_APP_STATE" ? { ok: true, data: state } : { ok: true });
    vi.stubGlobal("chrome", { runtime: { sendMessage }, tabs: { create: vi.fn() } });

    await import("../src/options");
    await vi.waitFor(() => expect(document.querySelector('[data-view="account"]')).not.toBeNull());
    (document.querySelector('[data-view="account"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector("#automaticSendDelayMinSeconds")).not.toBeNull());

    (document.querySelector("#automaticSendDelayMinSeconds") as HTMLInputElement).value = "40";
    (document.querySelector("#automaticSendDelayMaxSeconds") as HTMLInputElement).value = "20";
    (document.querySelector('[data-action="save-interface"]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(document.querySelector("#toast")?.textContent).toContain("随机间隔"));
    expect(sendMessage.mock.calls.filter(([request]) => request.type === "UPDATE_SETTINGS")).toHaveLength(0);
  });

  it("hides manual live send controls when the execution policy is draft-only", async () => {
    const state = appState(profile());
    state.settings.executionPolicy = "draft_only";
    const opportunityId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    state.opportunities = [{
      id: opportunityId,
      userId: state.auth.userId!,
      platform: "liepin",
      platformJobId: "1980000304",
      canonicalUrl: "https://www.liepin.com/a/1980000304.shtml",
      title: "合成 Agent 工程师",
      company: "合成科技",
      location: "北京",
      salary: "30-50k",
      experience: "3-5年",
      education: "本科",
      cardText: "合成职位卡片",
      description: "岗位职责：负责合成智能体平台研发。",
      status: "draft_ready",
      firstSeenAt: "2026-09-11T00:00:00.000Z",
      lastSeenAt: "2026-09-11T00:00:01.000Z"
    }];
    state.drafts = [{
      opportunityId,
      currentText: "您好，我关注到这个合成 Agent 岗位，过往做过任务平台和稳定性建设，想进一步沟通匹配度。",
      revisions: [{
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        kind: "generated",
        text: "您好，我关注到这个合成 Agent 岗位，过往做过任务平台和稳定性建设，想进一步沟通匹配度。",
        createdAt: "2026-09-11T00:00:02.000Z",
        jdEvidence: ["负责合成智能体平台研发"],
        factIds: ["fact-1"]
      }],
      updatedAt: "2026-09-11T00:00:02.000Z"
    }];
    const sendMessage = vi.fn(async () => ({ ok: true, data: state }));
    vi.stubGlobal("chrome", { runtime: { sendMessage }, tabs: { create: vi.fn() } });

    await import("../src/options");
    await vi.waitFor(() => expect(document.querySelector(".reviewed-send")).not.toBeNull());
    expect(document.querySelector(".reviewed-send")?.textContent).toContain("当前为仅生成模式");
    expect(document.querySelector('[data-action="prepare-reviewed-send"]')).toBeNull();
    expect(document.querySelector('[data-action="confirm-reviewed-send"]')).toBeNull();
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

  it("shows immediate progress and blocks duplicate review generation", async () => {
    const state = appState(profile());
    state.settings.executionPolicy = "draft_only";
    const opportunityId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    state.opportunities = [{
      id: opportunityId,
      userId: state.auth.userId!,
      platform: "liepin",
      platformJobId: "1980000310",
      canonicalUrl: "https://www.liepin.com/a/1980000310.shtml",
      title: "合成复核职位",
      company: "合成科技",
      location: "北京",
      salary: "30-50k",
      experience: "3-5年",
      education: "本科",
      cardText: "合成职位卡片",
      description: "岗位职责：负责合成智能体平台研发。",
      status: "review_required",
      latestReason: "需要用户确认经验年限",
      firstSeenAt: "2026-09-11T00:00:00.000Z",
      lastSeenAt: "2026-09-11T00:00:01.000Z"
    }];
    let releaseGeneration!: () => void;
    const pendingGeneration = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    const sendMessage = vi.fn(async (request: { type: string }) => {
      if (request.type === "GET_APP_STATE") return { ok: true, data: state };
      if (request.type === "REVIEW_DECISION") await pendingGeneration;
      return { ok: true };
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage }, tabs: { create: vi.fn() } });

    await import("../src/options");
    await vi.waitFor(() => expect(document.querySelector('[data-action="review-continue"]')).not.toBeNull());
    const button = document.querySelector('[data-action="review-continue"]') as HTMLButtonElement;
    button.click();

    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.textContent).toContain("正在生成");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(sendMessage.mock.calls.filter(([request]) => request.type === "REVIEW_DECISION")).toHaveLength(1);

    releaseGeneration();
    await vi.waitFor(() => expect(document.querySelector('[data-action="review-continue"]')?.textContent).toBe("继续生成"));
    expect(document.querySelector("#toast")?.textContent).toContain("已转入人工确认");
  });

  function pendingReviewState(): AppState {
    const state = appState(profile());
    state.opportunities = [{
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      userId: state.auth.userId!, platform: "liepin", platformJobId: "1980000310",
      canonicalUrl: "https://www.liepin.com/a/1980000310.shtml",
      title: "合成复核职位", company: "合成科技", location: "北京", salary: "30-50k",
      experience: "3-5年", education: "本科", cardText: "合成职位卡片",
      description: "岗位职责：负责合成智能体平台研发。", status: "review_required",
      firstSeenAt: "2026-09-11T00:00:00.000Z", lastSeenAt: "2026-09-11T00:00:01.000Z"
    }];
    return state;
  }

  it("shows one-click stages and keeps controls busy across state refreshes and pending-review filtering", async () => {
    const state = pendingReviewState();
    const opportunityId = state.opportunities[0]!.id;
    let listener!: (message: unknown, sender: chrome.runtime.MessageSender) => void;
    let finish!: (response: unknown) => void;
    const pending = new Promise((resolve) => { finish = resolve; });
    const sendMessage = vi.fn(async (request: { type: string }) => {
      if (request.type === "GET_APP_STATE") return { ok: true, data: state };
      if (request.type === "REVIEW_AND_SEND") return pending;
      throw new Error("Unexpected command");
    });
    const confirm = vi.fn();
    vi.stubGlobal("confirm", confirm);
    vi.stubGlobal("chrome", { runtime: {
      id: "extension-id", sendMessage,
      onMessage: { addListener: vi.fn((callback) => { listener = callback; }) }
    }, tabs: { create: vi.fn() } });
    await import("../src/options");
    await vi.waitFor(() => expect(document.querySelector('[data-action="review-and-send"]')).not.toBeNull());
    const filter = document.querySelector<HTMLSelectElement>("#recordFilter")!;
    filter.value = "review_required";
    filter.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(document.querySelector<HTMLSelectElement>("#recordFilter")?.value).toBe("review_required"));
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('[data-action="review-and-send"]')?.disabled).toBe(false));
    const button = document.querySelector<HTMLButtonElement>('[data-action="review-and-send"]')!;
    expect(button.textContent).toBe("生成并投递");
    expect(document.querySelector('[data-action="review-continue"]')).toBeNull();
    expect(document.querySelector(".review-and-send")?.textContent).toContain("真实投递并发送");
    button.click();
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.textContent).toBe("正在生成招呼语");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(sendMessage.mock.calls.filter(([request]) => request.type === "REVIEW_AND_SEND")).toHaveLength(1);
    expect(document.querySelector<HTMLButtonElement>('[data-action="review-exclude"]')?.disabled).toBe(true);

    state.opportunities[0]!.status = "draft_ready";
    listener({ type: "REVIEW_AND_SEND_PROGRESS", opportunityId, ownerId: state.auth.userId, stage: "preflighting" }, { id: "extension-id" });
    const readsBeforeProgress = sendMessage.mock.calls.filter(([request]) => request.type === "GET_APP_STATE").length;
    listener({ type: "RUN_UPDATED" }, { id: "extension-id" });
    await vi.waitFor(() => expect(document.querySelector('[data-action="review-and-send"]')?.textContent).toBe("正在检查投递条件"));
    expect(document.querySelector<HTMLButtonElement>('[data-action="review-and-send"]')?.disabled).toBe(true);
    expect(document.querySelector(".record-detail")?.textContent).toContain("合成复核职位");
    expect(document.querySelector('[data-action="prepare-reviewed-send"]')).toBeNull();
    listener({ type: "REVIEW_AND_SEND_PROGRESS", opportunityId, ownerId: state.auth.userId, stage: "sending" }, { id: "extension-id" });
    expect(document.querySelector("#reviewAndSendStatus")?.textContent).toBe("正在投递并发送");
    expect(sendMessage.mock.calls.filter(([request]) => request.type === "GET_APP_STATE")).toHaveLength(readsBeforeProgress);
    finish({ ok: true, data: { overallStatus: "succeeded" } });
    await vi.waitFor(() => expect(document.querySelector("#reviewAndSendStatus")?.textContent).toBe("已完成投递并发送招呼语"));
    expect(document.querySelector(".review-and-send")?.getAttribute("aria-busy")).toBe("false");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("keeps one-click failure visible and restores the button for a safe retry", async () => {
    const state = pendingReviewState();
    const sendMessage = vi.fn(async (request: { type: string }) => request.type === "GET_APP_STATE"
      ? { ok: true, data: state } : { ok: false, error: "模型请求失败，请检查配置" });
    vi.stubGlobal("chrome", { runtime: { sendMessage }, tabs: { create: vi.fn() } });
    await import("../src/options");
    await vi.waitFor(() => expect(document.querySelector('[data-action="review-and-send"]')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('[data-action="review-and-send"]')!.click();
    await vi.waitFor(() => expect(document.querySelector("#reviewAndSendStatus")?.textContent).toBe("模型请求失败，请检查配置"));
    expect(document.querySelector<HTMLButtonElement>('[data-action="review-and-send"]')?.disabled).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('[data-action="review-exclude"]')?.disabled).toBe(false);
    expect(document.querySelector("#reviewAndSendStatus")?.getAttribute("aria-live")).toBe("polite");
  });

  it.each(["zhaopin", "draft_only"])("keeps %s reviews generation-only", async (mode) => {
    const state = pendingReviewState();
    if (mode === "zhaopin") state.opportunities[0]!.platform = "zhaopin";
    else state.settings.executionPolicy = "draft_only";
    const sendMessage = vi.fn(async () => ({ ok: true, data: state }));
    vi.stubGlobal("chrome", { runtime: { sendMessage }, tabs: { create: vi.fn() } });
    await import("../src/options");
    await vi.waitFor(() => expect(document.querySelector('[data-action="review-continue"]')).not.toBeNull());
    expect(document.querySelector('[data-action="review-and-send"]')).toBeNull();
    expect(document.querySelector('[data-action="review-exclude"]')).not.toBeNull();
  });

  it("requires prepare before a reviewed live send confirmation and blocks duplicates", async () => {
    const state = appState(profile());
    const opportunityId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const revisionId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    state.opportunities = [{
      id: opportunityId,
      userId: state.auth.userId!,
      platform: "liepin",
      platformJobId: "1980000304",
      canonicalUrl: "https://www.liepin.com/a/1980000304.shtml",
      title: "合成 Agent 工程师",
      company: "合成科技",
      location: "北京",
      salary: "30-50k",
      experience: "3-5年",
      education: "本科",
      cardText: "合成职位卡片",
      description: "岗位职责：负责合成智能体平台研发。",
      status: "draft_ready",
      firstSeenAt: "2026-09-11T00:00:00.000Z",
      lastSeenAt: "2026-09-11T00:00:01.000Z"
    }];
    state.drafts = [{
      opportunityId,
      currentText: "您好，我关注到这个合成 Agent 岗位，过往做过任务平台和稳定性建设，想进一步沟通匹配度。",
      revisions: [{
        id: revisionId,
        kind: "generated",
        text: "您好，我关注到这个合成 Agent 岗位，过往做过任务平台和稳定性建设，想进一步沟通匹配度。",
        createdAt: "2026-09-11T00:00:02.000Z",
        jdEvidence: ["负责合成智能体平台研发"],
        factIds: ["fact-1"]
      }],
      updatedAt: "2026-09-11T00:00:02.000Z"
    }];
    let releasePrepare!: () => void;
    const pendingPrepare = new Promise<void>((resolve) => {
      releasePrepare = resolve;
    });
    const sendMessage = vi.fn(async (request: { type: string }) => {
      if (request.type === "GET_APP_STATE") return { ok: true, data: state };
      if (request.type === "PREPARE_REVIEWED_SEND") {
        await pendingPrepare;
        return { ok: true, data: {} };
      }
      if (request.type === "CONFIRM_REVIEWED_SEND") return { ok: true, data: {} };
      return { ok: true };
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage }, tabs: { create: vi.fn() } });

    await import("../src/options");
    await vi.waitFor(() => expect(document.querySelector('[data-action="prepare-reviewed-send"]')).not.toBeNull());
    expect(document.querySelector('[data-action="confirm-reviewed-send"]')).toBeNull();
    const prepare = document.querySelector('[data-action="prepare-reviewed-send"]') as HTMLButtonElement;
    prepare.click();
    expect(prepare.disabled).toBe(true);
    expect(prepare.textContent).toContain("正在检查");
    await vi.waitFor(() => expect(document.querySelector("#reviewedSendStatus")?.textContent).toContain("正在检查"));
    await vi.waitFor(() => expect(sendMessage.mock.calls.filter(([request]) => request.type === "PREPARE_REVIEWED_SEND")).toHaveLength(1));
    prepare.click();
    expect(sendMessage.mock.calls.filter(([request]) => request.type === "PREPARE_REVIEWED_SEND")).toHaveLength(1);

    releasePrepare();
    await vi.waitFor(() => expect(document.querySelector('[data-action="confirm-reviewed-send"]')).not.toBeNull());
    expect(document.querySelector('[data-action="prepare-reviewed-send"]')).toBeNull();
    (document.querySelector('[data-action="confirm-reviewed-send"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(sendMessage.mock.calls.some(([request]) => request.type === "CONFIRM_REVIEWED_SEND")).toBe(true));
    const confirmRequest = sendMessage.mock.calls.find(([request]) => request.type === "CONFIRM_REVIEWED_SEND")?.[0] as
      | { opportunityId: string; draftRevisionId: string; draftSha256: string }
      | undefined;
    expect(confirmRequest).toBeDefined();
    expect(confirmRequest).toMatchObject({ opportunityId, draftRevisionId: revisionId });
    expect(confirmRequest!.draftSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("renders durable verified delivery labels and no replay action after completion", async () => {
    const state = appState(profile());
    const opportunityId = "abababab-abab-4bab-8bab-abababababab";
    const revisionId = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd";
    const draftText = "您好，这是一条已经完成真实投递并通过平台回读验证的合成招呼语。";
    state.opportunities = [{
      id: opportunityId,
      userId: state.auth.userId!,
      platform: "liepin",
      platformJobId: "1980000305",
      canonicalUrl: "https://www.liepin.com/a/1980000305.shtml",
      title: "合成交付工程师",
      company: "合成科技",
      location: "北京",
      salary: "30-50k",
      experience: "3-5年",
      education: "本科",
      cardText: "合成职位卡片",
      description: "负责合成交付平台研发。",
      status: "draft_ready",
      firstSeenAt: "2026-09-11T00:00:00.000Z",
      lastSeenAt: "2026-09-11T00:00:01.000Z"
    }];
    state.drafts = [{
      opportunityId,
      currentText: draftText,
      revisions: [{
        id: revisionId,
        kind: "generated",
        text: draftText,
        createdAt: "2026-09-11T00:00:02.000Z",
        jdEvidence: ["合成交付平台"],
        factIds: ["fact-1"]
      }],
      updatedAt: "2026-09-11T00:00:02.000Z"
    }];
    state.deliveries = [{
      opportunityId,
      platform: "liepin",
      platformJobId: "1980000305",
      resumeMode: "platform_default",
      overallStatus: "succeeded",
      applicationStatus: "verified",
      greetingStatus: "verified",
      draftRevisionId: revisionId,
      draftSha256: "a".repeat(64),
      latestReason: "正式投递已从猎聘页面验证",
      updatedAt: "2026-09-11T00:00:03.000Z"
    }];
    const sendMessage = vi.fn(async () => ({ ok: true, data: state }));
    vi.stubGlobal("chrome", { runtime: { sendMessage }, tabs: { create: vi.fn() } });

    await import("../src/options");
    await vi.waitFor(() => expect(document.querySelector(".reviewed-send")?.textContent).toContain("已完成"));
    expect(document.querySelector(".reviewed-send")?.textContent).toContain("正式投递已从猎聘页面验证");
    expect(document.querySelectorAll(".delivery-details dd")[1]?.textContent).toBe("已验证");
    expect(document.querySelectorAll(".delivery-details dd")[2]?.textContent).toBe("已验证");
    expect(document.querySelector('[data-action="prepare-reviewed-send"]')).toBeNull();
    expect(document.querySelector('[data-action="confirm-reviewed-send"]')).toBeNull();
  });
});
