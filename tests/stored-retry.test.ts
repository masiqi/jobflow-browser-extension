import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/defaults";
import type { ExtensionSettings, OpportunityRecord, ResumeProfile } from "../src/types";

const backend = vi.hoisted(() => ({
  getAuthProjection: vi.fn(),
  invokeModelGateway: vi.fn(),
  listOpportunities: vi.fn(),
  listResumeProfiles: vi.fn()
}));
const storage = vi.hoisted(() => ({
  getByokKey: vi.fn(),
  loadSettings: vi.fn()
}));

vi.mock("../src/backend/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/backend/supabase")>(),
  ...backend
}));
vi.mock("../src/storage", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/storage")>(),
  ...storage
}));

const userId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const opportunityId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
let runtimeListener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | undefined;
let createTab: ReturnType<typeof vi.fn>;

function activeProfile(): ResumeProfile {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    version: 1,
    state: "active",
    sourceHash: "a".repeat(64),
    sourceName: "synthetic.txt",
    sourceKind: "text",
    analyzedAt: "2026-09-11T00:00:00.000Z",
    activatedAt: "2026-09-11T00:01:00.000Z",
    summary: "具备平台工程经验。",
    targetRoles: ["平台研发"],
    skills: ["TypeScript"],
    facts: [{
      id: "fact-1",
      text: "负责过高可用任务平台。",
      keywords: ["高可用", "任务平台"],
      evidence: "负责过高可用任务平台",
      approved: true
    }],
    constraints: []
  };
}

function failedOpportunity(overrides: Partial<OpportunityRecord> = {}): OpportunityRecord {
  return {
    id: opportunityId,
    userId,
    platform: "liepin",
    platformJobId: "1980000401",
    canonicalUrl: "https://www.liepin.com/a/1980000401.shtml",
    title: "合成平台工程师",
    company: "合成科技",
    location: "北京",
    salary: "30-50k",
    experience: "3-5年",
    education: "本科",
    cardText: "合成职位卡片",
    description: "负责建设高可用任务平台和稳定性体系。",
    recruiter: "陈女士",
    recruiterTitle: "招聘顾问",
    jdHash: "c".repeat(64),
    status: "failed",
    firstSeenAt: "2026-09-11T00:00:00.000Z",
    lastSeenAt: "2026-09-11T00:00:01.000Z",
    latestReason: "模型输出结构无效",
    ...overrides
  };
}

function managedSettings(): ExtensionSettings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    model: { ...structuredClone(DEFAULT_SETTINGS.model), route: "managed" }
  };
}

async function loadBackground(): Promise<void> {
  createTab = vi.fn();
  vi.stubGlobal("chrome", {
    runtime: {
      id: "jobflow-extension-id",
      getURL: vi.fn((path: string) => "chrome-extension://jobflow-extension-id/" + path),
      onMessage: { addListener: vi.fn((listener) => { runtimeListener = listener; }) },
      onStartup: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
      sendMessage: vi.fn(async () => undefined)
    },
    alarms: {
      onAlarm: { addListener: vi.fn() },
      create: vi.fn(async () => undefined),
      clear: vi.fn(async () => true)
    },
    storage: {
      local: { setAccessLevel: vi.fn(async () => undefined) },
      session: { setAccessLevel: vi.fn(async () => undefined) }
    },
    sidePanel: { open: vi.fn(), setPanelBehavior: vi.fn(async () => undefined) },
    tabs: {
      create: createTab,
      query: vi.fn(async () => []),
      remove: vi.fn(async () => undefined),
      get: vi.fn(async () => undefined),
      sendMessage: vi.fn()
    }
  });
  await import("../src/background");
  expect(runtimeListener).toBeTypeOf("function");
}

async function dispatchRetry(): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    runtimeListener?.(
      { type: "RETRY_STORED_OPPORTUNITY", opportunityId },
      {} as chrome.runtime.MessageSender,
      (response) => resolve(response as { ok: boolean; error?: string })
    );
  });
}

