import { createDefaultState } from "../defaults";
import { removeUnavailableStaffAssignments } from "../domain/schedule-state";
import { normalizeSupervisorAssignments } from "../domain/schedule-adjustment";
import type { AppState, PositionRule } from "../model";
import { orderPositionRules } from "../utils";

export const STORAGE_KEY = "autoschedule.state.v1";

type PersistedAppState = Omit<AppState, "version"> & { version: 1 | 2 };

function isState(value: unknown): value is PersistedAppState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedAppState>;
  return (candidate.version === 1 || candidate.version === 2)
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
    const resetPreviouslySelectedMobileSupervisors = parsed.version === 1;
    const next: AppState = {
      ...fallback,
      ...parsed,
      version: 2,
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
    const persistedDutyPriorities = Array.isArray(next.settings.dutyPositionPriorities)
      ? next.settings.dutyPositionPriorities
      : fallback.settings.dutyPositionPriorities;
    next.settings.dutyPositionPriorities = persistedDutyPriorities
      .filter((item) => item && typeof item === "object")
      .map((item, index) => ({
        id: String(item.id ?? "").trim() || `duty-priority-${index + 1}`,
        flightNo: String(item.flightNo ?? "").trim().toUpperCase(),
        positionKeyword: String(item.positionKeyword ?? "").trim(),
        enabled: item.enabled !== false
      }));
    const persistedSupervisorRules = Array.isArray(next.settings.mobileSupervisorCoverageRules)
      ? next.settings.mobileSupervisorCoverageRules
      : fallback.settings.mobileSupervisorCoverageRules;
    next.settings.mobileSupervisorCoverageRules = persistedSupervisorRules
      .filter((item) => item && typeof item === "object")
      .map((item, index) => ({
        id: String(item.id ?? "").trim() || `supervisor-coverage-${index + 1}`,
        enabled: item.enabled !== false,
        flightNo: String(item.flightNo ?? "").trim().toUpperCase(),
        matchField: item.matchField === "position" ? "position" : "remark",
        keyword: String(item.keyword ?? "").trim(),
        mode: item.mode === "allow" ? "allow" : "forbid"
      }));
    const validTime = (value: unknown, fallbackValue: string): string => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value)) ? String(value) : fallbackValue;
    next.settings.earlyDepartureCutoffTime = validTime(next.settings.earlyDepartureCutoffTime, fallback.settings.earlyDepartureCutoffTime);
    next.settings.afternoonRestStartTime = validTime(next.settings.afternoonRestStartTime, fallback.settings.afternoonRestStartTime);
    next.settings.afternoonRestEndTime = validTime(next.settings.afternoonRestEndTime, fallback.settings.afternoonRestEndTime);
    next.settings.workloadBalanceEnabled = next.settings.workloadBalanceEnabled !== false;
    const maxWorkHoursDifference = Number(next.settings.maxWorkHoursDifference);
    next.settings.maxWorkHoursDifference = Math.min(24, Math.max(0, Number.isFinite(maxWorkHoursDifference) ? maxWorkHoursDifference : fallback.settings.maxWorkHoursDifference));
    const maxTodayFatigueDifference = Number(next.settings.maxTodayFatigueDifference);
    next.settings.maxTodayFatigueDifference = Math.min(100, Math.max(0, Number.isFinite(maxTodayFatigueDifference) ? maxTodayFatigueDifference : fallback.settings.maxTodayFatigueDifference));
    next.staff = next.staff.map((person) => ({
      ...person,
      staffType: person.staffType === "行政支援" ? "行政支援" : "常规",
      teamLeader: person.staffType === "行政支援" ? false : Boolean(person.teamLeader),
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
    type PersistedPositionRule = Omit<PositionRule, "category"> & { category: PositionRule["category"] | "督导" | "督导补位" };
    const persistedPositionRules = next.positionRules as PersistedPositionRule[];
    next.positionRules = orderPositionRules(persistedPositionRules
      .filter((rule) => ["常规", "引导", "机动督导", "督导补位", "督导", "分流", "行政支援"].includes(rule.category))
      .map((rule) => ({
        ...rule,
        category: rule.category === "督导补位" || rule.category === "督导" || (resetPreviouslySelectedMobileSupervisors && rule.category === "机动督导")
          ? "常规"
          : rule.category,
        manual: rule.category === "督导补位" ? false : rule.manual,
        minPassengers: Number(rule.minPassengers) || 0,
        earlyReleaseMinutes: Number(rule.earlyReleaseMinutes) || 0
      })));
    const administrativePositions = new Set(next.positionRules
      .filter((rule) => rule.category === "行政支援")
      .map((rule) => `${rule.flightNo}\u0000${rule.name.trim()}`));
    next.assignments = next.assignments
      .map((assignment) => {
        const legacy = assignment as typeof assignment & { supervisorCoverSourceAssignmentId?: string };
        const supervisorSourceAssignmentId = assignment.supervisorSourceAssignmentId ?? legacy.supervisorCoverSourceAssignmentId;
        return {
        ...assignment,
        supervisorSourceAssignmentId,
        manualRemark: assignment.manualRemark ?? "",
        systemNotes: Array.isArray(assignment.systemNotes) ? assignment.systemNotes.map(String).filter(Boolean) : undefined
      };
      })
      .filter((assignment) => {
        if (assignment.layoutGroup) return true;
        if (!assignment.positionRuleId) return false;
        const rule = next.positionRules.find((item) => item.id === assignment.positionRuleId && item.flightNo === assignment.flightNo);
        if (!rule) return false;
        if (!next.settings.adminSupportEnabled) return rule.category !== "行政支援";
        return rule.category === "行政支援" || !administrativePositions.has(`${rule.flightNo}\u0000${rule.name.trim()}`);
      });
    removeUnavailableStaffAssignments(next);
    normalizeSupervisorAssignments(next);
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
