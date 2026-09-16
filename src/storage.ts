import { DEFAULT_SETTINGS, LEGACY_STORAGE_KEYS, STORAGE_KEYS } from "./defaults";
import {
  automaticWriteThrottleSchema,
  batchRunSchema,
  extensionSettingsSchema,
  liepinNavigationThrottleSchema,
  scanPreviewSchema
} from "./domain/messages";
import type {
  AutomaticWriteThrottle,
  BatchRun,
  ExtensionSettings,
  LiepinNavigationThrottle,
  PlatformKey,
  ScanPreview
} from "./types";

export async function loadSettings(): Promise<ExtensionSettings> {
  const value: unknown = (await chrome.storage.local.get(STORAGE_KEYS.settings))[STORAGE_KEYS.settings];
  const normalized = value && typeof value === "object"
    ? { ...structuredClone(DEFAULT_SETTINGS), ...(value as Record<string, unknown>) }
    : value;
  const parsed = extensionSettingsSchema.safeParse(normalized);
  return parsed.success ? parsed.data : structuredClone(DEFAULT_SETTINGS);
}

export async function saveSettings(settings: ExtensionSettings): Promise<ExtensionSettings> {
  const parsed = extensionSettingsSchema.parse(settings);
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: parsed });
  return parsed;
}

export async function getAutomaticWriteThrottle(
  ownerId: string,
  platform: PlatformKey
): Promise<AutomaticWriteThrottle | null> {
  const value: unknown = (await chrome.storage.local.get(STORAGE_KEYS.automaticWriteThrottle))[STORAGE_KEYS.automaticWriteThrottle];
  const parsed = automaticWriteThrottleSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data.ownerId === ownerId && parsed.data.platform === platform ? parsed.data : null;
}

export async function saveAutomaticWriteThrottle(throttle: AutomaticWriteThrottle): Promise<void> {
  const parsed = automaticWriteThrottleSchema.parse(throttle);
  await chrome.storage.local.set({ [STORAGE_KEYS.automaticWriteThrottle]: parsed });
}

export async function clearAutomaticWriteThrottle(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.automaticWriteThrottle);
}

export async function getLiepinNavigationThrottle(
  ownerId: string,
  platform: PlatformKey
): Promise<LiepinNavigationThrottle | null> {
  const value: unknown = (await chrome.storage.local.get(STORAGE_KEYS.liepinNavigationThrottle))[STORAGE_KEYS.liepinNavigationThrottle];
  const parsed = liepinNavigationThrottleSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data.ownerId === ownerId && parsed.data.platform === platform ? parsed.data : null;
}

export async function saveLiepinNavigationThrottle(throttle: LiepinNavigationThrottle): Promise<void> {
  const parsed = liepinNavigationThrottleSchema.parse(throttle);
  await chrome.storage.local.set({ [STORAGE_KEYS.liepinNavigationThrottle]: parsed });
}

export async function clearLiepinNavigationThrottle(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.liepinNavigationThrottle);
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
  const parsed = batchRunSchema.parse({
    ...run,
    updatedAt: new Date().toISOString()
  });
  await chrome.storage.local.set({ [STORAGE_KEYS.run]: parsed });
}

export async function getScanPreview(): Promise<ScanPreview | null> {
  const value: unknown = (await chrome.storage.local.get(STORAGE_KEYS.scanPreview))[STORAGE_KEYS.scanPreview];
  const parsed = scanPreviewSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function saveScanPreview(preview: ScanPreview | null): Promise<void> {
  if (preview) {
    const parsed = scanPreviewSchema.parse(preview);
    await chrome.storage.local.set({ [STORAGE_KEYS.scanPreview]: parsed });
  }
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
    STORAGE_KEYS.scanPreview,
    STORAGE_KEYS.automaticWriteThrottle,
    STORAGE_KEYS.liepinNavigationThrottle
  ]);
  await chrome.storage.local.set({ [STORAGE_KEYS.deviceOwner]: userId });
}

export async function clearDeviceOwner(): Promise<void> {
  await clearByokKey();
  await chrome.storage.local.remove([
    STORAGE_KEYS.deviceOwner,
    STORAGE_KEYS.settings,
    STORAGE_KEYS.run,
    STORAGE_KEYS.scanPreview,
    STORAGE_KEYS.automaticWriteThrottle,
    STORAGE_KEYS.liepinNavigationThrottle
  ]);
}
