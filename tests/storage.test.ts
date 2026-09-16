import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../src/defaults";
import {
  ensureDeviceOwner,
  getAutomaticWriteThrottle,
  getLiepinNavigationThrottle,
  getByokKey,
  getRun,
  getScanPreview,
  loadSettings,
  saveAutomaticWriteThrottle,
  saveLiepinNavigationThrottle,
  saveRun,
  saveScanPreview,
  saveSettings,
  setByokKey
} from "../src/storage";
import type { AutomaticWriteThrottle, BatchRun, LiepinNavigationThrottle, ScanPreview } from "../src/types";

function storageArea(values: Map<string, unknown>) {
  return {
    get: vi.fn(async (keys?: string | string[]) => {
      const selected = typeof keys === "string" ? [keys] : keys ?? [...values.keys()];
      return Object.fromEntries(selected.filter((key) => values.has(key)).map((key) => [key, values.get(key)]));
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) values.set(key, value);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of typeof keys === "string" ? [keys] : keys) values.delete(key);
    })
  };
}

describe("device-owned extension storage", () => {
  const local = new Map<string, unknown>();
  const session = new Map<string, unknown>();

  beforeEach(() => {
    local.clear();
    session.clear();
    vi.stubGlobal("chrome", {
      storage: {
        local: storageArea(local),
        session: storageArea(session)
      }
    });
  });

  it("never returns a BYOK credential to a different user", async () => {
    await setByokKey("synthetic-key", true, "user-a");
    expect(await getByokKey("user-a")).toBe("synthetic-key");
    expect(await getByokKey("user-b")).toBe("");
  });

  it("clears user-scoped device state when the signed-in owner changes", async () => {
    await ensureDeviceOwner("user-a");
    await saveSettings({ ...structuredClone(DEFAULT_SETTINGS), maxJobsPerBatch: 20 });
    await saveAutomaticWriteThrottle({
      ownerId: "user-a",
      platform: "liepin",
      lastWriteStartedAt: "2026-09-12T00:00:00.000Z",
      scheduledDelaySeconds: 17,
      nextWriteEligibleAt: "2026-09-12T00:00:17.000Z"
    });
    await saveLiepinNavigationThrottle({
      ownerId: "user-a",
      platform: "liepin",
      lastNavigationStartedAt: "2026-09-12T00:00:00.000Z",
      scheduledDelaySeconds: 20,
      nextNavigationEligibleAt: "2026-09-12T00:00:20.000Z"
    });
    await setByokKey("synthetic-key", false, "user-a");
    local.set(STORAGE_KEYS.run, { id: "old-run" });
    local.set(STORAGE_KEYS.scanPreview, { sourceUrl: "old-preview" });

    await ensureDeviceOwner("user-b");

    expect(local.get(STORAGE_KEYS.deviceOwner)).toBe("user-b");
    expect(local.has(STORAGE_KEYS.run)).toBe(false);
    expect(local.has(STORAGE_KEYS.scanPreview)).toBe(false);
    expect(await getAutomaticWriteThrottle("user-b", "liepin")).toBeNull();
    expect(await getLiepinNavigationThrottle("user-b", "liepin")).toBeNull();
    expect(await getByokKey("user-b")).toBe("");
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("rejects malformed persisted run and scan state", async () => {
    local.set(STORAGE_KEYS.run, { id: "shallow-but-invalid", items: [] });
    local.set(STORAGE_KEYS.scanPreview, { sourceUrl: "not-a-url", candidates: [] });
    expect(await getRun()).toBeNull();
    expect(await getScanPreview()).toBeNull();
  });

  it("rejects an invalid batch run before overwriting storage", async () => {
    const existing = { id: "existing-run" };
    local.set(STORAGE_KEYS.run, existing);
    const invalidRun = {
      id: "11111111-1111-4111-8111-111111111111",
      platform: "liepin",
      status: "running",
      sourceUrl: "https://www.liepin.com/zhaopin/",
      createdAt: "2026-09-12T00:00:00.000Z",
      updatedAt: "2026-09-12T00:00:00.000Z",
      currentIndex: 0,
      items: [{
        candidate: {
          platform: "liepin",
          jobId: "1980000501",
          url: "https://www.liepin.com/job/1980000501.shtml",
          canonicalUrl: "https://www.liepin.com/job/1980000501.shtml",
          title: "合成职位",
          company: "合成公司",
          location: "北京",
          salary: "20-30k",
          experience: "3年",
          education: "本科",
          cardText: "合成职位卡片",
          index: 0,
          description: "不应写入批次候选项的详情字段"
        },
        status: "queued",
        attempt: 0
      }],
      draftCount: 0,
      excludedCount: 0,
      reviewCount: 0,
      failedCount: 0
    } as unknown as BatchRun;

    await expect(saveRun(invalidRun)).rejects.toThrow();
    expect(local.get(STORAGE_KEYS.run)).toBe(existing);
  });

  it("rejects an invalid scan preview before overwriting storage", async () => {
    const existing = { sourceUrl: "existing-preview" };
    local.set(STORAGE_KEYS.scanPreview, existing);

    await expect(saveScanPreview({
      sourceUrl: "https://www.liepin.com/zhaopin/",
      candidates: [],
      observedCount: 0,
      newCount: 0,
      duplicateCount: 0,
      excludedCount: 0,
      draftedCount: 0,
      processableJobIds: [],
      selectedJobIds: [],
      detailOnlyField: "not allowed"
    } as unknown as ScanPreview)).rejects.toThrow();
    expect(local.get(STORAGE_KEYS.scanPreview)).toBe(existing);
  });

  it("merges new default settings into legacy persisted settings without clearing model test state", async () => {
    const legacySettings = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
    delete legacySettings.executionPolicy;
    delete legacySettings.automaticSendDelayMinSeconds;
    delete legacySettings.automaticSendDelayMaxSeconds;
    delete legacySettings.dailySendLimit;
    legacySettings.model = {
      ...DEFAULT_SETTINGS.model,
      connectionTestedAt: "2026-09-11T00:00:00.000Z",
      testedFingerprint: "synthetic-fingerprint"
    };
    local.set(STORAGE_KEYS.settings, legacySettings);

    expect(await loadSettings()).toMatchObject({
      executionPolicy: "reviewed_send",
      automaticSendDelayMinSeconds: 10,
      automaticSendDelayMaxSeconds: 20,
      dailySendLimit: 150,
      model: {
        connectionTestedAt: "2026-09-11T00:00:00.000Z",
        testedFingerprint: "synthetic-fingerprint"
      }
    });
  });

  it("persists only the current owner's Liepin automatic write throttle", async () => {
    const throttle: AutomaticWriteThrottle = {
      ownerId: "user-a",
      platform: "liepin",
      lastWriteStartedAt: "2026-09-12T00:00:00.000Z",
      scheduledDelaySeconds: 20,
      nextWriteEligibleAt: "2026-09-12T00:00:20.000Z"
    };
    await saveAutomaticWriteThrottle(throttle);

    expect(await getAutomaticWriteThrottle("user-a", "liepin")).toEqual(throttle);
    expect(await getAutomaticWriteThrottle("user-b", "liepin")).toBeNull();

    local.set(STORAGE_KEYS.automaticWriteThrottle, { ...throttle, scheduledDelaySeconds: 601 });
    expect(await getAutomaticWriteThrottle("user-a", "liepin")).toBeNull();
  });

  it("persists only the current owner's validated Liepin navigation throttle", async () => {
    const throttle: LiepinNavigationThrottle = {
      ownerId: "user-a",
      platform: "liepin",
      lastNavigationStartedAt: "2026-09-12T00:00:00.000Z",
      scheduledDelaySeconds: 20,
      nextNavigationEligibleAt: "2026-09-12T00:00:20.000Z"
    };
    await saveLiepinNavigationThrottle(throttle);

    expect(await getLiepinNavigationThrottle("user-a", "liepin")).toEqual(throttle);
    expect(await getLiepinNavigationThrottle("user-b", "liepin")).toBeNull();

    local.set(STORAGE_KEYS.liepinNavigationThrottle, { ...throttle, scheduledDelaySeconds: 601 });
    expect(await getLiepinNavigationThrottle("user-a", "liepin")).toBeNull();
  });
});
