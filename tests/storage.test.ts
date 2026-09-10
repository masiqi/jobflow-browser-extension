import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../src/defaults";
import {
  ensureDeviceOwner,
  getByokKey,
  getRun,
  getScanPreview,
  loadSettings,
  saveSettings,
  setByokKey
} from "../src/storage";

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
    await setByokKey("synthetic-key", false, "user-a");
    local.set(STORAGE_KEYS.run, { id: "old-run" });
    local.set(STORAGE_KEYS.scanPreview, { sourceUrl: "old-preview" });

    await ensureDeviceOwner("user-b");

    expect(local.get(STORAGE_KEYS.deviceOwner)).toBe("user-b");
    expect(local.has(STORAGE_KEYS.run)).toBe(false);
    expect(local.has(STORAGE_KEYS.scanPreview)).toBe(false);
    expect(await getByokKey("user-b")).toBe("");
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("rejects malformed persisted run and scan state", async () => {
    local.set(STORAGE_KEYS.run, { id: "shallow-but-invalid", items: [] });
    local.set(STORAGE_KEYS.scanPreview, { sourceUrl: "not-a-url", candidates: [] });
    expect(await getRun()).toBeNull();
    expect(await getScanPreview()).toBeNull();
  });
});
