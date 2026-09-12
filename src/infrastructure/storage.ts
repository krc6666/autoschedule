import { createDefaultState } from "../defaults";
import type { AppState } from "../model";
import {
  clearLastRestorationReport,
  recordRestorationIssue,
  restorePersistedState,
} from "./state-restoration";

export const STORAGE_KEY = "autoschedule.state.v1";
export const STORAGE_CAPACITY_WARNING_BYTES = 4 * 1024 * 1024;

export interface StateSaveResult {
  state: AppState;
  sizeBytes: number;
  nearCapacity: boolean;
}

interface StorageEstimateSnapshot {
  usage: number;
  quota: number;
}

let storageEstimate: StorageEstimateSnapshot | null = null;

export async function refreshStorageEstimate(
  manager: Pick<StorageManager, "estimate"> | undefined = globalThis.navigator
    ?.storage
): Promise<StorageEstimateSnapshot | null> {
  if (!manager) return storageEstimate;
  try {
    const estimate = await manager.estimate();
    if (
      typeof estimate.usage !== "number" ||
      typeof estimate.quota !== "number" ||
      !Number.isFinite(estimate.usage) ||
      !Number.isFinite(estimate.quota) ||
      estimate.quota <= 0
    )
      return storageEstimate;
    storageEstimate = {
      usage: Math.max(0, estimate.usage),
      quota: estimate.quota,
    };
    return storageEstimate;
  } catch {
    return storageEstimate;
  }
}

export function resetStorageEstimate(): void {
  storageEstimate = null;
}

export function loadState(
  storage: Pick<Storage, "getItem"> = localStorage
): AppState {
  clearLastRestorationReport();
  void refreshStorageEstimate();
  const fallback = createDefaultState();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return restorePersistedState(parsed, fallback) ?? fallback;
  } catch (error) {
    recordRestorationIssue(
      `持久化数据无法读取：${error instanceof Error ? error.message : String(error)}`
    );
    return fallback;
  }
}

export function saveState(
  state: AppState,
  storage: Pick<Storage, "setItem"> = localStorage
): StateSaveResult {
  const next = { ...state, updatedAt: new Date().toISOString() };
  const serialized = JSON.stringify(next);
  const sizeBytes = new Blob([serialized]).size;
  storage.setItem(STORAGE_KEY, serialized);
  const availableBytes = storageEstimate
    ? Math.max(0, storageEstimate.quota - storageEstimate.usage)
    : STORAGE_CAPACITY_WARNING_BYTES;
  const warningThreshold = storageEstimate
    ? Math.min(STORAGE_CAPACITY_WARNING_BYTES, availableBytes * 0.8)
    : STORAGE_CAPACITY_WARNING_BYTES;
  return {
    state: next,
    sizeBytes,
    nearCapacity: sizeBytes >= warningThreshold,
  };
}

export function isStorageQuotaExceeded(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return (
    candidate.name === "QuotaExceededError" ||
    candidate.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    candidate.code === 22 ||
    candidate.code === 1014
  );
}

export function clearState(
  storage: Pick<Storage, "removeItem"> = localStorage
): void {
  storage.removeItem(STORAGE_KEY);
}
