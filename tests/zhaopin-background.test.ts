import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../src/defaults";
import type { BatchRun, OpportunityRecord, ResumeProfile, ScanPreview } from "../src/types";

const backend = vi.hoisted(() => ({
  getAuthProjection: vi.fn(),
  invokeModelGateway: vi.fn(),
  upsertCandidates: vi.fn(),
  listOpportunities: vi.fn(),
  listCandidateIdentities: vi.fn(),
  getOpportunityByPlatform: vi.fn(),
  recordJobDetails: vi.fn(),
  loadActiveFilterConfig: vi.fn(),
  listResumeProfiles: vi.fn(),
  listEvaluations: vi.fn(),
  listOpportunityEvents: vi.fn(),
  listDrafts: vi.fn(),
  listDeliveryRecords: vi.fn()
}));

vi.mock("../src/backend/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/backend/supabase")>(),
  ...backend
}));

let runtimeListener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | undefined;
let alarmListener: ((alarm: chrome.alarms.Alarm) => void) | undefined;
let localData: Record<string, unknown>;

const userId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const jobId = "CCL1501502560J40877030814";

function candidate() {
  return {
    platform: "zhaopin" as const,
    jobId,
    url: "http://www.zhaopin.com/jobdetail/" + jobId + ".htm?sid=synthetic",
    canonicalUrl: "https://www.zhaopin.com/jobdetail/" + jobId + ".htm",
    title: "AI 平台工程师",
    company: "合成智联科技公司",
    location: "北京",
    salary: "20-30K",
    experience: "3-5年",
    education: "本科",
    cardText: "合成智联职位卡片",
    index: 0
  };
}

function opportunity(): OpportunityRecord {
  const item = candidate();
  return {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    userId,
    ...item,
    platformJobId: item.jobId,
    status: "discovered",
    firstSeenAt: "2026-09-17T00:00:00.000Z",
    lastSeenAt: "2026-09-17T00:00:01.000Z"
  };
}

function activeProfile(): ResumeProfile {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    version: 1,
    state: "active",
    sourceHash: "a".repeat(64),
    sourceName: "synthetic.txt",
    sourceKind: "text",
    analyzedAt: "2026-09-18T00:00:00.000Z",
    activatedAt: "2026-09-18T00:00:01.000Z",
    summary: "具备平台研发经验。",
    targetRoles: ["平台研发"],
    skills: ["TypeScript"],
    facts: [{
      id: "fact-1",
      text: "负责高可用任务平台。",
      keywords: ["高可用", "任务平台"],
      evidence: "负责高可用任务平台",
      approved: true
    }],
    constraints: []
  };
}

function storedDetailRun(): BatchRun {
  const item = candidate();
  return {
    id: "11111111-1111-4111-8111-111111111111",
    platform: "zhaopin",
    status: "running",
    sourceUrl: "https://www.zhaopin.com/sou/",
    executionPolicy: "automatic_send",
    authorizedAt: "2026-09-18T00:00:00.000Z",
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z",
    currentIndex: 0,
    items: [{ candidate: item, status: "queued", attempt: 0 }],
    draftCount: 0,
    excludedCount: 0,
    reviewCount: 0,
    failedCount: 0,
    deliverySucceededCount: 0,
    deliveryPartialCount: 0
  };
}

function storageGet(keys?: string | string[] | Record<string, unknown> | null): Record<string, unknown> {
  if (!keys) return { ...localData };
  if (typeof keys === "string") return { [keys]: localData[keys] };
  if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, localData[key]]));
  return Object.fromEntries(Object.keys(keys).map((key) => [key, localData[key] ?? keys[key]]));
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  runtimeListener = undefined;
  alarmListener = undefined;
  localData = { [STORAGE_KEYS.settings]: structuredClone(DEFAULT_SETTINGS) };
  backend.getAuthProjection.mockResolvedValue({
    status: "signed_in",
    userId,
    email: "candidate@example.invalid",
    emailVerificationStatus: "unverified",
    vip: false
  });
  backend.listOpportunities.mockResolvedValue([]);
  backend.listCandidateIdentities.mockImplementation(() => backend.listOpportunities());
  backend.getOpportunityByPlatform.mockImplementation(async (platform: string, jobId: string) =>
    (await backend.listOpportunities()).find((row: OpportunityRecord) => row.platform === platform && row.platformJobId === jobId) ?? null);
  backend.recordJobDetails.mockResolvedValue(undefined);
  backend.upsertCandidates.mockResolvedValue([opportunity()]);
  backend.loadActiveFilterConfig.mockResolvedValue(null);
  backend.listResumeProfiles.mockResolvedValue([]);
  backend.listEvaluations.mockResolvedValue([]);
  backend.listOpportunityEvents.mockResolvedValue([]);
  backend.listDrafts.mockResolvedValue([]);
  backend.listDeliveryRecords.mockResolvedValue([]);

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
      onAlarm: { addListener: vi.fn((listener) => { alarmListener = listener; }) },
      create: vi.fn(async () => undefined),
      clear: vi.fn(async () => true)
    },
    storage: {
      local: {
        get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => storageGet(keys)),
        set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(localData, value); }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete localData[key];
        }),
        setAccessLevel: vi.fn(async () => undefined)
      },
      session: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
        setAccessLevel: vi.fn(async () => undefined)
      }
    },
    tabs: {
      query: vi.fn(async () => [{ id: 7, url: "https://www.zhaopin.com/sou/" }]),
      create: vi.fn(),
      sendMessage: vi.fn(async () => ({
        sourceUrl: "https://www.zhaopin.com/sou/",
        candidates: [candidate()]
      }))
    },
    sidePanel: { open: vi.fn(), setPanelBehavior: vi.fn(async () => undefined) }
  });

  await import("../src/background");
});

