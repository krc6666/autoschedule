import { createDefaultState } from "../defaults";
import type { AppState } from "../model";
import { restorePersistedState } from "./state-restoration";

export const STORAGE_KEY = "autoschedule.state.v1";

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
): AppState {
  const next = { ...state, updatedAt: new Date().toISOString() };
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function clearState(
  storage: Pick<Storage, "removeItem"> = localStorage
): void {
  storage.removeItem(STORAGE_KEY);
}
