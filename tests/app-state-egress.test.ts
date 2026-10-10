import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/defaults";
import type { AppState, AppStateQuery, OpportunityRecord, ResumeProfile } from "../src/types";

const backend = vi.hoisted(() => ({
  getAuthProjection: vi.fn(), loadActiveFilterConfig: vi.fn(), listOpportunityPage: vi.fn(),
  getOpportunity: vi.fn(), getDraft: vi.fn(), listDeliveryRecords: vi.fn(),
  listEvaluations: vi.fn(), listOpportunityEvents: vi.fn(), listResumeProfiles: vi.fn(),
  listOpportunities: vi.fn(), listDrafts: vi.fn(), appendUserEvent: vi.fn(),
  activateProfile: vi.fn(), invokeModelGateway: vi.fn()
}));
const storage = vi.hoisted(() => ({
  ensureDeviceOwner: vi.fn(), loadSettings: vi.fn(), saveSettings: vi.fn(),
  getRun: vi.fn(), getScanPreview: vi.fn()
}));
vi.mock("../src/backend/supabase", async (original) => ({
  ...await original<typeof import("../src/backend/supabase")>(), ...backend
}));
vi.mock("../src/storage", async (original) => ({
  ...await original<typeof import("../src/storage")>(), ...storage
}));
vi.mock("../src/local/resume-store", () => ({
  getResumeMetadata: vi.fn(async () => null), deleteUserResumes: vi.fn()
}));

const ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const jobA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const jobB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
let owner = ownerA;
let listener: (message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => boolean;

function opportunity(id = jobA): OpportunityRecord {
  return {
    id, userId: owner, platform: "liepin", platformJobId: id === jobA ? "1980000001" : "1980000002",
    canonicalUrl: "https://www.liepin.com/a/1980000001.shtml", title: "合成研发职位",
    company: "合成科技", location: "北京", salary: "30k", experience: "3年", education: "本科", cardText: "",
    status: "review_required", firstSeenAt: "2026-09-01T00:00:00Z", lastSeenAt: "2026-09-01T00:00:00Z"
  };
}

function profile(): ResumeProfile {
  return {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", version: 1, state: "active", sourceHash: "a".repeat(64),
    sourceName: "synthetic.txt", sourceKind: "text", analyzedAt: "2026-09-01T00:00:00Z",
    summary: "合成工程经历", targetRoles: [], skills: [], facts: [], constraints: []
  };
}

async function dispatch(message: object): Promise<{ ok: boolean; data?: AppState; error?: string }> {
  return new Promise((resolve) => {
    listener(message, { id: "test-extension", url: "chrome-extension://test-extension/options.html" },
      (response) => resolve(response as { ok: boolean; data?: AppState; error?: string }));
  });
}

async function state(query: AppStateQuery = {}): Promise<AppState> {
  const response = await dispatch({ type: "GET_APP_STATE", ...query });
  expect(response.error).toBeUndefined();
  expect(response.ok).toBe(true);
  return response.data!;
}

function expectNoWholeHistoryReads() {
  expect(backend.listOpportunities).not.toHaveBeenCalled();
  expect(backend.listDrafts).not.toHaveBeenCalled();
  for (const [id] of backend.listEvaluations.mock.calls) expect(id).toBeTruthy();
  for (const [id] of backend.listOpportunityEvents.mock.calls) expect(id).toBeTruthy();
  for (const [ids] of backend.listDeliveryRecords.mock.calls) expect(ids.length).toBeGreaterThan(0);
}

describe("GET_APP_STATE egress budget", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    owner = ownerA;
    backend.getAuthProjection.mockImplementation(async () => ({ status: "signed_in", userId: owner,
      email: "synthetic@example.invalid", emailVerificationStatus: "unverified", vip: false }));
    backend.loadActiveFilterConfig.mockResolvedValue(null);
    backend.listOpportunityPage.mockImplementation(async () => ({ opportunities: [opportunity()], hasNext: false }));
    backend.getOpportunity.mockImplementation(async (id: string) => ({ ...opportunity(id), description: "合成完整 JD" }));
    backend.getDraft.mockResolvedValue(null);
    backend.listDeliveryRecords.mockResolvedValue([]);
    backend.listEvaluations.mockResolvedValue([]);
    backend.listOpportunityEvents.mockResolvedValue([]);
    backend.listResumeProfiles.mockResolvedValue([profile()]);
    backend.appendUserEvent.mockResolvedValue(undefined);
    storage.loadSettings.mockImplementation(async () => structuredClone(DEFAULT_SETTINGS));
    storage.getRun.mockResolvedValue(null);
    storage.getScanPreview.mockResolvedValue(null);
    vi.stubGlobal("chrome", {
      runtime: {
        id: "test-extension", getURL: (path: string) => "chrome-extension://test-extension/" + path,
        onMessage: { addListener: (handler: typeof listener) => { listener = handler; } },
        onInstalled: { addListener: vi.fn() }, onStartup: { addListener: vi.fn() }, sendMessage: vi.fn(async () => undefined)
      },
      alarms: { onAlarm: { addListener: vi.fn() }, create: vi.fn(), clear: vi.fn() },
      storage: { local: { setAccessLevel: vi.fn() }, session: { setAccessLevel: vi.fn() } },
      tabs: { create: vi.fn(), sendMessage: vi.fn(), query: vi.fn(async () => []) }
    });
    await import("../src/background");
  });

  it("100 stage snapshots share one small summary read and never download full history", async () => {
    for (let index = 0; index < 100; index += 1) {
      const snapshot = await state();
      expect(snapshot.opportunities).toHaveLength(1);
      expect(snapshot.drafts).toEqual([]);
      expect(snapshot.resumeProfiles).toEqual([]);
    }
    expect(backend.listOpportunityPage).toHaveBeenCalledExactlyOnceWith({
      page: 0, status: undefined, search: undefined, pageSize: 8
    });
    expect(backend.listDeliveryRecords).toHaveBeenCalledExactlyOnceWith([jobA]);
    expect(backend.loadActiveFilterConfig).toHaveBeenCalledTimes(1);
    expect(backend.getOpportunity).not.toHaveBeenCalled();
    expect(backend.getDraft).not.toHaveBeenCalled();
    expect(backend.listResumeProfiles).not.toHaveBeenCalled();
    expect(backend.listEvaluations).not.toHaveBeenCalled();
    expect(backend.listOpportunityEvents).not.toHaveBeenCalled();
    expectNoWholeHistoryReads();
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(backend.invokeModelGateway).not.toHaveBeenCalled();
  });

  it("coalesces concurrent side panel and repeated UI refresh snapshots", async () => {
    const responses = await Promise.all(Array.from({ length: 25 }, () => state({ view: "sidepanel" })));
    expect(responses).toHaveLength(25);
    expect(backend.listOpportunityPage).toHaveBeenCalledTimes(1);
    expect(backend.listDeliveryRecords).toHaveBeenCalledTimes(1);
    expect(backend.loadActiveFilterConfig).toHaveBeenCalledTimes(1);
  });

  it("cached remote data does not hide new local batch progress", async () => {
    const first = await state();
    expect(first.run).toBeNull();
    // This boundary deliberately provides only fields read by the snapshot code.
    storage.getRun.mockResolvedValue({ status: "running", currentIndex: 0,
      items: [{ opportunityId: jobA, status: "evaluating" }] });
    const second = await state();
    expect(second.run?.items[0]?.status).toBe("evaluating");
    storage.getRun.mockResolvedValue({ status: "running", currentIndex: 0,
      items: [{ opportunityId: jobA, status: "generating" }] });
    const third = await state();
    expect(third.run?.items[0]?.status).toBe("generating");
    expect(backend.listOpportunityPage).toHaveBeenCalledTimes(1);
    expect(backend.listDeliveryRecords).toHaveBeenCalledTimes(1);
  });

  it("reads one 50-item records page and exactly the selected job's detail and history", async () => {
    backend.listOpportunityPage.mockResolvedValue({ opportunities: [opportunity(jobA)], hasNext: true });
    const snapshot = await state({ view: "records", page: 3, recordFilter: "review_required",
      recordSearch: "  合成  ", opportunityId: jobB });
    expect(backend.listOpportunityPage).toHaveBeenCalledExactlyOnceWith({
      page: 3, status: "review_required", search: "合成", pageSize: 50
    });
    expect(snapshot.recordPage).toEqual({ page: 3, hasNext: true });
    expect(snapshot.recordDetail?.id).toBe(jobB);
    expect(backend.getOpportunity).toHaveBeenCalledExactlyOnceWith(jobB);
    expect(backend.getDraft).toHaveBeenCalledExactlyOnceWith(jobB);
    expect(backend.listEvaluations).toHaveBeenCalledExactlyOnceWith(jobB);
    expect(backend.listOpportunityEvents).toHaveBeenCalledExactlyOnceWith(jobB);
    expect(backend.listDeliveryRecords).toHaveBeenCalledExactlyOnceWith([jobA, jobB]);
    expect(backend.listResumeProfiles).not.toHaveBeenCalled();
    expectNoWholeHistoryReads();
  });

  it("changing selected records reuses summaries and already opened details", async () => {
    await state({ view: "records", opportunityId: jobA });
    await state({ view: "records", opportunityId: jobB });
    await state({ view: "records", opportunityId: jobA });
    expect(backend.listOpportunityPage).toHaveBeenCalledTimes(1);
    expect(backend.getOpportunity.mock.calls).toEqual([[jobA], [jobB]]);
    expect(backend.getDraft.mock.calls).toEqual([[jobA], [jobB]]);
    expectNoWholeHistoryReads();
  });

  it("loads evidence profiles only when the selected detail contains evaluations", async () => {
    backend.listEvaluations.mockResolvedValue([{ opportunityId: jobA, profileId: profile().id }]);
    const snapshot = await state({ view: "records", opportunityId: jobA });
    expect(snapshot.resumeProfiles).toEqual([profile()]);
    await state({ view: "records", opportunityId: jobA });
    expect(backend.listResumeProfiles).toHaveBeenCalledTimes(1);
    expect(backend.listEvaluations).toHaveBeenCalledExactlyOnceWith(jobA);
  });

  it.each(["account", "model", "rules"] as const)("%s does not download any record collection", async (view) => {
    const snapshot = await state({ view });
    expect(snapshot.opportunities).toEqual([]);
    expect(backend.listOpportunityPage).not.toHaveBeenCalled();
    expect(backend.listDeliveryRecords).not.toHaveBeenCalled();
    expect(backend.listResumeProfiles).not.toHaveBeenCalled();
    expect(backend.getOpportunity).not.toHaveBeenCalled();
    expectNoWholeHistoryReads();
  });

  it("resume view loads only profiles, caching repeated views", async () => {
    const snapshot = await state({ view: "resume" });
    await state({ view: "resume" });
    expect(snapshot.resumeProfile?.id).toBe(profile().id);
    expect(backend.listResumeProfiles).toHaveBeenCalledTimes(1);
    expect(backend.listOpportunityPage).not.toHaveBeenCalled();
    expect(backend.listDeliveryRecords).not.toHaveBeenCalled();
    expectNoWholeHistoryReads();
  });

  it("explicit refresh bypasses cached display queries", async () => {
    await state();
    await state({ refresh: true });
    expect(backend.listOpportunityPage).toHaveBeenCalledTimes(2);
    expect(backend.listDeliveryRecords).toHaveBeenCalledTimes(2);
    expect(backend.getAuthProjection).toHaveBeenCalledWith({ cached: false });
  });

  it("includes the prior partial delivery outside recent summaries so recovery reason stays accurate", async () => {
    const currentId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    storage.getRun.mockResolvedValue({ currentIndex: 1, status: "paused", items: [
      { status: "delivery_partial", opportunityId: jobB },
      { status: "queued", opportunityId: currentId }
    ] });
    await state({ view: "sidepanel" });
    expect(backend.listDeliveryRecords).toHaveBeenCalledWith([jobA, jobB, currentId].sort());
    expect(backend.getOpportunity).not.toHaveBeenCalled();
    expectNoWholeHistoryReads();
  });

  it("read errors remain visible and the next attempt retries", async () => {
    backend.listOpportunityPage.mockRejectedValueOnce(new Error("network interrupted"));
    expect(await dispatch({ type: "GET_APP_STATE" })).toEqual({ ok: false, error: "network interrupted" });
    await state();
    expect(backend.listOpportunityPage).toHaveBeenCalledTimes(2);
  });

  it("signed-out snapshots return no cached private records and make no history reads", async () => {
    await state({ view: "records", opportunityId: jobA });
    const reads = backend.listOpportunityPage.mock.calls.length;
    backend.getAuthProjection.mockResolvedValue({ status: "signed_out" });
    const snapshot = await state({ view: "records", opportunityId: jobA });
    expect(snapshot.opportunities).toEqual([]);
    expect(snapshot.drafts).toEqual([]);
    expect(snapshot.resumeProfiles).toEqual([]);
    expect(snapshot.recordDetail).toBeUndefined();
    expect(backend.listOpportunityPage).toHaveBeenCalledTimes(reads);
  });

  it("owner switches cannot reuse summaries or return an old pending snapshot", async () => {
    let release!: (value: { opportunities: OpportunityRecord[]; hasNext: boolean }) => void;
    const oldData = { opportunities: [opportunity()], hasNext: false };
    backend.listOpportunityPage.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const oldRequest = state();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    owner = ownerB;
    const newSnapshot = await state();
    expect(newSnapshot.auth.userId).toBe(ownerB);
    expect(newSnapshot.opportunities[0]?.userId).toBe(ownerB);
    release(oldData);
    const completedOldRequest = await oldRequest;
    expect(completedOldRequest.auth.userId).toBe(ownerB);
    expect(completedOldRequest.opportunities[0]?.userId).toBe(ownerB);
  });

  it("manual exclusion invalidates the changed record and summaries without refetching unrelated detail", async () => {
    await state({ view: "records", opportunityId: jobA });
    await state({ view: "records", opportunityId: jobB });
    const response = await dispatch({ type: "REVIEW_DECISION", opportunityId: jobA, decision: "permanently_exclude" });
    expect(response).toEqual({ ok: true });
    await state({ view: "records", opportunityId: jobA });
    await state({ view: "records", opportunityId: jobB });
    expect(backend.getOpportunity.mock.calls).toEqual([[jobA], [jobB], [jobA]]);
    expect(backend.listOpportunityPage).toHaveBeenCalledTimes(2);
    expect(backend.appendUserEvent).toHaveBeenCalledTimes(1);
    expectNoWholeHistoryReads();
  });

  it("a late old-owner cloud-rules response never persists settings over the new account", async () => {
    let release!: (rules: typeof DEFAULT_SETTINGS.rules) => void;
    backend.loadActiveFilterConfig.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const oldRequest = state({ view: "rules" });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    owner = ownerB;
    const newSettings = { ...structuredClone(DEFAULT_SETTINGS), executionPolicy: "draft_only" as const,
      model: { ...DEFAULT_SETTINGS.model, model: "synthetic-new-owner-model" } };
    storage.loadSettings.mockResolvedValue(newSettings);
    await state({ view: "account" });
    release({ ...DEFAULT_SETTINGS.rules, travel: "none" });
    const oldResponse = await oldRequest;
    expect(oldResponse.auth.userId).toBe(ownerB);
    expect(oldResponse.settings.executionPolicy).toBe("draft_only");
    expect(oldResponse.settings.model.model).toBe("synthetic-new-owner-model");
    expect(storage.saveSettings).not.toHaveBeenCalled();
  });
});
