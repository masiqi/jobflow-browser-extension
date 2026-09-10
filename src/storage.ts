import { DEFAULT_SETTINGS, LEGACY_STORAGE_KEYS, STORAGE_KEYS } from "./defaults";
import { batchRunSchema, extensionSettingsSchema, scanPreviewSchema } from "./domain/messages";
import type { BatchRun, ExtensionSettings, ScanPreview } from "./types";

export async function loadSettings(): Promise<ExtensionSettings> {
  const value: unknown = (await chrome.storage.local.get(STORAGE_KEYS.settings))[STORAGE_KEYS.settings];
  const parsed = extensionSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : structuredClone(DEFAULT_SETTINGS);
}

export async function saveSettings(settings: ExtensionSettings): Promise<ExtensionSettings> {
  const parsed = extensionSettingsSchema.parse(settings);
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: parsed });
  return parsed;
}

interface StoredKey {
  ownerId: string;
  value: string;
}

function isStoredKey(value: unknown, userId: string): value is StoredKey {
  return Boolean(value && typeof value === "object"
    && (value as { ownerId?: unknown }).ownerId === userId
    && typeof (value as { value?: unknown }).value === "string");
}

export async function getByokKey(userId: string): Promise<string> {
  const sessionValue: unknown = (await chrome.storage.session.get(STORAGE_KEYS.sessionKey))[STORAGE_KEYS.sessionKey];
  if (isStoredKey(sessionValue, userId)) return sessionValue.value;
  const rememberedValue: unknown = (await chrome.storage.local.get(STORAGE_KEYS.rememberedKey))[STORAGE_KEYS.rememberedKey];
  return isStoredKey(rememberedValue, userId) ? rememberedValue.value : "";
}

export async function setByokKey(apiKey: string, remember: boolean, userId: string): Promise<void> {
  const record: StoredKey = { ownerId: userId, value: apiKey };
  if (remember) {
    await chrome.storage.local.set({ [STORAGE_KEYS.rememberedKey]: record });
    await chrome.storage.session.remove(STORAGE_KEYS.sessionKey);
  } else {
    await chrome.storage.session.set({ [STORAGE_KEYS.sessionKey]: record });
    await chrome.storage.local.remove(STORAGE_KEYS.rememberedKey);
  }
}

export async function clearByokKey(): Promise<void> {
  await chrome.storage.session.remove(STORAGE_KEYS.sessionKey);
  await chrome.storage.local.remove(STORAGE_KEYS.rememberedKey);
}

export async function getRun(): Promise<BatchRun | null> {
  const value: unknown = (await chrome.storage.local.get(STORAGE_KEYS.run))[STORAGE_KEYS.run];
  const parsed = batchRunSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function saveRun(run: BatchRun): Promise<void> {
  run.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ [STORAGE_KEYS.run]: run });
}

export async function getScanPreview(): Promise<ScanPreview | null> {
  const value: unknown = (await chrome.storage.local.get(STORAGE_KEYS.scanPreview))[STORAGE_KEYS.scanPreview];
  const parsed = scanPreviewSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function saveScanPreview(preview: ScanPreview | null): Promise<void> {
  if (preview) await chrome.storage.local.set({ [STORAGE_KEYS.scanPreview]: preview });
  else await chrome.storage.local.remove(STORAGE_KEYS.scanPreview);
}

export async function hasLegacyData(): Promise<boolean> {
  const values = await chrome.storage.local.get([...LEGACY_STORAGE_KEYS]);
  return LEGACY_STORAGE_KEYS.some((key) => values[key] !== undefined);
}

export async function clearLegacyData(): Promise<void> {
  await chrome.storage.local.remove([...LEGACY_STORAGE_KEYS]);
  await chrome.storage.session.remove([...LEGACY_STORAGE_KEYS]);
}

export async function ensureDeviceOwner(userId: string): Promise<void> {
  const owner: unknown = (await chrome.storage.local.get(STORAGE_KEYS.deviceOwner))[STORAGE_KEYS.deviceOwner];
  if (owner === userId) return;
  await clearByokKey();
  await chrome.storage.local.remove([
    STORAGE_KEYS.settings,
    STORAGE_KEYS.run,
    STORAGE_KEYS.scanPreview
  ]);
  await chrome.storage.local.set({ [STORAGE_KEYS.deviceOwner]: userId });
}

export async function clearDeviceOwner(): Promise<void> {
  await clearByokKey();
  await chrome.storage.local.remove([
    STORAGE_KEYS.deviceOwner,
    STORAGE_KEYS.settings,
    STORAGE_KEYS.run,
    STORAGE_KEYS.scanPreview
  ]);
}