describe("stored opportunity retry", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    runtimeListener = undefined;
    backend.getAuthProjection.mockResolvedValue({
      status: "signed_in",
      userId,
      email: "candidate@example.invalid",
      emailVerificationStatus: "unverified",
      vip: true
    });
    backend.listOpportunities.mockResolvedValue([failedOpportunity()]);
    backend.listResumeProfiles.mockResolvedValue([activeProfile()]);
    storage.loadSettings.mockResolvedValue(managedSettings());
    storage.getByokKey.mockResolvedValue("");
    backend.invokeModelGateway.mockImplementation(async (request: { operation: string }) => {
      if (request.operation === "evaluate_opportunity") {
        return {
          ok: true,
          result: {
            outcome: "proceed",
            reasons: ["平台经验匹配"],
            jdEvidence: ["建设高可用任务平台"],
            factIds: ["fact-1"]
          }
        };
      }
      if (request.operation === "generate_greeting") {
        return {
          ok: true,
          result: {
            greeting: "您好，看到贵司需要建设高可用任务平台，我此前负责过同类平台的稳定性设计与交付，希望进一步了解团队当前的任务规模与可靠性目标。",
            jdEvidence: ["建设高可用任务平台"],
            factIds: ["fact-1"]
          }
        };
      }
      return { ok: true };
    });
    await loadBackground();
  });

  it("uses the persisted JD for evaluation and greeting without creating a tab", async () => {
    const response = await dispatchRetry();

    expect(response).toEqual({ ok: true });
    const requests = backend.invokeModelGateway.mock.calls.map(([request]) => request as {
      operation: string;
      payload: { job?: { description?: string } };
    });
    expect(requests.map((request) => request.operation)).toEqual([
      "evaluate_opportunity",
      "generate_greeting"
    ]);
    expect(requests[0]?.payload.job?.description).toBe(failedOpportunity().description);
    expect(requests[1]?.payload.job?.description).toBe(failedOpportunity().description);
    expect(createTab).not.toHaveBeenCalled();
  });

  it.each([
    ["missing JD", failedOpportunity({ description: "" }), [activeProfile()], managedSettings(), true, "职位详情"],
    ["non-failed state", failedOpportunity({ status: "discovered" }), [activeProfile()], managedSettings(), true, "失败"],
    ["foreign ownership", failedOpportunity({ userId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }), [activeProfile()], managedSettings(), true, "当前账号"],
    ["missing profile", failedOpportunity(), [], managedSettings(), true, "画像"],
    ["no approved facts", failedOpportunity(), [{
      ...activeProfile(),
      facts: activeProfile().facts.map((fact) => ({ ...fact, approved: false }))
    }], managedSettings(), true, "可引用事实"],
    ["missing BYOK", failedOpportunity(), [activeProfile()], structuredClone(DEFAULT_SETTINGS), false, "BYOK"]
  ])("rejects %s before model processing", async (_label, opportunity, profiles, settings, hasKey, message) => {
    backend.listOpportunities.mockResolvedValue([opportunity]);
    backend.listResumeProfiles.mockResolvedValue(profiles);
    storage.loadSettings.mockResolvedValue(settings);
    storage.getByokKey.mockResolvedValue(hasKey ? "synthetic-key" : "");

    const response = await dispatchRetry();

    expect(response.ok).toBe(false);
    expect(response.error).toContain(message);
    expect(backend.invokeModelGateway).not.toHaveBeenCalled();
    expect(createTab).not.toHaveBeenCalled();
  });

  it("persists a bounded failure reason when downstream model processing fails", async () => {
    backend.invokeModelGateway.mockImplementation(async (request: { operation: string }) => {
      if (request.operation === "evaluate_opportunity") throw new Error("模型服务请求失败");
      if (request.operation === "record_failure") return { ok: true };
      throw new Error("unexpected operation");
    });

    const response = await dispatchRetry();

    expect(response).toEqual({ ok: false, error: "模型服务请求失败" });
    expect(backend.invokeModelGateway).toHaveBeenLastCalledWith(expect.objectContaining({
      operation: "record_failure",
      payload: { opportunityId, errorCode: "模型服务请求失败" }
    }), undefined);
    expect(createTab).not.toHaveBeenCalled();
  });

  it("rejects reviewed-send initiation from a content-script sender before backend access", async () => {
    const response = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      runtimeListener?.(
        {
          type: "PREPARE_REVIEWED_SEND",
          opportunityId,
          draftRevisionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          draftSha256: "a".repeat(64)
        },
        {
          id: "jobflow-extension-id",
          url: "https://www.liepin.com/a/1980000401.shtml"
        } as chrome.runtime.MessageSender,
        (value) => resolve(value as { ok: boolean; error?: string })
      );
    });

    expect(response).toEqual({ ok: false, error: "只能从扩展管理页发起人工确认发送" });
    expect(backend.listOpportunities).not.toHaveBeenCalled();
    expect(createTab).not.toHaveBeenCalled();
  });
});
