import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../src/defaults";
import type { OpportunityRecord, ScanPreview } from "../src/types";

const backend = vi.hoisted(() => ({
  getAuthProjection: vi.fn(),
  upsertCandidates: vi.fn(),
  listOpportunities: vi.fn(),
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
  localData = { [STORAGE_KEYS.settings]: structuredClone(DEFAULT_SETTINGS) };
  backend.getAuthProjection.mockResolvedValue({
    status: "signed_in",
    userId,
    email: "candidate@example.invalid",
    emailVerificationStatus: "unverified",
    vip: false
  });
  backend.listOpportunities.mockResolvedValue([]);
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
      onAlarm: { addListener: vi.fn() },
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
