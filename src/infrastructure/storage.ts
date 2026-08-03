import { createDefaultState } from "../defaults";
import type { AppState } from "../model";
import { restorePersistedState } from "./state-restoration";

export const STORAGE_KEY = "autoschedule.state.v1";
export const STORAGE_CAPACITY_WARNING_BYTES = 4 * 1024 * 1024;

export interface StateSaveResult {
  state: AppState;
  sizeBytes: number;
  nearCapacity: boolean;
}

export function loadState(
  storage: Pick<Storage, "getItem"> = localStorage
): AppState {
  const fallback = createDefaultState();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return restorePersistedState(parsed, fallback) ?? fallback;
  } catch {
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
  return {
    state: next,
    sizeBytes,
    nearCapacity: sizeBytes >= STORAGE_CAPACITY_WARNING_BYTES,
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
