import { createDefaultState } from "../defaults";
import type { AppState } from "../model";

export const STORAGE_KEY = "autoschedule.state.v1";

function isState(value: unknown): value is AppState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AppState>;
  return candidate.version === 1
    && Array.isArray(candidate.staff)
    && Array.isArray(candidate.flights)
    && Array.isArray(candidate.templates)
    && Array.isArray(candidate.positionRules)
    && Array.isArray(candidate.history)
    && Array.isArray(candidate.assignments)
    && typeof candidate.settings === "object";
}

export function loadState(storage: Pick<Storage, "getItem"> = localStorage): AppState {
  const fallback = createDefaultState();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!isState(parsed)) return fallback;
    const next: AppState = {
      ...fallback,
      ...parsed,
      settings: { ...fallback.settings, ...parsed.settings }
    };
    next.positionRules = next.positionRules.map((rule) => ({ ...rule, minPassengers: Number(rule.minPassengers) || 0 }));
    next.assignments = next.assignments.map((assignment) => ({ ...assignment, manualRemark: assignment.manualRemark ?? "" }));
    return next;
  } catch {
    return fallback;
  }
}

export function saveState(state: AppState, storage: Pick<Storage, "setItem"> = localStorage): AppState {
  const next = { ...state, updatedAt: new Date().toISOString() };
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function clearState(storage: Pick<Storage, "removeItem"> = localStorage): void {
  storage.removeItem(STORAGE_KEY);
}
