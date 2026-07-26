import type { AppState, DutyPositionPriority, NextWorkdayRecoveryTarget } from "../model";
import { createId, normalizeText } from "../utils";

export interface SchedulePolicyInput {
  highLoadProtectionEnabled: boolean;
  highLoadFatigueThreshold: number;
  highLoadRecoveryMinutes: number;
  remarkedPositionHighLoad: boolean;
  rollingLoadProtectionEnabled: boolean;
  rollingLoadWindowMinutes: number;
  rollingLoadMaxFatigue: number;
  positionRotationEnabled: boolean;
  lateShiftRecoveryEnabled: boolean;
  lateShiftStartTime: string;
  lateShiftLatestWindowMinutes: number;
  nextDayLateMaxFatigue: number;
  workloadBalanceEnabled: boolean;
  maxWorkHoursDifference: number;
  maxTodayFatigueDifference: number;
  dutyFatiguePoints: number;
  earlyDepartureCutoffTime: string;
  afternoonRestStartTime: string;
  afternoonRestEndTime: string;
}

function finiteInRange(value: number, fallback: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : fallback));
}

export function applySchedulePolicy(state: AppState, input: SchedulePolicyInput): boolean {
  const settings = state.settings;
  settings.highLoadProtectionEnabled = input.highLoadProtectionEnabled;
  settings.highLoadFatigueThreshold = finiteInRange(input.highLoadFatigueThreshold, 4, 0.5, 50);
  settings.highLoadRecoveryMinutes = Math.round(finiteInRange(input.highLoadRecoveryMinutes, 360, 0, 1440));
  settings.remarkedPositionHighLoad = input.remarkedPositionHighLoad;
  settings.rollingLoadProtectionEnabled = input.rollingLoadProtectionEnabled;
  settings.rollingLoadWindowMinutes = Math.round(finiteInRange(input.rollingLoadWindowMinutes, 360, 0, 1440));
  settings.rollingLoadMaxFatigue = finiteInRange(input.rollingLoadMaxFatigue, 8, 0.5, 100);
  settings.positionRotationEnabled = input.positionRotationEnabled;
  settings.lateShiftRecoveryEnabled = input.lateShiftRecoveryEnabled;
  settings.lateShiftStartTime = input.lateShiftStartTime || "20:00";
  settings.lateShiftLatestWindowMinutes = Math.round(finiteInRange(input.lateShiftLatestWindowMinutes, 180, 0, 720));
  settings.nextDayLateMaxFatigue = finiteInRange(input.nextDayLateMaxFatigue, 2, 0, 50);
  settings.workloadBalanceEnabled = input.workloadBalanceEnabled;
  settings.maxWorkHoursDifference = finiteInRange(input.maxWorkHoursDifference, 2, 0, 24);
  settings.maxTodayFatigueDifference = finiteInRange(input.maxTodayFatigueDifference, 4, 0, 100);
  settings.dutyFatiguePoints = finiteInRange(input.dutyFatiguePoints, 12, 0, 50);
  settings.earlyDepartureCutoffTime = input.earlyDepartureCutoffTime || "12:00";
  settings.afternoonRestStartTime = input.afternoonRestStartTime || "12:00";
  settings.afternoonRestEndTime = input.afternoonRestEndTime || "18:00";
  settings.dutyPositionPriorities = settings.dutyPositionPriorities.map((item) => ({
    ...item,
    flightNo: normalizeText(item.flightNo).toUpperCase(),
    positionKeyword: normalizeText(item.positionKeyword)
  }));
  settings.nextWorkdayRecoveryTargets = settings.nextWorkdayRecoveryTargets.map((item) => ({
    ...item,
    flightNo: normalizeText(item.flightNo).toUpperCase(),
    positionKeyword: normalizeText(item.positionKeyword)
  }));
  settings.mobileSupervisorCoverageRules = settings.mobileSupervisorCoverageRules.map((item) => ({
    ...item,
    flightNo: normalizeText(item.flightNo).toUpperCase(),
    keyword: normalizeText(item.keyword)
  }));
  settings.positionTransitionPolicies = settings.positionTransitionPolicies.map((policy) => ({
    ...policy,
    name: normalizeText(policy.name) || "未命名衔接规则",
    sourceFlightNo: normalizeText(policy.sourceFlightNo).toUpperCase(),
    sourcePositions: policy.sourcePositions.map(normalizeText).filter(Boolean),
    targetFlightNo: normalizeText(policy.targetFlightNo).toUpperCase(),
    targetPosition: normalizeText(policy.targetPosition),
    minimumGapMinutes: Math.round(finiteInRange(policy.minimumGapMinutes, 0, 0, 1440)),
    mode: policy.mode === "forbid" ? "forbid" : "prefer"
  }));
  return state.assignments.length > 0;
}

export function addDutyPriority(state: AppState): DutyPositionPriority {
  const priority: DutyPositionPriority = {
    id: createId("duty-priority"),
    flightNo: "",
    positionKeyword: "一号",
    enabled: true
  };
  state.settings.dutyPositionPriorities.push(priority);
  return priority;
}

export function moveDutyPriority(state: AppState, id: string, direction: -1 | 1): boolean {
  const index = state.settings.dutyPositionPriorities.findIndex((item) => item.id === id);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= state.settings.dutyPositionPriorities.length) return false;
  [state.settings.dutyPositionPriorities[index], state.settings.dutyPositionPriorities[targetIndex]] = [
    state.settings.dutyPositionPriorities[targetIndex]!,
    state.settings.dutyPositionPriorities[index]!
  ];
  return true;
}

export function deleteDutyPriority(state: AppState, id: string): boolean {
  const before = state.settings.dutyPositionPriorities.length;
  state.settings.dutyPositionPriorities = state.settings.dutyPositionPriorities.filter((item) => item.id !== id);
  return state.settings.dutyPositionPriorities.length !== before;
}

export function updateDutyPriority(
  state: AppState,
  id: string,
  field: string,
  value: string | number | boolean
): boolean {
  const priority = state.settings.dutyPositionPriorities.find((item) => item.id === id);
  if (!priority) return false;
  if (field === "flightNo") priority.flightNo = normalizeText(value).toUpperCase();
  else if (field === "positionKeyword") priority.positionKeyword = normalizeText(value);
  else if (field === "enabled") priority.enabled = Boolean(value);
  else return false;
  return true;
}

export function addNextWorkdayRecoveryTarget(state: AppState): NextWorkdayRecoveryTarget {
  const target: NextWorkdayRecoveryTarget = {
    id: createId("recovery-target"),
    flightNo: "",
    positionKeyword: "一号",
    enabled: true
  };
  state.settings.nextWorkdayRecoveryTargets.push(target);
  return target;
}

export function deleteNextWorkdayRecoveryTarget(state: AppState, id: string): boolean {
  const before = state.settings.nextWorkdayRecoveryTargets.length;
  state.settings.nextWorkdayRecoveryTargets = state.settings.nextWorkdayRecoveryTargets.filter((item) => item.id !== id);
  return state.settings.nextWorkdayRecoveryTargets.length !== before;
}

export function updateNextWorkdayRecoveryTarget(
  state: AppState,
  id: string,
  field: string,
  value: string | number | boolean
): boolean {
  const target = state.settings.nextWorkdayRecoveryTargets.find((item) => item.id === id);
  if (!target) return false;
  if (field === "flightNo") target.flightNo = normalizeText(value).toUpperCase();
  else if (field === "positionKeyword") target.positionKeyword = normalizeText(value);
  else if (field === "enabled") target.enabled = Boolean(value);
  else return false;
  return true;
}
