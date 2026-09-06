import type { BatchRun, LedgerEntry } from "./types";
import { STORAGE_KEYS } from "./defaults";

export async function getRun(): Promise<BatchRun | null> {
  return ((await chrome.storage.local.get(STORAGE_KEYS.run))[STORAGE_KEYS.run] as BatchRun | undefined) || null;
}
export async function saveRun(run: BatchRun): Promise<void> {
  run.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ [STORAGE_KEYS.run]: run });
}
export async function listLedger(): Promise<Record<string, LedgerEntry>> {
  return ((await chrome.storage.local.get(STORAGE_KEYS.ledger))[STORAGE_KEYS.ledger] as Record<string, LedgerEntry> | undefined) || {};
}
export async function upsertLedger(entry: LedgerEntry): Promise<void> {
  const records = await listLedger();
  records[entry.key] = entry;
  await chrome.storage.local.set({ [STORAGE_KEYS.ledger]: records });
}
