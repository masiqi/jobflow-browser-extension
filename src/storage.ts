import type { ExtensionSettings } from "./types";
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "./defaults";

export async function loadSettings(): Promise<ExtensionSettings> {
  const saved = (await chrome.storage.local.get(STORAGE_KEYS.settings))[STORAGE_KEYS.settings] as Partial<ExtensionSettings> | undefined;
  const secret = (await chrome.storage.session.get(STORAGE_KEYS.secret))[STORAGE_KEYS.secret];
  const merged: ExtensionSettings = {
    ...DEFAULT_SETTINGS,
    ...saved,
    model: { ...DEFAULT_SETTINGS.model, ...saved?.model },
    filters: { ...DEFAULT_SETTINGS.filters, ...saved?.filters, directions: saved?.filters?.directions || DEFAULT_SETTINGS.filters.directions },
    resumeProfile: saved?.resumeProfile || null,
    liveUnlocked: false
  };
  if (!merged.model.persistApiKey) merged.model.apiKey = typeof secret === "string" ? secret : "";
  return merged;
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  const persisted: ExtensionSettings = structuredClone(settings);
  persisted.liveUnlocked = false;
  if (!settings.model.persistApiKey) {
    await chrome.storage.session.set({ [STORAGE_KEYS.secret]: settings.model.apiKey });
    persisted.model.apiKey = "";
  } else {
    await chrome.storage.session.remove(STORAGE_KEYS.secret);
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: persisted });
}
