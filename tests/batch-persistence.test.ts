import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../src/defaults";
import { batchRunSchema } from "../src/domain/messages";
import { sourceHash } from "../src/resume";
import type {
  BatchRun,
  DeliveryRecord,
  DetailJob,
  MessageDraft,
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
  markReviewedDeliveryWriteStarted: vi.fn(),
  prepareReviewedDelivery: vi.fn(),
  recordJobDetails: vi.fn(),
  recordReviewedDeliveryAttempt: vi.fn(),
  releaseReviewedDeliveryQuota: vi.fn(),
  reserveReviewedDeliveryQuota: vi.fn()
}));

vi.mock("../src/backend/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/backend/supabase")>(),
  ...backend
}));

const userId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const opportunityId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const leaseId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
let runtimeListener: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean) | undefined;
let alarmListener: ((alarm: chrome.alarms.Alarm) => void) | undefined;
let startupListener: (() => void) | undefined;
let installedListener: (() => void) | undefined;
let localData: Record<string, unknown>;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

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

function draft(): MessageDraft {
  return {
    opportunityId,
    currentText: "您好，我关注到这个合成职位与高可用任务平台建设经验匹配，过往负责过相关平台稳定性治理，想进一步沟通岗位匹配度。",
    revisions: [{
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      kind: "generated",
      text: "您好，我关注到这个合成职位与高可用任务平台建设经验匹配，过往负责过相关平台稳定性治理，想进一步沟通岗位匹配度。",
      createdAt: "2026-09-11T00:00:02.000Z",
      jdEvidence: ["负责建设高可用任务平台"],
      factIds: ["fact-1"]
    }],
    updatedAt: "2026-09-11T00:00:02.000Z"
  };
}

function delivery(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    opportunityId,
    platform: "liepin",
    platformJobId: "1980000401",
    resumeMode: "platform_default",
    overallStatus: "ready",
    applicationStatus: "pending",
    greetingStatus: "pending",
    draftRevisionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    draftSha256: "a".repeat(64),
    updatedAt: "2026-09-11T00:00:02.000Z",
    ...overrides
  };
}

function runningBatch(): BatchRun {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    platform: "liepin",
    status: "running",
    sourceUrl: "https://www.liepin.com/zhaopin/",
    executionPolicy: "reviewed_send",
    authorizedAt: "2026-09-11T00:00:00.000Z",
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
    failedCount: 0,
    deliverySucceededCount: 0,
    deliveryPartialCount: 0
  };
}

function settings(overrides: Partial<ExtensionSettings["rules"]> = {}, rootOverrides: Partial<ExtensionSettings> = {}): ExtensionSettings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...rootOverrides,
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
      onStartup: { addListener: vi.fn((listener) => { startupListener = listener; }) },
      onInstalled: { addListener: vi.fn((listener) => { installedListener = listener; }) },
      sendMessage: vi.fn(async () => undefined)
    },
    alarms: {
      onAlarm: { addListener: vi.fn((listener) => { alarmListener = listener; }) },
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
      reload: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      update: vi.fn(async () => undefined),
      get: vi.fn(async () => undefined),
      sendMessage: vi.fn()
    }
  });
  await import("../src/background");
  expect(runtimeListener).toBeTypeOf("function");
}

async function dispatchDetail(job: DetailJob): Promise<{ ok: boolean; error?: string }> {
  return dispatchDetailWithLease(job, leaseId);
}

async function dispatchDetailWithLease(job: DetailJob, targetLeaseId: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    runtimeListener?.(
      { type: "DETAIL_READY", leaseId: targetLeaseId, job },
      {} as chrome.runtime.MessageSender,
      (response) => resolve(response as { ok: boolean; error?: string })
    );
  });
}

async function dispatchRuntime(
  message: unknown,
  sender: chrome.runtime.MessageSender
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  return new Promise((resolve) => {
    runtimeListener?.(message, sender, (response) => resolve(response as { ok: boolean; data?: unknown; error?: string }));
  });
}

function liepinContentSender(
  overrides: Partial<chrome.runtime.MessageSender> = {}
): chrome.runtime.MessageSender {
  return {
    id: "jobflow-extension-id",
    url: "https://www.liepin.com/a/1980000401.shtml",
    tab: { id: 101 } as chrome.tabs.Tab,
    ...overrides
  } as chrome.runtime.MessageSender;
}

function automaticRunningBatch(status: BatchRun["items"][number]["status"] = "opening"): BatchRun {
  const run = runningBatch();
  run.executionPolicy = "automatic_send";
  const hasDraftIdentity = ["delivery_ready", "waiting_interval", "delivery_preflighting", "delivery_in_progress"].includes(status);
  run.items = [{
    ...run.items[0]!,
    status,
    tabId: 101,
    leaseId,
    opportunityId: hasDraftIdentity ? opportunityId : undefined,
    draftRevisionId: hasDraftIdentity ? "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" : undefined,
    draftSha256: hasDraftIdentity ? "a".repeat(64) : undefined
  }];
  return run;
}

function mockProceedingModel(): void {
  backend.invokeModelGateway.mockImplementation(async (request: { operation: string }) => {
    if (request.operation === "evaluate_opportunity") {
      return {
        ok: true,
        result: {
          outcome: "proceed",
          score: 88,
          reasons: ["平台经验匹配"],
          jdEvidence: ["负责建设高可用任务平台"],
          factIds: ["fact-1"]
        }
      };
    }
    if (request.operation === "generate_greeting") {
      return {
        ok: true,
        result: {
          greeting: draft().currentText,
          jdEvidence: ["负责建设高可用任务平台"],
          factIds: ["fact-1"]
        }
      };
    }
    return { ok: true };
  });
}

function modelOperations(): string[] {
  return backend.invokeModelGateway.mock.calls.map(([request]) =>
    (request as { operation?: string }).operation ?? ""
  );
}