it("scans a Zhaopin list through the shared background preview and storage path", async () => {
  const response = await new Promise<{ ok: boolean; data?: ScanPreview; error?: string }>((resolve) => {
    runtimeListener?.(
      { type: "SCAN_CURRENT_TAB" },
      { id: "jobflow-extension-id" } as chrome.runtime.MessageSender,
      (value) => resolve(value as { ok: boolean; data?: ScanPreview; error?: string })
    );
  });

  expect(response).toMatchObject({ ok: true });
  expect(response.data).toMatchObject({
    sourceUrl: "https://www.zhaopin.com/sou/",
    observedCount: 1,
    processableJobIds: [jobId],
    selectedJobIds: [jobId]
  });
  expect(response.data?.candidates[0]).toMatchObject({ platform: "zhaopin", jobId });
  expect(localData[STORAGE_KEYS.scanPreview]).toMatchObject({
    sourceUrl: "https://www.zhaopin.com/sou/",
    candidates: [{ platform: "zhaopin", jobId }]
  });
  expect(backend.upsertCandidates).toHaveBeenCalledWith([candidate()]);
});

it("turns a stale content-script channel into an actionable scan error", async () => {
  (chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
    new Error("Could not establish connection. Receiving end does not exist.")
  );

  const response = await new Promise<{ ok: boolean; data?: unknown; error?: string }>((resolve) => {
    runtimeListener?.(
      { type: "SCAN_CURRENT_TAB" },
      { id: "jobflow-extension-id" } as chrome.runtime.MessageSender,
      (value) => resolve(value as { ok: boolean; data?: unknown; error?: string })
    );
  });

  expect(response).toMatchObject({
    ok: false,
    error: "当前页面尚未加载 JobFlow 内容脚本，请先 Reload 扩展，再刷新当前招聘列表页后重试"
  });
});

it("reuses an existing Zhaopin detail instead of opening the site again", async () => {
  const run = storedDetailRun();
  const stored = {
    ...opportunity(),
    status: "failed" as const,
    description: "负责平台研发和稳定性建设，参与服务治理与工程效率改进。",
    recruiter: "合成招聘顾问",
    recruiterTitle: "招聘顾问"
  };
  localData[STORAGE_KEYS.run] = run;
  localData[STORAGE_KEYS.settings] = {
    ...structuredClone(DEFAULT_SETTINGS),
    model: { ...structuredClone(DEFAULT_SETTINGS.model), route: "managed" }
  };
  backend.listOpportunities.mockResolvedValue([stored]);
  backend.listResumeProfiles.mockResolvedValue([activeProfile()]);
  backend.invokeModelGateway.mockImplementation(async (request: { operation: string }) => {
    if (request.operation === "evaluate_opportunity") {
      return {
        ok: true,
        result: {
          outcome: "proceed",
          score: 86,
          reasons: ["平台经验匹配"],
          jdEvidence: ["负责平台研发和稳定性建设"],
          factIds: ["fact-1"]
        }
      };
    }
    if (request.operation === "generate_greeting") {
      return {
        ok: true,
        result: {
          greeting: "您好，我关注到贵司的平台研发岗位，过往负责过高可用任务平台和稳定性建设，希望结合这些经验进一步沟通岗位匹配度。",
          jdEvidence: ["负责平台研发和稳定性建设"],
          factIds: ["fact-1"]
        }
      };
    }
    return { ok: true };
  });

  alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);
  await vi.waitFor(() => expect((localData[STORAGE_KEYS.run] as BatchRun).status).toBe("completed"));

  expect(chrome.tabs.create).not.toHaveBeenCalled();
  expect(backend.recordJobDetails).not.toHaveBeenCalled();
  expect((localData[STORAGE_KEYS.run] as BatchRun).items[0]).toMatchObject({
    status: "draft_ready",
    opportunityId: stored.id
  });
});
