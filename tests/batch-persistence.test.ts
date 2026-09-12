import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../src/defaults";
import { batchRunSchema } from "../src/domain/messages";
import type {
  BatchRun,
  DetailJob,
  ExtensionSettings,
  OpportunityRecord,
  ResumeProfile
} from "../src/types";

const backend = vi.hoisted(() => ({
  getAuthProjection: vi.fn(),
  invokeModelGateway: vi.fn(),
  listDeliveryRecords: vi.fn(),
  listDrafts: vi.fn(),
  listEvaluations: vi.fn(),
  listOpportunities: vi.fn(),
  listOpportunityEvents: vi.fn(),
  listResumeProfiles: vi.fn(),
  recordJobDetails: vi.fn()
}));

vi.mock("../src/backend/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/backend/supabase")>(),
  ...backend
}));

const userId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const opportunityId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const leaseId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
let runtimeListener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | undefined;
let localData: Record<string, unknown>;

function candidate(jobId: string, index: number) {
  return {
    platform: "liepin" as const,
    jobId,
    url: "https://www.liepin.com/job/" + jobId + ".shtml",
    canonicalUrl: "https://www.liepin.com/job/" + jobId + ".shtml",
    title: "合成职位 " + jobId,
    company: "合成公司",
    location: "北京",
    salary: "20-30k",
    experience: "3年",
    education: "本科",
    cardText: "合成职位卡片",
    index
  };
}

function detailJob(description: string): DetailJob {
  return {
    ...candidate("1980000401", 0),
    description,
    recruiter: "陈女士",
    recruiterTitle: "招聘顾问"
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

function opportunity(): OpportunityRecord {
  return {
    id: opportunityId,
    userId,
    platform: "liepin",
    platformJobId: "1980000401",
    canonicalUrl: "https://www.liepin.com/job/1980000401.shtml",
    title: "合成职位 1980000401",
    company: "合成公司",
    location: "北京",
    salary: "20-30k",
    experience: "3年",
    education: "本科",
    cardText: "合成职位卡片",
    status: "discovered",
    firstSeenAt: "2026-09-11T00:00:00.000Z",
    lastSeenAt: "2026-09-11T00:00:01.000Z"
  };
}

function runningBatch(): BatchRun {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    platform: "liepin",
    status: "running",
    sourceUrl: "https://www.liepin.com/zhaopin/",
    createdAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
    currentIndex: 0,
    items: [
      {
        candidate: candidate("1980000401", 0),
        status: "opening",
        tabId: 101,
        leaseId,
        attempt: 1
      },
      {
        candidate: candidate("1980000402", 1),
        status: "queued",
        attempt: 0
      }
    ],
    draftCount: 0,
    excludedCount: 0,
    reviewCount: 0,
    failedCount: 0
  };
}

function settings(overrides: Partial<ExtensionSettings["rules"]> = {}): ExtensionSettings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    rules: {
      ...structuredClone(DEFAULT_SETTINGS.rules),
      ...overrides
    }
  };
}

function getStorageSubset(keys?: string | string[] | Record<string, unknown> | null): Record<string, unknown> {
  if (!keys) return { ...localData };
  if (typeof keys === "string") return { [keys]: localData[keys] };
  if (Array.isArray(keys)) {
    return Object.fromEntries(keys.map((key) => [key, localData[key]]));
  }
  return Object.fromEntries(Object.keys(keys).map((key) => [key, localData[key] ?? keys[key]]));
}

async function loadBackground(): Promise<void> {
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
        get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => getStorageSubset(keys)),
        set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(localData, value); }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete localData[key];
        }),
        setAccessLevel: vi.fn(async () => undefined)
      },
      session: {
        get: vi.fn(async () => ({})),
        remove: vi.fn(async () => undefined),
        setAccessLevel: vi.fn(async () => undefined)
      }
    },
    sidePanel: { open: vi.fn(), setPanelBehavior: vi.fn(async () => undefined) },
    tabs: {
      create: vi.fn(),
      query: vi.fn(async () => []),
      remove: vi.fn(async () => undefined),
      get: vi.fn(async () => undefined),
      sendMessage: vi.fn()
    }
  });
  await import("../src/background");
  expect(runtimeListener).toBeTypeOf("function");
}

async function dispatchDetail(job: DetailJob): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    runtimeListener?.(
      { type: "DETAIL_READY", leaseId, job },
      {} as chrome.runtime.MessageSender,
      (response) => resolve(response as { ok: boolean; error?: string })
    );
  });
}

describe("batch run persistence", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    runtimeListener = undefined;
    localData = {
      [STORAGE_KEYS.run]: runningBatch(),
      [STORAGE_KEYS.settings]: settings()
    };
    backend.getAuthProjection.mockResolvedValue({
      status: "signed_in",
      userId,
      email: "candidate@example.invalid",
      emailVerificationStatus: "unverified",
      vip: true
    });
    backend.invokeModelGateway.mockResolvedValue({ ok: true });
    backend.listDeliveryRecords.mockResolvedValue([]);
    backend.listDrafts.mockResolvedValue([]);
    backend.listEvaluations.mockResolvedValue([]);
    backend.listOpportunities.mockResolvedValue([opportunity()]);
    backend.listOpportunityEvents.mockResolvedValue([]);
    backend.listResumeProfiles.mockResolvedValue([]);
    backend.recordJobDetails.mockResolvedValue(undefined);
    await loadBackground();
  });

  it("keeps detail fields out of the stored batch candidate when the first item needs review", async () => {
    const response = await dispatchDetail(detailJob("负责建设高可用任务平台和稳定性体系。"));

    expect(response).toEqual({ ok: true });
    const parsed = batchRunSchema.safeParse(localData[STORAGE_KEYS.run]);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({
      status: "running",
      currentIndex: 1,
      reviewCount: 1
    });
    expect(parsed.data?.items[0]).toMatchObject({ status: "review_required" });
    expect(parsed.data?.items[1]).toMatchObject({ status: "queued" });
    expect(parsed.data?.items[0]?.candidate).not.toHaveProperty("description");
    expect(parsed.data?.items[0]?.candidate).not.toHaveProperty("recruiter");
    expect(parsed.data?.items[0]?.candidate).not.toHaveProperty("recruiterTitle");
  });

  it("persists an excluded first item without blocking the second queued item", async () => {
    localData[STORAGE_KEYS.settings] = settings({ travel: "none" });
    backend.listResumeProfiles.mockResolvedValue([activeProfile()]);

    const response = await dispatchDetail(detailJob("岗位要求：必须接受长期出差。"));

    expect(response).toEqual({ ok: true });
    const parsed = batchRunSchema.safeParse(localData[STORAGE_KEYS.run]);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({
      status: "running",
      currentIndex: 1,
      excludedCount: 1
    });
    expect(parsed.data?.items[0]).toMatchObject({ status: "excluded" });
    expect(parsed.data?.items[1]).toMatchObject({ status: "queued" });
    expect(parsed.data?.items[0]?.candidate).not.toHaveProperty("description");
  });
});