describe("batch run persistence", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    runtimeListener = undefined;
    alarmListener = undefined;
    startupListener = undefined;
    installedListener = undefined;
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
    backend.markReviewedDeliveryWriteStarted.mockResolvedValue(undefined);
    backend.prepareReviewedDelivery.mockResolvedValue(delivery());
    backend.recordJobDetails.mockResolvedValue(undefined);
    backend.recordReviewedDeliveryAttempt.mockImplementation(async (input: { eventKind: string; component?: string; status?: string; reason?: string }) => {
      if (input.eventKind === "application_verified") return delivery({ applicationStatus: "verified", greetingStatus: "attempted", overallStatus: "partial" });
      if (input.eventKind === "greeting_verified") return delivery({ applicationStatus: "verified", greetingStatus: "verified", overallStatus: "succeeded" });
      if (input.eventKind === "delivery_review_required") return delivery({ overallStatus: "review_required", latestReason: input.reason });
      return delivery();
    });
    backend.releaseReviewedDeliveryQuota.mockResolvedValue(true);
    backend.reserveReviewedDeliveryQuota.mockResolvedValue("ffffffff-ffff-4fff-8fff-ffffffffffff");
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

  it("returns the current extension-owned detail lease for an exact Liepin content handshake", async () => {
    const response = await dispatchRuntime({
      type: "DETAIL_PAGE_READY",
      jobId: "1980000401"
    }, liepinContentSender());

    expect(response).toEqual({ ok: true, data: leaseId });
    expect(backend.invokeModelGateway).not.toHaveBeenCalled();
    expect(backend.reserveReviewedDeliveryQuota).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ type: "CONTENT_REVIEWED_SEND_EXECUTE" })
    );
  });

  it("returns the current lease to an exact Liepin risk redirect backurl", async () => {
    const response = await dispatchRuntime({
      type: "DETAIL_PAGE_READY",
      jobId: "1980000401"
    }, liepinContentSender({
      url: "https://safe.liepin.com/v/intercept/verifysms?backurl=https%3A%2F%2Fwww.liepin.com%2Fjob%2F1980000401.shtml"
    }));

    expect(response).toEqual({ ok: true, data: leaseId });
    expect(backend.invokeModelGateway).not.toHaveBeenCalled();
    expect(backend.reserveReviewedDeliveryQuota).not.toHaveBeenCalled();
  });

  it("rejects non-current or untrusted detail lease handshakes without side effects", async () => {
    const cases: Array<{
      label: string;
      sender: chrome.runtime.MessageSender;
      jobId: string;
      mutateRun?: (run: BatchRun) => BatchRun;
    }> = [
      { label: "wrong tab", sender: liepinContentSender({ tab: { id: 999 } as chrome.tabs.Tab }), jobId: "1980000401" },
      { label: "wrong job", sender: liepinContentSender(), jobId: "1980000999" },
      { label: "wrong origin", sender: liepinContentSender({ url: "https://example.invalid/a/1980000401.shtml" }), jobId: "1980000401" },
      { label: "options caller", sender: { id: "jobflow-extension-id", url: "chrome-extension://jobflow-extension-id/options.html" } as chrome.runtime.MessageSender, jobId: "1980000401" },
      {
        label: "cancelled run",
        sender: liepinContentSender(),
        jobId: "1980000401",
        mutateRun: (run) => ({ ...run, status: "cancelled" })
      },
      {
        label: "historical item",
        sender: liepinContentSender(),
        jobId: "1980000401",
        mutateRun: (run) => ({ ...run, currentIndex: 1 })
      }
    ];

    for (const testCase of cases) {
      vi.clearAllMocks();
      localData[STORAGE_KEYS.run] = testCase.mutateRun ? testCase.mutateRun(runningBatch()) : runningBatch();
      const response = await dispatchRuntime({
        type: "DETAIL_PAGE_READY",
        jobId: testCase.jobId
      }, testCase.sender);

      expect(response, testCase.label).toEqual({ ok: true, data: null });
      expect(backend.invokeModelGateway).not.toHaveBeenCalled();
      expect(backend.reserveReviewedDeliveryQuota).not.toHaveBeenCalled();
      expect(chrome.tabs.sendMessage).not.toHaveBeenCalledWith(
        expect.any(Number),
        expect.objectContaining({ type: "CONTENT_REVIEWED_SEND_EXECUTE" })
      );
    }
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

  it("starts a run only from the exact sidepanel sender and snapshots the selected policy", async () => {
    const scanPreview = {
      sourceUrl: "https://www.liepin.com/zhaopin/",
      candidates: [candidate("1980000401", 0), candidate("1980000402", 1)],
      observedCount: 2,
      newCount: 2,
      duplicateCount: 0,
      excludedCount: 0,
      draftedCount: 0,
      processableJobIds: ["1980000401", "1980000402"],
      selectedJobIds: ["1980000401", "1980000402"]
    };
    localData[STORAGE_KEYS.run] = undefined;
    localData[STORAGE_KEYS.scanPreview] = scanPreview;
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "automatic_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" }
    });
    backend.listResumeProfiles.mockResolvedValue([activeProfile()]);

    const command = {
      type: "START_BATCH",
      selectedJobIds: ["1980000402"],
      expectedExecutionPolicy: "automatic_send"
    };
    await expect(dispatchRuntime(command, {
      id: "jobflow-extension-id",
      url: "chrome-extension://jobflow-extension-id/options.html"
    } as chrome.runtime.MessageSender)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("侧边栏")
    });

    const response = await dispatchRuntime(command, {
      id: "jobflow-extension-id",
      url: "chrome-extension://jobflow-extension-id/sidepanel.html"
    } as chrome.runtime.MessageSender);
    expect(response).toMatchObject({ ok: true });
    const parsed = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    expect(parsed).toMatchObject({
      executionPolicy: "automatic_send",
      currentIndex: 0,
      deliverySucceededCount: 0,
      deliveryPartialCount: 0
    });
    expect(parsed.authorizedAt).toMatch(/T/);
    expect(parsed.items.map((item) => item.candidate.jobId)).toEqual(["1980000402"]);
  });

  it("rejects a batch start when the expected policy no longer matches settings", async () => {
    localData[STORAGE_KEYS.run] = undefined;
    localData[STORAGE_KEYS.scanPreview] = {
      sourceUrl: "https://www.liepin.com/zhaopin/",
      candidates: [candidate("1980000401", 0)],
      observedCount: 1,
      newCount: 1,
      duplicateCount: 0,
      excludedCount: 0,
      draftedCount: 0,
      processableJobIds: ["1980000401"],
      selectedJobIds: ["1980000401"]
    };
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "reviewed_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" }
    });
    backend.listResumeProfiles.mockResolvedValue([activeProfile()]);

    const response = await dispatchRuntime({
      type: "START_BATCH",
      selectedJobIds: ["1980000401"],
      expectedExecutionPolicy: "automatic_send"
    }, {
      id: "jobflow-extension-id",
      url: "chrome-extension://jobflow-extension-id/sidepanel.html"
    } as chrome.runtime.MessageSender);

    expect(response).toMatchObject({
      ok: false,
      error: expect.stringContaining("执行策略")
    });
    expect(localData[STORAGE_KEYS.run]).toBeUndefined();
  });

  it("rejects a new batch start while an active run already exists", async () => {
    const existing = {
      ...runningBatch(),
      id: "11111111-1111-4111-8111-111111111111",
      executionPolicy: "automatic_send" as const
    };
    localData[STORAGE_KEYS.run] = existing;
    localData[STORAGE_KEYS.scanPreview] = {
      sourceUrl: "https://www.liepin.com/zhaopin/",
      candidates: [candidate("1980000401", 0)],
      observedCount: 1,
      newCount: 1,
      duplicateCount: 0,
      excludedCount: 0,
      draftedCount: 0,
      processableJobIds: ["1980000401"],
      selectedJobIds: ["1980000401"]
    };
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "automatic_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" }
    });
    backend.listResumeProfiles.mockResolvedValue([activeProfile()]);

    const response = await dispatchRuntime({
      type: "START_BATCH",
      selectedJobIds: ["1980000401"],
      expectedExecutionPolicy: "automatic_send"
    }, {
      id: "jobflow-extension-id",
      url: "chrome-extension://jobflow-extension-id/sidepanel.html"
    } as chrome.runtime.MessageSender);

    expect(response).toMatchObject({
      ok: false,
      error: expect.stringContaining("已有批次")
    });
    expect(localData[STORAGE_KEYS.run]).toEqual(existing);
  });

  it("automatically delivers only a same-batch generated draft and persists the next write throttle", async () => {
    localData[STORAGE_KEYS.run] = automaticRunningBatch("opening");
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "automatic_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" },
      automaticSendDelayMinSeconds: 5,
      automaticSendDelayMaxSeconds: 5
    });
    backend.listResumeProfiles.mockResolvedValue([activeProfile()]);
    backend.listOpportunities.mockResolvedValue([{ ...opportunity(), status: "draft_ready" }]);
    backend.listDrafts.mockResolvedValue([draft()]);
    mockProceedingModel();
    (chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId: number, message: { type?: string }) => {
      if (message.type === "CONTENT_REVIEWED_SEND_PREFLIGHT") {
        return { ok: true, platformJobId: "1980000401", resumeMode: "platform_default", actionTier: "primary" };
      }
      if (message.type === "CONTENT_REVIEWED_SEND_EXECUTE") {
        return { ok: true, application: "verified", greeting: "verified", evidenceCodes: ["application_status_verified", "outbound_greeting_exact_match"] };
      }
      return undefined;
    });

    const response = await dispatchDetail(detailJob("岗位职责：负责建设高可用任务平台和稳定性体系。"));
    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);
    await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).status).toBe("completed"));

    expect(response).toEqual({ ok: true });
    const parsed = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    expect(parsed.status).toBe("completed");
    expect(parsed.deliverySucceededCount).toBe(1);
    expect(parsed.items[0]).toMatchObject({
      status: "delivery_succeeded",
      opportunityId,
      draftRevisionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    });
    expect(parsed.items[0]?.draftSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(backend.reserveReviewedDeliveryQuota).toHaveBeenCalledOnce();
    expect(backend.markReviewedDeliveryWriteStarted).toHaveBeenCalledOnce();
    expect(backend.recordReviewedDeliveryAttempt).toHaveBeenCalledWith(expect.objectContaining({
      eventKind: "delivery_confirmed",
      evidenceCode: "automatic_batch_authorized",
      evidence: { source: "sidepanel_batch" }
    }));
    expect(localData[STORAGE_KEYS.automaticWriteThrottle]).toMatchObject({
      ownerId: userId,
      platform: "liepin",
      scheduledDelaySeconds: 5
    });
  });

  it("treats a greeting click as completion for an unresolved application in automatic mode", async () => {
    const run = automaticRunningBatch("delivery_ready");
    run.items[0]!.draftSha256 = await sourceHash(draft().currentText);
    localData[STORAGE_KEYS.run] = run;
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "automatic_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" },
      automaticSendDelayMinSeconds: 5,
      automaticSendDelayMaxSeconds: 5
    });
    backend.listDrafts.mockResolvedValue([draft()]);
    backend.listOpportunities.mockResolvedValue([{ ...opportunity(), status: "draft_ready" }]);
    let latestDelivery = delivery();
    backend.recordReviewedDeliveryAttempt.mockImplementation(async (input: { eventKind: string; evidenceCode?: string; reason?: string }) => {
      if (input.eventKind === "application_attempted") {
        latestDelivery = delivery({ applicationStatus: "attempted", greetingStatus: "pending", overallStatus: "in_progress" });
      }
      if (input.eventKind === "greeting_attempted") {
        latestDelivery = delivery({ applicationStatus: "attempted", greetingStatus: "attempted", overallStatus: "in_progress" });
      }
      if (input.eventKind === "application_verified") {
        latestDelivery = delivery({
          applicationStatus: "verified",
          greetingStatus: "attempted",
          overallStatus: "partial",
          latestReason: input.reason
        });
      }
      if (input.eventKind === "greeting_verified") {
        latestDelivery = delivery({
          applicationStatus: "verified",
          greetingStatus: "verified",
          overallStatus: "succeeded",
          latestReason: input.reason
        });
      }
      return latestDelivery;
    });
    (chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId: number, message: { type?: string }) => {
      if (message.type === "CONTENT_REVIEWED_SEND_PREFLIGHT") {
        return { ok: true, platformJobId: "1980000401", resumeMode: "platform_default", actionTier: "primary" };
      }
      if (message.type === "CONTENT_REVIEWED_SEND_EXECUTE") {
        return {
          ok: false,
          application: "attempted",
          greeting: "verified",
          evidenceCodes: ["native_action_attempted", "outbound_greeting_exact_match", "greeting_send_clicked"]
        };
      }
      return undefined;
    });

    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);
    await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).status).toBe("completed"));

    const completed = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    expect(completed.deliverySucceededCount).toBe(1);
    expect(completed.deliveryPartialCount).toBe(0);
    expect(completed.items[0]).toMatchObject({ status: "delivery_succeeded" });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(101, expect.objectContaining({
      type: "CONTENT_REVIEWED_SEND_EXECUTE",
      assumeClickSuccess: true
    }));
    expect(backend.recordReviewedDeliveryAttempt).toHaveBeenCalledWith(expect.objectContaining({
      eventKind: "application_verified",
      evidenceCode: "application_greeting_click_assumed_success",
      reason: "已点击猎聘招呼语发送控件，按开发阶段策略将投递并联系计为已发送（未等待页面回读）；招呼语已从猎聘页面验证"
    }));
    expect(backend.recordReviewedDeliveryAttempt).toHaveBeenCalledWith(expect.objectContaining({
      eventKind: "greeting_verified",
      evidenceCode: "outbound_greeting_exact_match",
      reason: "已点击猎聘招呼语发送控件，按开发阶段策略将投递并联系计为已发送（未等待页面回读）；招呼语已从猎聘页面验证"
    }));
  });

  it("names the missing application evidence when greeting evidence is verified", async () => {
    const run = automaticRunningBatch("delivery_ready");
    run.items[0]!.draftSha256 = await sourceHash(draft().currentText);
    localData[STORAGE_KEYS.run] = run;
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "automatic_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" },
      automaticSendDelayMinSeconds: 5,
      automaticSendDelayMaxSeconds: 5
    });
    backend.listDrafts.mockResolvedValue([draft()]);
    backend.listOpportunities.mockResolvedValue([{ ...opportunity(), status: "draft_ready" }]);
    let latestDelivery = delivery();
    backend.recordReviewedDeliveryAttempt.mockImplementation(async (input: { eventKind: string }) => {
      if (input.eventKind === "application_attempted") {
        latestDelivery = delivery({
          applicationStatus: "attempted",
          greetingStatus: "pending",
          overallStatus: "in_progress",
          latestReason: "正式投递已尝试，尚未取得独立平台证据"
        });
      }
      if (input.eventKind === "greeting_attempted") {
        latestDelivery = delivery({
          applicationStatus: "attempted",
          greetingStatus: "attempted",
          overallStatus: "in_progress",
          latestReason: "招呼语已尝试，尚未取得独立平台证据"
        });
      }
      if (input.eventKind === "greeting_verified") {
        latestDelivery = delivery({
          applicationStatus: "attempted",
          greetingStatus: "verified",
          overallStatus: "partial",
          latestReason: "招呼语已从猎聘页面验证"
        });
      }
      return latestDelivery;
    });
    (chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId: number, message: { type?: string }) => {
      if (message.type === "CONTENT_REVIEWED_SEND_PREFLIGHT") {
        return { ok: true, platformJobId: "1980000401", resumeMode: "platform_default", actionTier: "primary" };
      }
      if (message.type === "CONTENT_REVIEWED_SEND_EXECUTE") {
        return {
          ok: false,
          application: "attempted",
          greeting: "verified",
          evidenceCodes: ["native_action_attempted", "outbound_greeting_exact_match"]
        };
      }
      return undefined;
    });

    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);
    await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).status).toBe("paused"));

    const paused = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    expect(paused.items[0]).toMatchObject({ status: "delivery_partial", blockerCode: "component_unverified" });
    expect(paused.pauseReason).toBe("正式投递已尝试，尚未取得独立平台证据；招呼语已从猎聘页面验证");
  });

  it("recovers an extracting projection when the exact automatic draft identity still exists", async () => {
    const run = automaticRunningBatch("delivery_ready");
    run.items[0]!.draftSha256 = await sourceHash(draft().currentText);
    localData[STORAGE_KEYS.run] = run;
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "automatic_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" }
    });
    backend.listDrafts.mockResolvedValue([draft()]);
    backend.listOpportunities.mockResolvedValue([{ ...opportunity(), status: "extracting" }]);
    (chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId: number, message: { type?: string }) => {
      if (message.type === "CONTENT_REVIEWED_SEND_PREFLIGHT") {
        return { ok: true, platformJobId: "1980000401", resumeMode: "platform_default", actionTier: "primary" };
      }
      if (message.type === "CONTENT_REVIEWED_SEND_EXECUTE") {
        return { ok: true, application: "verified", greeting: "verified", evidenceCodes: ["application_status_verified", "outbound_greeting_exact_match"] };
      }
      return undefined;
    });

    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);

    await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).status).toBe("completed"));
    expect(backend.prepareReviewedDelivery).toHaveBeenCalledWith(
      opportunityId,
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      await sourceHash(draft().currentText)
    );
    expect(backend.markReviewedDeliveryWriteStarted).toHaveBeenCalledOnce();
  });

  it("pauses an automatic batch before quota when final preflight is blocked", async () => {
    const run = automaticRunningBatch("delivery_ready");
    run.items[0]!.draftSha256 = await sourceHash(draft().currentText);
    localData[STORAGE_KEYS.run] = run;
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "automatic_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" }
    });
    backend.listDrafts.mockResolvedValue([draft()]);
    backend.listOpportunities.mockResolvedValue([{ ...opportunity(), status: "draft_ready" }]);
    (chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      platformJobId: "1980000401",
      resumeMode: "platform_default",
      blocker: "login_required",
      reason: "猎聘页面需要登录"
    });

    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);
    await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).status).toBe("paused"));

    const parsed = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    expect(parsed.currentIndex).toBe(0);
    expect(parsed.pauseReason).toContain("猎聘页面需要登录");
    expect(parsed.items[0]).toMatchObject({
      status: "blocked",
      blockerPhase: "pre_write",
      blockerCode: "login_required"
    });
    expect(backend.reserveReviewedDeliveryQuota).not.toHaveBeenCalled();
  });

  it("waits on a persisted owner/platform throttle without redrawing a delay", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    localData[STORAGE_KEYS.run] = automaticRunningBatch("delivery_ready");
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "automatic_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" }
    });
    localData[STORAGE_KEYS.automaticWriteThrottle] = {
      ownerId: userId,
      platform: "liepin",
      lastWriteStartedAt: new Date().toISOString(),
      scheduledDelaySeconds: 33,
      nextWriteEligibleAt: future
    };

    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);
    await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).items[0]?.status).toBe("waiting_interval"));

    expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).nextWriteEligibleAt).toBe(future);
    expect(chrome.alarms.create).toHaveBeenCalledWith(expect.stringContaining("jobflow:auto-write:"), {
      when: new Date(future).getTime()
    });
    expect(backend.reserveReviewedDeliveryQuota).not.toHaveBeenCalled();
  });

  it("pauses an active automatic batch on startup instead of resuming live work", async () => {
    localData[STORAGE_KEYS.run] = automaticRunningBatch("delivery_ready");

    startupListener?.();
    await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).status).toBe("paused"));

    expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).pauseReason).toContain("重启");
    expect(chrome.alarms.create).not.toHaveBeenCalledWith("jobflow:queue", expect.anything());
  });

  it("pauses automatic detail failures without advancing while reviewed batches still continue", async () => {
    localData[STORAGE_KEYS.run] = automaticRunningBatch("opening");

    const automaticResponse = await dispatchRuntime({
      type: "DETAIL_FAILED",
      code: "dom_timeout",
      jobId: "1980000401",
      leaseId,
      error: "详情页读取超时"
    }, liepinContentSender());

    expect(automaticResponse).toEqual({ ok: true });
    const automatic = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    expect(automatic).toMatchObject({
      status: "paused",
      currentIndex: 0,
      pauseReason: "详情页读取超时"
    });
    expect(automatic.items[0]).toMatchObject({
      status: "blocked",
      blockerPhase: "pre_write",
      blockerCode: "detail_unavailable"
    });
    expect(chrome.tabs.remove).toHaveBeenCalledWith(101);

    vi.clearAllMocks();
    localData[STORAGE_KEYS.run] = runningBatch();
    const reviewedResponse = await dispatchRuntime({
      type: "DETAIL_FAILED",
      code: "dom_timeout",
      jobId: "1980000401",
      leaseId,
      error: "详情页读取超时"
    }, liepinContentSender());

    expect(reviewedResponse).toEqual({ ok: true });
    const reviewed = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    expect(reviewed).toMatchObject({
      status: "running",
      currentIndex: 1,
      failedCount: 1
    });
    expect(reviewed.items[0]).toMatchObject({ status: "failed" });
  });

  it("keeps and activates an exact risk-verification tab when automatic detail reading is blocked", async () => {
    localData[STORAGE_KEYS.run] = automaticRunningBatch("opening");

    const response = await dispatchRuntime({
      type: "DETAIL_FAILED",
      code: "risk_control",
      jobId: "1980000401",
      leaseId,
      error: "猎聘详情页需要安全验证"
    }, liepinContentSender({
      url: "https://safe.liepin.com/intercept/user/dispatch?backurl=https%3A%2F%2Fwww.liepin.com%2Fjob%2F1980000401.shtml"
    }));

    expect(response).toEqual({ ok: true });
    const paused = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    expect(paused).toMatchObject({
      status: "paused",
      currentIndex: 0,
      pauseReason: "猎聘详情页需要安全验证"
    });
    expect(paused.items[0]).toMatchObject({
      status: "blocked",
      blockerPhase: "pre_write",
      blockerCode: "risk_control"
    });
    expect(paused.items[0]?.tabId).toBeUndefined();
    expect(paused.items[0]?.leaseId).toBeUndefined();
    expect(chrome.tabs.update).toHaveBeenCalledWith(101, { active: true });
    expect(chrome.tabs.remove).not.toHaveBeenCalledWith(101);
    expect(backend.reserveReviewedDeliveryQuota).not.toHaveBeenCalled();
  });

  it("waits for a persisted Liepin navigation cooldown before opening another detail", async () => {
    const run = runningBatch();
    run.items[0] = {
      ...run.items[0]!,
      status: "queued",
      tabId: undefined,
      leaseId: undefined
    };
    localData[STORAGE_KEYS.run] = run;
    const nextNavigationEligibleAt = new Date(Date.now() + 30_000).toISOString();
    localData[STORAGE_KEYS.liepinNavigationThrottle] = {
      ownerId: userId,
      platform: "liepin",
      lastNavigationStartedAt: new Date().toISOString(),
      scheduledDelaySeconds: 30,
      nextNavigationEligibleAt
    };

    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);

    await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).items[0]?.status).toBe("waiting_navigation"));
    const waiting = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    expect(waiting.nextNavigationEligibleAt).toBe(nextNavigationEligibleAt);
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(chrome.alarms.create).toHaveBeenCalledWith("jobflow:queue", {
      when: new Date(nextNavigationEligibleAt).getTime()
    });
    expect(localData[STORAGE_KEYS.liepinNavigationThrottle]).toMatchObject({
      nextNavigationEligibleAt
    });
  });

  it("persists the next navigation cooldown before opening the first detail", async () => {
    const run = runningBatch();
    run.items[0] = {
      ...run.items[0]!,
      status: "queued",
      tabId: undefined,
      leaseId: undefined
    };
    localData[STORAGE_KEYS.run] = run;
    (chrome.tabs.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 401 });

    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);

    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledOnce());
    const throttle = localData[STORAGE_KEYS.liepinNavigationThrottle] as {
      scheduledDelaySeconds: number;
      nextNavigationEligibleAt: string;
    };
    expect(throttle.scheduledDelaySeconds).toBeGreaterThanOrEqual(15);
    expect(throttle.scheduledDelaySeconds).toBeLessThanOrEqual(30);
    expect(new Date(throttle.nextNavigationEligibleAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("records a permanently unavailable job and continues an automatic batch", async () => {
    const run = runningBatch();
    run.executionPolicy = "automatic_send";
    localData[STORAGE_KEYS.run] = run;

    const response = await dispatchRuntime({
      type: "DETAIL_FAILED",
      code: "job_unavailable",
      jobId: "1980000401",
      leaseId,
      error: "猎聘职位已暂停招聘或不可用"
    }, liepinContentSender());

    expect(response).toEqual({ ok: true });
    await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).currentIndex).toBe(1));
    const parsed = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    expect(parsed).toMatchObject({ status: "running", currentIndex: 1, failedCount: 1 });
    expect(parsed.items[0]).toMatchObject({
      status: "failed",
      error: "猎聘职位已暂停招聘或不可用"
    });
    expect(backend.invokeModelGateway).toHaveBeenCalledWith(expect.objectContaining({
      operation: "record_failure",
      payload: expect.objectContaining({ errorCode: "猎聘职位已暂停招聘或不可用" })
    }), undefined);
    expect(backend.reserveReviewedDeliveryQuota).not.toHaveBeenCalled();
  });

  it("keeps a quickly resolved detail tab for a minimum dwell before closing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T00:00:00.000Z"));
    const run = automaticRunningBatch("opening");
    run.items[0]!.startedAt = "2026-09-14T00:00:00.000Z";
    localData[STORAGE_KEYS.run] = run;
    try {
      const response = dispatchRuntime({
        type: "DETAIL_FAILED",
        code: "job_unavailable",
        jobId: "1980000401",
        leaseId,
        error: "猎聘职位已暂停招聘或不可用"
      }, liepinContentSender());

      await vi.advanceTimersByTimeAsync(7_999);
      expect(chrome.tabs.remove).not.toHaveBeenCalledWith(101);
      await vi.advanceTimersByTimeAsync(1);
      await expect(response).resolves.toEqual({ ok: true });
      expect(chrome.tabs.remove).toHaveBeenCalledWith(101);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resumes a pre-draft automatic blocker by reopening details for extraction", async () => {
    const run = automaticRunningBatch("opening");
    run.status = "paused";
    run.items[0] = {
      ...run.items[0]!,
      status: "blocked",
      blockerPhase: "pre_write",
      blockerCode: "detail_unavailable",
      error: "详情页读取超时",
      tabId: undefined,
      leaseId: undefined,
      opportunityId: undefined,
      draftRevisionId: undefined,
      draftSha256: undefined
    };
    localData[STORAGE_KEYS.run] = run;
    (chrome.tabs.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 301 });

    await dispatchRuntime({ type: "RESUME_BATCH" }, {} as chrome.runtime.MessageSender);
    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);

    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledOnce());
    const resumed = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    expect(resumed.status).toBe("running");
    expect(resumed.currentIndex).toBe(0);
    expect(resumed.items[0]).toMatchObject({
      status: "opening",
      tabId: 301,
      attempt: 2
    });
    expect(resumed.items[0]?.draftRevisionId).toBeUndefined();
  });

  it("resumes a draft-ready automatic blocker by waiting for fresh detail readiness before delivery", async () => {
    const run = automaticRunningBatch("delivery_ready");
    run.status = "paused";
    run.items[0] = {
      ...run.items[0]!,
      status: "blocked",
      blockerPhase: "pre_write",
      blockerCode: "login_required",
      error: "猎聘页面需要登录",
      tabId: undefined,
      leaseId: undefined,
      draftSha256: await sourceHash(draft().currentText)
    };
    localData[STORAGE_KEYS.run] = run;
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "automatic_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" }
    });
    backend.invokeModelGateway.mockClear();
    backend.listDrafts.mockResolvedValue([draft()]);
    backend.listOpportunities.mockResolvedValue([{ ...opportunity(), status: "draft_ready" }]);
    (chrome.tabs.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 302 });
    (chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId: number, message: { type?: string }) => {
      if (message.type === "CONTENT_REVIEWED_SEND_PREFLIGHT") {
        return { ok: true, platformJobId: "1980000401", resumeMode: "platform_default", actionTier: "primary" };
      }
      if (message.type === "CONTENT_REVIEWED_SEND_EXECUTE") {
        return { ok: true, application: "verified", greeting: "verified", evidenceCodes: ["application_status_verified", "outbound_greeting_exact_match"] };
      }
      return undefined;
    });

    await dispatchRuntime({ type: "RESUME_BATCH" }, {} as chrome.runtime.MessageSender);
    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);

    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledOnce());
    let resumed = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    expect(resumed.items[0]).toMatchObject({
      status: "opening",
      tabId: 302
    });
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ type: "CONTENT_REVIEWED_SEND_PREFLIGHT" })
    );

    const freshLease = resumed.items[0]?.leaseId;
    expect(freshLease).toBeTypeOf("string");
    resumed.items[0]!.startedAt = new Date(Date.now() - 8_000).toISOString();
    localData[STORAGE_KEYS.run] = resumed;
    await dispatchDetailWithLease(detailJob("岗位职责：负责建设高可用任务平台和稳定性体系。"), freshLease!);
    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);
    await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).status).toBe("completed"));
    resumed = batchRunSchema.parse(localData[STORAGE_KEYS.run]);

    expect(modelOperations()).not.toContain("evaluate_opportunity");
    expect(modelOperations()).not.toContain("generate_greeting");
    expect(backend.recordJobDetails).not.toHaveBeenCalled();
    expect(backend.markReviewedDeliveryWriteStarted).toHaveBeenCalledOnce();
    expect(resumed.items[0]?.status).toBe("delivery_succeeded");
  });

  it("opens a missing reviewed-send detail tab and waits for its content preflight", async () => {
    const draftSha256 = await sourceHash(draft().currentText);
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "reviewed_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" }
    });
    backend.listDrafts.mockResolvedValue([draft()]);
    backend.listOpportunities.mockResolvedValue([{ ...opportunity(), status: "draft_ready" }]);
    (chrome.tabs.query as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (chrome.tabs.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 202,
      url: "https://www.liepin.com/job/1980000401.shtml"
    });
    let preflightAttempts = 0;
    (chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      preflightAttempts += 1;
      if (preflightAttempts === 1) throw new Error("Receiving end does not exist");
      return { ok: true, platformJobId: "1980000401", resumeMode: "platform_default", actionTier: "primary" };
    });
    const sender = {
      id: "jobflow-extension-id",
      url: "chrome-extension://jobflow-extension-id/options.html"
    } as chrome.runtime.MessageSender;

    const response = await dispatchRuntime({
      type: "PREPARE_REVIEWED_SEND",
      opportunityId,
      draftRevisionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      draftSha256
    }, sender);

    expect(response).toMatchObject({ ok: true });
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: "https://www.liepin.com/job/1980000401.shtml",
      active: false
    });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
    expect(backend.reserveReviewedDeliveryQuota).not.toHaveBeenCalled();
    expect(backend.markReviewedDeliveryWriteStarted).not.toHaveBeenCalled();
  });

  it("reloads an exact existing detail tab once when its content context is stale", async () => {
    const draftSha256 = await sourceHash(draft().currentText);
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "reviewed_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" }
    });
    backend.listDrafts.mockResolvedValue([draft()]);
    backend.listOpportunities.mockResolvedValue([{ ...opportunity(), status: "draft_ready" }]);
    (chrome.tabs.query as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{
      id: 201,
      url: "https://www.liepin.com/job/1980000401.shtml"
    }]);
    let preflightAttempts = 0;
    (chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      preflightAttempts += 1;
      if (preflightAttempts === 1) throw new Error("Extension context invalidated");
      return { ok: true, platformJobId: "1980000401", resumeMode: "platform_default", actionTier: "primary" };
    });
    const sender = {
      id: "jobflow-extension-id",
      url: "chrome-extension://jobflow-extension-id/options.html"
    } as chrome.runtime.MessageSender;

    const response = await dispatchRuntime({
      type: "PREPARE_REVIEWED_SEND",
      opportunityId,
      draftRevisionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      draftSha256
    }, sender);

    expect(response).toMatchObject({ ok: true });
    expect(chrome.tabs.reload).toHaveBeenCalledOnce();
    expect(chrome.tabs.reload).toHaveBeenCalledWith(201);
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("allows only one concurrent user-requested generation per opportunity", async () => {
    const generation = deferred<unknown>();
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "reviewed_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" }
    });
    backend.listResumeProfiles.mockResolvedValue([activeProfile()]);
    backend.listOpportunities.mockResolvedValue([{
      ...opportunity(),
      status: "draft_ready",
      description: "岗位职责：负责建设高可用任务平台和稳定性体系。"
    }]);
    backend.invokeModelGateway.mockImplementation(async (request: { operation: string }) => {
      if (request.operation === "generate_greeting") return generation.promise;
      return { ok: true };
    });

    const first = dispatchRuntime({
      type: "REGENERATE_DRAFT",
      opportunityId
    }, {} as chrome.runtime.MessageSender);
    const second = dispatchRuntime({
      type: "REGENERATE_DRAFT",
      opportunityId
    }, {} as chrome.runtime.MessageSender);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(modelOperations().filter((operation) => operation === "generate_greeting")).toHaveLength(1);

    generation.resolve({
      ok: true,
      result: {
        greeting: draft().currentText,
        jdEvidence: ["负责建设高可用任务平台"],
        factIds: ["fact-1"]
      }
    });
    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    expect(firstResponse).toEqual({ ok: true });
    expect(secondResponse).toMatchObject({ ok: false, error: expect.stringContaining("正在生成") });
  });

  it("honors pause during model work and does not enter automatic delivery from a stale detail run", async () => {
    const evaluate = deferred<unknown>();
    localData[STORAGE_KEYS.run] = automaticRunningBatch("opening");
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "automatic_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" }
    });
    backend.listResumeProfiles.mockResolvedValue([activeProfile()]);
    backend.listOpportunities.mockResolvedValue([{ ...opportunity(), status: "draft_ready" }]);
    backend.listDrafts.mockResolvedValue([draft()]);
    backend.invokeModelGateway.mockImplementation(async (request: { operation: string }) => {
      if (request.operation === "evaluate_opportunity") return evaluate.promise;
      if (request.operation === "generate_greeting") {
        return {
          ok: true,
          result: {
            greeting: draft().currentText,
            jdEvidence: ["负责建设高可用任务平台"],
            factIds: ["fact-1"]
          }
        };
      }
      return { ok: true };
    });

    const detailPromise = dispatchDetail(detailJob("岗位职责：负责建设高可用任务平台和稳定性体系。"));
    await vi.waitFor(() => expect(backend.invokeModelGateway).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "evaluate_opportunity" }),
      undefined
    ));
    await dispatchRuntime({ type: "PAUSE_BATCH" }, {} as chrome.runtime.MessageSender);
    evaluate.resolve({
      ok: true,
      result: {
        outcome: "proceed",
        score: 88,
        reasons: ["平台经验匹配"],
        jdEvidence: ["负责建设高可用任务平台"],
        factIds: ["fact-1"]
      }
    });
    await detailPromise;
    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);

    await new Promise((resolve) => setTimeout(resolve, 0));
    const paused = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    expect(paused.status).toBe("paused");
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ type: "CONTENT_REVIEWED_SEND_EXECUTE" })
    );
  });

  it("resumes a paused generating item by reopening a fresh detail page instead of remaining stuck", async () => {
    const run = automaticRunningBatch("opening");
    run.status = "paused";
    run.pauseReason = "用户暂停";
    run.items[0] = {
      ...run.items[0]!,
      status: "generating",
      tabId: 101,
      leaseId,
      opportunityId: opportunityId
    };
    localData[STORAGE_KEYS.run] = run;
    (chrome.tabs.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 303 });

    await dispatchRuntime({ type: "RESUME_BATCH" }, {} as chrome.runtime.MessageSender);
    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);

    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledOnce());
    const resumed = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    expect(resumed.status).toBe("running");
    expect(resumed.items[0]).toMatchObject({
      status: "opening",
      tabId: 303
    });
    expect(chrome.tabs.remove).toHaveBeenCalledWith(101);
  });

  it("honors cancel during final preflight and stops before the write boundary", async () => {
    const preflight = deferred<unknown>();
    const run = automaticRunningBatch("delivery_ready");
    run.items[0]!.draftSha256 = await sourceHash(draft().currentText);
    localData[STORAGE_KEYS.run] = run;
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "automatic_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" }
    });
    backend.listDrafts.mockResolvedValue([draft()]);
    backend.listOpportunities.mockResolvedValue([{ ...opportunity(), status: "draft_ready" }]);
    (chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId: number, message: { type?: string }) => {
      if (message.type === "CONTENT_REVIEWED_SEND_PREFLIGHT") return preflight.promise;
      if (message.type === "CONTENT_REVIEWED_SEND_EXECUTE") {
        return { ok: true, application: "verified", greeting: "verified", evidenceCodes: ["application_status_verified", "outbound_greeting_exact_match"] };
      }
      return undefined;
    });

    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);
    await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      101,
      expect.objectContaining({ type: "CONTENT_REVIEWED_SEND_PREFLIGHT" })
    ));
    await dispatchRuntime({ type: "CANCEL_BATCH" }, {} as chrome.runtime.MessageSender);
    preflight.resolve({ ok: true, platformJobId: "1980000401", resumeMode: "platform_default", actionTier: "primary" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).status).toBe("cancelled");
    expect(backend.markReviewedDeliveryWriteStarted).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ type: "CONTENT_REVIEWED_SEND_EXECUTE" })
    );
  });

  it("resumes a paused final-preflight item by reopening details before another preflight", async () => {
    const run = automaticRunningBatch("delivery_ready");
    run.status = "paused";
    run.pauseReason = "用户暂停";
    run.items[0] = {
      ...run.items[0]!,
      status: "delivery_preflighting",
      tabId: 101,
      leaseId,
      draftSha256: await sourceHash(draft().currentText)
    };
    localData[STORAGE_KEYS.run] = run;
    backend.listDrafts.mockResolvedValue([draft()]);
    backend.listOpportunities.mockResolvedValue([{ ...opportunity(), status: "draft_ready" }]);
    (chrome.tabs.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 304 });

    await dispatchRuntime({ type: "RESUME_BATCH" }, {} as chrome.runtime.MessageSender);
    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);

    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledOnce());
    const resumed = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    expect(resumed.items[0]).toMatchObject({
      status: "opening",
      tabId: 304
    });
    expect(chrome.tabs.remove).toHaveBeenCalledWith(101);
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ type: "CONTENT_REVIEWED_SEND_PREFLIGHT" })
    );
  });

  it("finishes post-write evidence after a user pause while preserving paused control state", async () => {
    const run = automaticRunningBatch("delivery_ready");
    run.items[0]!.draftSha256 = await sourceHash(draft().currentText);
    localData[STORAGE_KEYS.run] = run;
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "automatic_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" },
      automaticSendDelayMinSeconds: 5,
      automaticSendDelayMaxSeconds: 5
    });
    backend.listDrafts.mockResolvedValue([draft()]);
    backend.listOpportunities.mockResolvedValue([{ ...opportunity(), status: "draft_ready" }]);
    (chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId: number, message: { type?: string }) => {
      if (message.type === "CONTENT_REVIEWED_SEND_PREFLIGHT") {
        return { ok: true, platformJobId: "1980000401", resumeMode: "platform_default", actionTier: "primary" };
      }
      if (message.type === "CONTENT_REVIEWED_SEND_EXECUTE") {
        await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).items[0]?.status).toBe("delivery_in_progress"));
        await dispatchRuntime({ type: "PAUSE_BATCH" }, {} as chrome.runtime.MessageSender);
        return { ok: true, application: "verified", greeting: "verified", evidenceCodes: ["application_status_verified", "outbound_greeting_exact_match"] };
      }
      return undefined;
    });

    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);
    await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).deliverySucceededCount).toBe(1));

    const paused = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    expect(paused.status).toBe("paused");
    expect(paused.currentIndex).toBe(1);
    expect(paused.items[0]?.status).toBe("delivery_succeeded");
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      101,
      expect.objectContaining({ type: "CONTENT_REVIEWED_SEND_EXECUTE" })
    );
  });

  it("closes the completed current tab instead of the next item tab", async () => {
    const run = automaticRunningBatch("delivery_ready");
    run.items[0]!.draftSha256 = await sourceHash(draft().currentText);
    run.items.push({
      candidate: candidate("1980000402", 1),
      status: "queued",
      tabId: 202,
      leaseId: "99999999-9999-4999-8999-999999999999",
      attempt: 0
    });
    localData[STORAGE_KEYS.run] = run;
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "automatic_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" }
    });
    backend.listDrafts.mockResolvedValue([draft()]);
    backend.listOpportunities.mockResolvedValue([{ ...opportunity(), status: "draft_ready" }]);
    (chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId: number, message: { type?: string }) => {
      if (message.type === "CONTENT_REVIEWED_SEND_PREFLIGHT") {
        return { ok: true, platformJobId: "1980000401", resumeMode: "platform_default", actionTier: "primary" };
      }
      if (message.type === "CONTENT_REVIEWED_SEND_EXECUTE") {
        return { ok: true, application: "verified", greeting: "verified", evidenceCodes: ["application_status_verified", "outbound_greeting_exact_match"] };
      }
      return undefined;
    });

    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);
    await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).currentIndex).toBe(1));

    expect(chrome.tabs.remove).toHaveBeenCalledWith(101);
    expect(chrome.tabs.remove).not.toHaveBeenCalledWith(202);
    const saved = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    expect(saved.items[0]?.tabId).toBeUndefined();
    expect(saved.items[0]?.leaseId).toBeUndefined();
  });

  it("pauses automatic tab creation failures instead of finishing and advancing", async () => {
    const run = automaticRunningBatch("opening");
    run.items[0] = {
      ...run.items[0]!,
      status: "queued",
      tabId: undefined,
      leaseId: undefined,
      opportunityId: undefined,
      draftRevisionId: undefined,
      draftSha256: undefined
    };
    localData[STORAGE_KEYS.run] = run;
    (chrome.tabs.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});

    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);
    await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).status).toBe("paused"));

    const paused = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    expect(paused.currentIndex).toBe(0);
    expect(paused.items[0]).toMatchObject({
      status: "blocked",
      blockerPhase: "pre_write",
      blockerCode: "detail_tab_unavailable"
    });
  });

  it("ignores detail timeout while already paused without overwriting manual pause state", async () => {
    const run = automaticRunningBatch("opening");
    run.status = "paused";
    run.pauseReason = "用户暂停";
    localData[STORAGE_KEYS.run] = run;

    alarmListener?.({ name: "jobflow:detail:" + run.id + ":" + leaseId, scheduledTime: Date.now() } as chrome.alarms.Alarm);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const paused = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    expect(paused.status).toBe("paused");
    expect(paused.pauseReason).toBe("用户暂停");
    expect(paused.items[0]).toMatchObject({
      status: "opening",
      tabId: 101,
      leaseId
    });
  });

  it("records pre-write review-required on quota failure without entering execute", async () => {
    const run = automaticRunningBatch("delivery_ready");
    run.items[0]!.draftSha256 = await sourceHash(draft().currentText);
    localData[STORAGE_KEYS.run] = run;
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "automatic_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" }
    });
    backend.listDrafts.mockResolvedValue([draft()]);
    backend.listOpportunities.mockResolvedValue([{ ...opportunity(), status: "draft_ready" }]);
    backend.reserveReviewedDeliveryQuota.mockRejectedValue(new Error("今日猎聘投递额度已用完"));
    (chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId: number, message: { type?: string }) => {
      if (message.type === "CONTENT_REVIEWED_SEND_PREFLIGHT") {
        return { ok: true, platformJobId: "1980000401", resumeMode: "platform_default", actionTier: "primary" };
      }
      if (message.type === "CONTENT_REVIEWED_SEND_EXECUTE") {
        return { ok: true, application: "verified", greeting: "verified", evidenceCodes: ["application_status_verified", "outbound_greeting_exact_match"] };
      }
      return undefined;
    });

    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);
    await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).status).toBe("paused"));

    expect(backend.recordReviewedDeliveryAttempt).toHaveBeenCalledWith(expect.objectContaining({
      eventKind: "delivery_review_required",
      evidenceCode: "pre_write_failed",
      reason: "今日猎聘投递额度已用完"
    }));
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ type: "CONTENT_REVIEWED_SEND_EXECUTE" })
    );
  });

  it("classifies throttle persistence failure after write-start as post-write ambiguity", async () => {
    const run = automaticRunningBatch("delivery_ready");
    run.items[0]!.draftSha256 = await sourceHash(draft().currentText);
    localData[STORAGE_KEYS.run] = run;
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "automatic_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" },
      automaticSendDelayMinSeconds: 5,
      automaticSendDelayMaxSeconds: 5
    });
    backend.listDrafts.mockResolvedValue([draft()]);
    backend.listOpportunities.mockResolvedValue([{ ...opportunity(), status: "draft_ready" }]);
    const storageSet = chrome.storage.local.set as unknown as ReturnType<typeof vi.fn>;
    storageSet.mockImplementation(async (value: Record<string, unknown>) => {
      if (STORAGE_KEYS.automaticWriteThrottle in value) throw new Error("local throttle unavailable");
      Object.assign(localData, value);
    });
    (chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId: number, message: { type?: string }) => {
      if (message.type === "CONTENT_REVIEWED_SEND_PREFLIGHT") {
        return { ok: true, platformJobId: "1980000401", resumeMode: "platform_default", actionTier: "primary" };
      }
      if (message.type === "CONTENT_REVIEWED_SEND_EXECUTE") {
        return { ok: true, application: "verified", greeting: "verified", evidenceCodes: ["application_status_verified", "outbound_greeting_exact_match"] };
      }
      return undefined;
    });

    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);
    await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).status).toBe("paused"));

    const paused = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    expect(paused.currentIndex).toBe(1);
    expect(paused.deliveryPartialCount).toBe(1);
    expect(paused.items[0]).toMatchObject({
      status: "delivery_partial",
      blockerPhase: "post_write",
      blockerCode: "write_result_unavailable"
    });
    expect(backend.recordReviewedDeliveryAttempt).toHaveBeenCalledWith(expect.objectContaining({
      eventKind: "delivery_review_required",
      evidenceCode: "write_result_unavailable"
    }));
  });

  it("uses a bounded content-delivery watchdog after write-start", async () => {
    vi.useFakeTimers();
    try {
      const run = automaticRunningBatch("delivery_ready");
      run.items[0]!.draftSha256 = await sourceHash(draft().currentText);
      localData[STORAGE_KEYS.run] = run;
      localData[STORAGE_KEYS.settings] = settings({}, {
        executionPolicy: "automatic_send",
        model: { ...DEFAULT_SETTINGS.model, route: "managed" },
        automaticSendDelayMinSeconds: 5,
        automaticSendDelayMaxSeconds: 5
      });
      backend.listDrafts.mockResolvedValue([draft()]);
      backend.listOpportunities.mockResolvedValue([{ ...opportunity(), status: "draft_ready" }]);
      const never = new Promise<never>(() => undefined);
      (chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId: number, message: { type?: string }) => {
        if (message.type === "CONTENT_REVIEWED_SEND_PREFLIGHT") {
          return { ok: true, platformJobId: "1980000401", resumeMode: "platform_default", actionTier: "primary" };
        }
        if (message.type === "CONTENT_REVIEWED_SEND_EXECUTE") return never;
        return undefined;
      });

      alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);
      await vi.waitFor(() => expect(backend.markReviewedDeliveryWriteStarted).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(120_000);
      await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).status).toBe("paused"));

      const paused = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
      expect(paused.currentIndex).toBe(1);
      expect(paused.deliveryPartialCount).toBe(1);
      expect(paused.items[0]).toMatchObject({
        status: "delivery_partial",
        blockerPhase: "post_write",
        blockerCode: "write_result_unavailable"
      });
      expect(backend.recordReviewedDeliveryAttempt).toHaveBeenCalledWith(expect.objectContaining({
        eventKind: "delivery_review_required",
        evidenceCode: "write_result_unavailable",
        reason: "真实投递结果读取超时"
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects PREPARE and CONFIRM in draft_only before any delivery backend mutation", async () => {
    const draftSha256 = await sourceHash(draft().currentText);
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "draft_only",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" }
    });
    backend.listDrafts.mockResolvedValue([draft()]);
    backend.listOpportunities.mockResolvedValue([{ ...opportunity(), status: "draft_ready" }]);
    (chrome.tabs.query as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 201, url: "https://www.liepin.com/job/1980000401.shtml" }]);

    const sender = {
      id: "jobflow-extension-id",
      url: "chrome-extension://jobflow-extension-id/options.html"
    } as chrome.runtime.MessageSender;
    const prepare = await dispatchRuntime({
      type: "PREPARE_REVIEWED_SEND",
      opportunityId,
      draftRevisionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      draftSha256
    }, sender);
    const confirm = await dispatchRuntime({
      type: "CONFIRM_REVIEWED_SEND",
      opportunityId,
      draftRevisionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      draftSha256
    }, sender);

    expect(prepare).toMatchObject({ ok: false });
    expect(confirm).toMatchObject({ ok: false });
    expect(backend.prepareReviewedDelivery).not.toHaveBeenCalled();
    expect(backend.recordReviewedDeliveryAttempt).not.toHaveBeenCalled();
    expect(backend.reserveReviewedDeliveryQuota).not.toHaveBeenCalled();
    expect(backend.markReviewedDeliveryWriteStarted).not.toHaveBeenCalled();
  });

  it("pauses automatic delivery before quota when settings switch away from automatic during preflight", async () => {
    const preflight = deferred<unknown>();
    const run = automaticRunningBatch("delivery_ready");
    run.items[0]!.draftSha256 = await sourceHash(draft().currentText);
    localData[STORAGE_KEYS.run] = run;
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "automatic_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" }
    });
    backend.listDrafts.mockResolvedValue([draft()]);
    backend.listOpportunities.mockResolvedValue([{ ...opportunity(), status: "draft_ready" }]);
    (chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId: number, message: { type?: string }) => {
      if (message.type === "CONTENT_REVIEWED_SEND_PREFLIGHT") return preflight.promise;
      if (message.type === "CONTENT_REVIEWED_SEND_EXECUTE") {
        return { ok: true, application: "verified", greeting: "verified", evidenceCodes: ["application_status_verified", "outbound_greeting_exact_match"] };
      }
      return undefined;
    });

    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);
    await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      101,
      expect.objectContaining({ type: "CONTENT_REVIEWED_SEND_PREFLIGHT" })
    ));
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "reviewed_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" }
    });
    preflight.resolve({ ok: true, platformJobId: "1980000401", resumeMode: "platform_default", actionTier: "primary" });
    await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).status).toBe("paused"));

    const paused = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    expect(paused.pauseReason).toContain("执行策略");
    expect(paused.items[0]).toMatchObject({
      status: "blocked",
      blockerPhase: "pre_write",
      blockerCode: "execution_policy_changed"
    });
    expect(backend.reserveReviewedDeliveryQuota).not.toHaveBeenCalled();
    expect(backend.markReviewedDeliveryWriteStarted).not.toHaveBeenCalled();
  });

  it("rechecks throttle after final preflight and waits when a newer reviewed-send throttle appears", async () => {
    const preflight = deferred<unknown>();
    const future = new Date(Date.now() + 45_000).toISOString();
    const run = automaticRunningBatch("delivery_ready");
    run.items[0]!.draftSha256 = await sourceHash(draft().currentText);
    localData[STORAGE_KEYS.run] = run;
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "automatic_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" }
    });
    backend.listDrafts.mockResolvedValue([draft()]);
    backend.listOpportunities.mockResolvedValue([{ ...opportunity(), status: "draft_ready" }]);
    (chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId: number, message: { type?: string }) => {
      if (message.type === "CONTENT_REVIEWED_SEND_PREFLIGHT") return preflight.promise;
      if (message.type === "CONTENT_REVIEWED_SEND_EXECUTE") {
        return { ok: true, application: "verified", greeting: "verified", evidenceCodes: ["application_status_verified", "outbound_greeting_exact_match"] };
      }
      return undefined;
    });

    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);
    await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      101,
      expect.objectContaining({ type: "CONTENT_REVIEWED_SEND_PREFLIGHT" })
    ));
    localData[STORAGE_KEYS.automaticWriteThrottle] = {
      ownerId: userId,
      platform: "liepin",
      lastWriteStartedAt: new Date().toISOString(),
      scheduledDelaySeconds: 45,
      nextWriteEligibleAt: future
    };
    preflight.resolve({ ok: true, platformJobId: "1980000401", resumeMode: "platform_default", actionTier: "primary" });
    await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).items[0]?.status).toBe("waiting_interval"));

    const waiting = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    expect(waiting.nextWriteEligibleAt).toBe(future);
    expect(localData[STORAGE_KEYS.automaticWriteThrottle]).toMatchObject({ nextWriteEligibleAt: future });
    expect(chrome.alarms.create).toHaveBeenCalledWith(expect.stringContaining("jobflow:auto-write:"), {
      when: new Date(future).getTime()
    });
    expect(backend.reserveReviewedDeliveryQuota).not.toHaveBeenCalled();
    expect(backend.markReviewedDeliveryWriteStarted).not.toHaveBeenCalled();
  });

  it("uses delay settings loaded at actual write-start rather than stale preflight settings", async () => {
    const preflight = deferred<unknown>();
    const run = automaticRunningBatch("delivery_ready");
    run.items[0]!.draftSha256 = await sourceHash(draft().currentText);
    localData[STORAGE_KEYS.run] = run;
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "automatic_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" },
      automaticSendDelayMinSeconds: 5,
      automaticSendDelayMaxSeconds: 5
    });
    backend.listDrafts.mockResolvedValue([draft()]);
    backend.listOpportunities.mockResolvedValue([{ ...opportunity(), status: "draft_ready" }]);
    (chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId: number, message: { type?: string }) => {
      if (message.type === "CONTENT_REVIEWED_SEND_PREFLIGHT") return preflight.promise;
      if (message.type === "CONTENT_REVIEWED_SEND_EXECUTE") {
        return { ok: true, application: "verified", greeting: "verified", evidenceCodes: ["application_status_verified", "outbound_greeting_exact_match"] };
      }
      return undefined;
    });

    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);
    await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      101,
      expect.objectContaining({ type: "CONTENT_REVIEWED_SEND_PREFLIGHT" })
    ));
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "automatic_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" },
      automaticSendDelayMinSeconds: 7,
      automaticSendDelayMaxSeconds: 7
    });
    preflight.resolve({ ok: true, platformJobId: "1980000401", resumeMode: "platform_default", actionTier: "primary" });
    await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).status).toBe("completed"));

    expect(localData[STORAGE_KEYS.automaticWriteThrottle]).toMatchObject({
      ownerId: userId,
      platform: "liepin",
      scheduledDelaySeconds: 7
    });
  });

  it("uses a shared Liepin live-write mutex across automatic and manual reviewed sends", async () => {
    const draftSha256 = await sourceHash(draft().currentText);
    const autoPreflight = deferred<unknown>();
    const run = automaticRunningBatch("delivery_ready");
    run.items[0]!.draftSha256 = draftSha256;
    localData[STORAGE_KEYS.run] = run;
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "automatic_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" },
      automaticSendDelayMinSeconds: 5,
      automaticSendDelayMaxSeconds: 5
    });
    backend.listDrafts.mockResolvedValue([draft()]);
    backend.listOpportunities.mockResolvedValue([{ ...opportunity(), status: "draft_ready" }]);
    (chrome.tabs.query as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 201, url: "https://www.liepin.com/job/1980000401.shtml" }]);
    (chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (tabId: number, message: { type?: string }) => {
      if (message.type === "CONTENT_REVIEWED_SEND_PREFLIGHT" && tabId === 101) return autoPreflight.promise;
      if (message.type === "CONTENT_REVIEWED_SEND_PREFLIGHT") {
        return { ok: true, platformJobId: "1980000401", resumeMode: "platform_default", actionTier: "primary" };
      }
      if (message.type === "CONTENT_REVIEWED_SEND_EXECUTE") {
        return { ok: true, application: "verified", greeting: "verified", evidenceCodes: ["application_status_verified", "outbound_greeting_exact_match"] };
      }
      return undefined;
    });
    const sender = {
      id: "jobflow-extension-id",
      url: "chrome-extension://jobflow-extension-id/options.html"
    } as chrome.runtime.MessageSender;
    await expect(dispatchRuntime({
      type: "PREPARE_REVIEWED_SEND",
      opportunityId,
      draftRevisionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      draftSha256
    }, sender)).resolves.toMatchObject({ ok: true });

    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);
    await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      101,
      expect.objectContaining({ type: "CONTENT_REVIEWED_SEND_PREFLIGHT" })
    ));

    const concurrentManual = await dispatchRuntime({
      type: "CONFIRM_REVIEWED_SEND",
      opportunityId,
      draftRevisionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      draftSha256
    }, sender);
    expect(concurrentManual).toMatchObject({ ok: false });
    expect(concurrentManual.error).toContain("写入");

    autoPreflight.resolve({ ok: true, platformJobId: "1980000401", resumeMode: "platform_default", actionTier: "primary" });
    await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).status).toBe("completed"));
    expect(backend.markReviewedDeliveryWriteStarted).toHaveBeenCalledOnce();
  });

  it("keeps the automatic live-write mutex strictly exclusive for duplicate queue alarms", async () => {
    const preflight = deferred<unknown>();
    const run = automaticRunningBatch("delivery_ready");
    run.items[0]!.draftSha256 = await sourceHash(draft().currentText);
    localData[STORAGE_KEYS.run] = run;
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "automatic_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" },
      automaticSendDelayMinSeconds: 5,
      automaticSendDelayMaxSeconds: 5
    });
    backend.listDrafts.mockResolvedValue([draft()]);
    backend.listOpportunities.mockResolvedValue([{ ...opportunity(), status: "draft_ready" }]);
    (chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId: number, message: { type?: string }) => {
      if (message.type === "CONTENT_REVIEWED_SEND_PREFLIGHT") return preflight.promise;
      if (message.type === "CONTENT_REVIEWED_SEND_EXECUTE") {
        return { ok: true, application: "verified", greeting: "verified", evidenceCodes: ["application_status_verified", "outbound_greeting_exact_match"] };
      }
      return undefined;
    });

    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);
    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);
    await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      101,
      expect.objectContaining({ type: "CONTENT_REVIEWED_SEND_PREFLIGHT" })
    ));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, message]) => message.type === "CONTENT_REVIEWED_SEND_PREFLIGHT")).toHaveLength(1);
    expect(backend.reserveReviewedDeliveryQuota).not.toHaveBeenCalled();

    preflight.resolve({ ok: true, platformJobId: "1980000401", resumeMode: "platform_default", actionTier: "primary" });
    await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).status).toBe("completed"));
    expect(backend.markReviewedDeliveryWriteStarted).toHaveBeenCalledOnce();
  });

  it("recovers automatic delivery_in_progress as post-write ambiguity across persisted run statuses and lifecycle triggers", async () => {
    const cases: Array<{
      status: BatchRun["status"];
      triggerName: string;
      trigger: () => void;
      expectedStatus: BatchRun["status"];
    }> = [
      { status: "running", triggerName: "startup", trigger: () => startupListener?.(), expectedStatus: "paused" },
      { status: "running", triggerName: "installed", trigger: () => installedListener?.(), expectedStatus: "paused" },
      { status: "paused", triggerName: "startup", trigger: () => startupListener?.(), expectedStatus: "paused" },
      { status: "paused", triggerName: "installed", trigger: () => installedListener?.(), expectedStatus: "paused" },
      { status: "cancelled", triggerName: "startup", trigger: () => startupListener?.(), expectedStatus: "cancelled" },
      { status: "cancelled", triggerName: "installed", trigger: () => installedListener?.(), expectedStatus: "cancelled" }
    ];
    for (const scenario of cases) {
      vi.clearAllMocks();
      const run = automaticRunningBatch("delivery_ready");
      run.status = scenario.status;
      run.items[0] = {
        ...run.items[0]!,
        status: "delivery_in_progress",
        tabId: 101,
        leaseId,
        opportunityId,
        draftRevisionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        draftSha256: await sourceHash(draft().currentText)
      };
      localData[STORAGE_KEYS.run] = run;

      scenario.trigger();
      await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).currentIndex).toBe(1));

      const recovered = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
      expect(recovered.status, scenario.triggerName + ":" + scenario.status).toBe(scenario.expectedStatus);
      expect(recovered.currentIndex).toBe(1);
      expect(recovered.deliveryPartialCount).toBe(1);
      expect(recovered.pauseReason).toContain("重启");
      expect(recovered.items[0]).toMatchObject({
        status: "delivery_partial",
        blockerPhase: "post_write",
        blockerCode: "extension_restarted"
      });
      expect(recovered.items[0]?.tabId).toBeUndefined();
      expect(recovered.items[0]?.leaseId).toBeUndefined();
      expect(chrome.tabs.remove).toHaveBeenCalledWith(101);
      expect(chrome.alarms.clear).toHaveBeenCalledWith(expect.stringContaining("jobflow:detail:"));
      expect(backend.recordReviewedDeliveryAttempt).toHaveBeenCalledWith(expect.objectContaining({
        opportunityId,
        eventKind: "delivery_review_required",
        evidenceCode: "extension_restarted",
        reason: "扩展或浏览器重启，真实写入结果需要复核",
        draftRevisionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        draftSha256: await sourceHash(draft().currentText)
      }));
      expect(chrome.alarms.create).not.toHaveBeenCalledWith("jobflow:queue", expect.anything());
      expect(chrome.tabs.sendMessage).not.toHaveBeenCalledWith(
        expect.any(Number),
        expect.objectContaining({ type: "CONTENT_REVIEWED_SEND_EXECUTE" })
      );
      expect(chrome.tabs.sendMessage).not.toHaveBeenCalledWith(
        expect.any(Number),
        expect.objectContaining({ type: "CONTENT_REVIEWED_SEND_PREFLIGHT" })
      );
    }
  });

  it("recovers automatic delivery_in_progress locally even if audit persistence fails", async () => {
    const run = automaticRunningBatch("delivery_ready");
    run.items[0] = {
      ...run.items[0]!,
      status: "delivery_in_progress",
      tabId: 101,
      leaseId,
      opportunityId,
      draftRevisionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      draftSha256: await sourceHash(draft().currentText)
    };
    localData[STORAGE_KEYS.run] = run;
    backend.recordReviewedDeliveryAttempt.mockRejectedValueOnce(new Error("audit unavailable"));

    startupListener?.();
    await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).status).toBe("paused"));

    const recovered = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    expect(recovered.currentIndex).toBe(1);
    expect(recovered.items[0]).toMatchObject({
      status: "delivery_partial",
      blockerPhase: "post_write",
      blockerCode: "extension_restarted"
    });
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ type: "CONTENT_REVIEWED_SEND_EXECUTE" })
    );
  });

  it("reruns safe model processing when a paused generating item lacks automatic draft identity", async () => {
    const run = automaticRunningBatch("opening");
    run.status = "paused";
    run.pauseReason = "用户暂停";
    run.items[0] = {
      ...run.items[0]!,
      status: "generating",
      tabId: 101,
      leaseId,
      opportunityId
    };
    localData[STORAGE_KEYS.run] = run;
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "automatic_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" }
    });
    backend.invokeModelGateway.mockClear();
    mockProceedingModel();
    backend.listResumeProfiles.mockResolvedValue([activeProfile()]);
    backend.listDrafts.mockResolvedValue([draft()]);
    backend.listOpportunities.mockResolvedValue([{ ...opportunity(), status: "draft_ready" }]);
    (chrome.tabs.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 305 });
    (chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId: number, message: { type?: string }) => {
      if (message.type === "CONTENT_REVIEWED_SEND_PREFLIGHT") {
        return { ok: true, platformJobId: "1980000401", resumeMode: "platform_default", actionTier: "primary" };
      }
      if (message.type === "CONTENT_REVIEWED_SEND_EXECUTE") {
        return { ok: true, application: "verified", greeting: "verified", evidenceCodes: ["application_status_verified", "outbound_greeting_exact_match"] };
      }
      return undefined;
    });

    await dispatchRuntime({ type: "RESUME_BATCH" }, {} as chrome.runtime.MessageSender);
    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledOnce());
    const lease = batchRunSchema.parse(localData[STORAGE_KEYS.run]).items[0]?.leaseId;
    expect(lease).toBeTypeOf("string");
    const reopened = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    reopened.items[0]!.startedAt = new Date(Date.now() - 8_000).toISOString();
    localData[STORAGE_KEYS.run] = reopened;
    await dispatchDetailWithLease(detailJob("岗位职责：负责建设高可用任务平台和稳定性体系。"), lease!);
    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);
    await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).status).toBe("completed"));

    expect(modelOperations()).toContain("evaluate_opportunity");
    expect(modelOperations()).toContain("generate_greeting");
    const completed = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    expect(completed.items[0]).toMatchObject({
      status: "delivery_succeeded",
      draftRevisionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    });
    expect(completed.items[0]?.draftSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("executes after an elapsed interval alarm without redrawing the stored delay", async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const run = automaticRunningBatch("waiting_interval");
    run.nextWriteEligibleAt = past;
    run.items[0]!.draftSha256 = await sourceHash(draft().currentText);
    localData[STORAGE_KEYS.run] = run;
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "automatic_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" },
      automaticSendDelayMinSeconds: 5,
      automaticSendDelayMaxSeconds: 5
    });
    localData[STORAGE_KEYS.automaticWriteThrottle] = {
      ownerId: userId,
      platform: "liepin",
      lastWriteStartedAt: new Date(Date.now() - 6000).toISOString(),
      scheduledDelaySeconds: 37,
      nextWriteEligibleAt: past
    };
    backend.listDrafts.mockResolvedValue([draft()]);
    backend.listOpportunities.mockResolvedValue([{ ...opportunity(), status: "draft_ready" }]);
    (chrome.tabs.sendMessage as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_tabId: number, message: { type?: string }) => {
      if (message.type === "CONTENT_REVIEWED_SEND_PREFLIGHT") {
        return { ok: true, platformJobId: "1980000401", resumeMode: "platform_default", actionTier: "primary" };
      }
      if (message.type === "CONTENT_REVIEWED_SEND_EXECUTE") {
        return { ok: true, application: "verified", greeting: "verified", evidenceCodes: ["application_status_verified", "outbound_greeting_exact_match"] };
      }
      return undefined;
    });

    alarmListener?.({ name: "jobflow:auto-write:" + run.id, scheduledTime: Date.now() } as chrome.alarms.Alarm);
    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);
    await vi.waitFor(() => expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).status).toBe("completed"));

    expect(backend.reserveReviewedDeliveryQuota).toHaveBeenCalledOnce();
    expect(backend.markReviewedDeliveryWriteStarted).toHaveBeenCalledOnce();
  });

  it("reschedules the same future interval on early wake without quota or redraw", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const run = automaticRunningBatch("waiting_interval");
    run.nextWriteEligibleAt = future;
    run.items[0]!.draftSha256 = await sourceHash(draft().currentText);
    localData[STORAGE_KEYS.run] = run;
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "automatic_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" }
    });
    localData[STORAGE_KEYS.automaticWriteThrottle] = {
      ownerId: userId,
      platform: "liepin",
      lastWriteStartedAt: new Date().toISOString(),
      scheduledDelaySeconds: 37,
      nextWriteEligibleAt: future
    };

    alarmListener?.({ name: "jobflow:auto-write:" + run.id, scheduledTime: Date.now() } as chrome.alarms.Alarm);
    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);
    await vi.waitFor(() => expect(chrome.alarms.create).toHaveBeenCalledWith("jobflow:auto-write:" + run.id, {
      when: new Date(future).getTime()
    }));

    const waiting = batchRunSchema.parse(localData[STORAGE_KEYS.run]);
    expect(waiting.items[0]?.status).toBe("waiting_interval");
    expect(waiting.nextWriteEligibleAt).toBe(future);
    expect(localData[STORAGE_KEYS.automaticWriteThrottle]).toMatchObject({ scheduledDelaySeconds: 37 });
    expect(backend.reserveReviewedDeliveryQuota).not.toHaveBeenCalled();
  });

  it("does not execute while waiting when paused or cancelled, and cancel clears the auto alarm", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const run = automaticRunningBatch("waiting_interval");
    run.nextWriteEligibleAt = future;
    run.items[0]!.draftSha256 = await sourceHash(draft().currentText);
    localData[STORAGE_KEYS.run] = run;
    localData[STORAGE_KEYS.automaticWriteThrottle] = {
      ownerId: userId,
      platform: "liepin",
      lastWriteStartedAt: new Date().toISOString(),
      scheduledDelaySeconds: 37,
      nextWriteEligibleAt: future
    };

    await dispatchRuntime({ type: "PAUSE_BATCH" }, {} as chrome.runtime.MessageSender);
    alarmListener?.({ name: "jobflow:auto-write:" + run.id, scheduledTime: Date.now() } as chrome.alarms.Alarm);
    alarmListener?.({ name: "jobflow:queue", scheduledTime: Date.now() } as chrome.alarms.Alarm);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(backend.reserveReviewedDeliveryQuota).not.toHaveBeenCalled();

    await dispatchRuntime({ type: "CANCEL_BATCH" }, {} as chrome.runtime.MessageSender);
    expect(chrome.alarms.clear).toHaveBeenCalledWith("jobflow:auto-write:" + run.id);
    expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).status).toBe("cancelled");
  });

  it("ignores stale automatic interval alarms for prior runs", async () => {
    const run = automaticRunningBatch("delivery_ready");
    run.id = "22222222-2222-4222-8222-222222222222";
    run.items[0]!.draftSha256 = await sourceHash(draft().currentText);
    localData[STORAGE_KEYS.run] = run;
    localData[STORAGE_KEYS.settings] = settings({}, {
      executionPolicy: "automatic_send",
      model: { ...DEFAULT_SETTINGS.model, route: "managed" }
    });

    alarmListener?.({ name: "jobflow:auto-write:11111111-1111-4111-8111-111111111111", scheduledTime: Date.now() } as chrome.alarms.Alarm);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chrome.alarms.create).not.toHaveBeenCalledWith("jobflow:queue", expect.anything());
    expect(backend.reserveReviewedDeliveryQuota).not.toHaveBeenCalled();
    expect(batchRunSchema.parse(localData[STORAGE_KEYS.run]).id).toBe(run.id);
  });
});
