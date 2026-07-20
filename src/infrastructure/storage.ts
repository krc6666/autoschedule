import { createDefaultState } from "../defaults";
import type { AppState } from "../model";
import { orderPositionRules } from "../utils";

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
    const persistedPolicies = Array.isArray(next.settings.positionTransitionPolicies)
      ? next.settings.positionTransitionPolicies
      : fallback.settings.positionTransitionPolicies;
    next.settings.positionTransitionPolicies = persistedPolicies
      .filter((policy) => policy && typeof policy === "object")
      .map((policy) => ({
        ...policy,
        name: String(policy.name ?? "未命名衔接规则").trim() || "未命名衔接规则",
        enabled: Boolean(policy.enabled),
        sourceFlightNo: String(policy.sourceFlightNo ?? "").trim().toUpperCase(),
        sourcePositions: Array.isArray(policy.sourcePositions) ? policy.sourcePositions.map((item) => String(item).trim()).filter(Boolean) : [],
        targetFlightNo: String(policy.targetFlightNo ?? "").trim().toUpperCase(),
        targetPosition: String(policy.targetPosition ?? "").trim(),
        minimumGapMinutes: Math.min(1440, Math.max(0, Math.round(Number(policy.minimumGapMinutes)) || 0)),
        mode: policy.mode === "forbid" ? "forbid" : "prefer"
      }));
    next.settings.rollingLoadProtectionEnabled = next.settings.rollingLoadProtectionEnabled !== false;
    next.settings.rollingLoadWindowMinutes = Math.min(1440, Math.max(0, Math.round(Number(next.settings.rollingLoadWindowMinutes)) || 0));
    next.settings.rollingLoadMaxFatigue = Math.min(100, Math.max(0.5, Number(next.settings.rollingLoadMaxFatigue) || fallback.settings.rollingLoadMaxFatigue));
    next.settings.rollingLoadMode = next.settings.rollingLoadMode === "forbid" ? "forbid" : "prefer";
    next.settings.positionRotationEnabled = next.settings.positionRotationEnabled !== false;
    next.settings.positionRotationLookbackDays = Math.min(90, Math.max(1, Math.round(Number(next.settings.positionRotationLookbackDays)) || fallback.settings.positionRotationLookbackDays));
    next.settings.positionRotationMode = next.settings.positionRotationMode === "forbid" ? "forbid" : "prefer";
    next.settings.lateShiftRecoveryEnabled = next.settings.lateShiftRecoveryEnabled !== false;
    next.settings.lateShiftStartTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(next.settings.lateShiftStartTime)) ? String(next.settings.lateShiftStartTime) : fallback.settings.lateShiftStartTime;
    const lateShiftWindow = Number(next.settings.lateShiftLatestWindowMinutes);
    next.settings.lateShiftLatestWindowMinutes = Math.min(720, Math.max(0, Number.isFinite(lateShiftWindow) ? Math.round(lateShiftWindow) : fallback.settings.lateShiftLatestWindowMinutes));
    const nextDayLateMaxFatigue = Number(next.settings.nextDayLateMaxFatigue);
    next.settings.nextDayLateMaxFatigue = Math.min(50, Math.max(0, Number.isFinite(nextDayLateMaxFatigue) ? nextDayLateMaxFatigue : fallback.settings.nextDayLateMaxFatigue));
    next.settings.lateShiftRecoveryMode = next.settings.lateShiftRecoveryMode === "forbid" ? "forbid" : "prefer";
    const dutyFatiguePoints = Number(next.settings.dutyFatiguePoints);
    next.settings.dutyFatiguePoints = Math.min(50, Math.max(0, Number.isFinite(dutyFatiguePoints) ? dutyFatiguePoints : fallback.settings.dutyFatiguePoints));
    next.staff = next.staff.map((person) => ({
      ...person,
      staffType: person.staffType === "行政支援" ? "行政支援" : "常规",
      cxPreflightQualified: person.staffType === "行政支援" ? false : Boolean(person.cxPreflightQualified),
      dutyQualified: person.staffType === "行政支援" ? false : person.dutyQualified !== false
    }));
    next.dutyRosterOverrides = (Array.isArray(next.dutyRosterOverrides) ? next.dutyRosterOverrides : [])
      .filter((item) => item && typeof item === "object" && /^\d{4}-\d{2}-\d{2}$/.test(String(item.date)))
      .map((item) => ({
        date: String(item.date),
        cxPreflightStaffId: item.cxPreflightStaffId ? String(item.cxPreflightStaffId) : null,
        dutyStaffId: item.dutyStaffId ? String(item.dutyStaffId) : null,
        standbyStaffIds: [item.standbyStaffIds?.[0] ? String(item.standbyStaffIds[0]) : null, item.standbyStaffIds?.[1] ? String(item.standbyStaffIds[1]) : null]
      }));
    next.positionRules = orderPositionRules(next.positionRules
      .filter((rule) => ["常规", "引导", "分流", "行政支援"].includes(rule.category))
      .map((rule) => ({
        ...rule,
        minPassengers: Number(rule.minPassengers) || 0,
        earlyReleaseMinutes: Number(rule.earlyReleaseMinutes) || 0
      })));
    const administrativePositions = new Set(next.positionRules
      .filter((rule) => rule.category === "行政支援")
      .map((rule) => `${rule.flightNo}\u0000${rule.name.trim()}`));
    next.assignments = next.assignments
      .map((assignment) => ({ ...assignment, manualRemark: assignment.manualRemark ?? "" }))
      .filter((assignment) => {
        if (assignment.layoutGroup) return true;
        if (!assignment.positionRuleId) return false;
        const rule = next.positionRules.find((item) => item.id === assignment.positionRuleId && item.flightNo === assignment.flightNo);
        if (!rule) return false;
        if (!next.settings.adminSupportEnabled) return rule.category !== "行政支援";
        return rule.category === "行政支援" || !administrativePositions.has(`${rule.flightNo}\u0000${rule.name.trim()}`);
      });
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
