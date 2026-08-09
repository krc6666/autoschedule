import type { AppState } from "../model";
import type {
  CrossWorkdayQualificationReservation,
  DutyPositionPriority,
  LateShiftRecoveryPositionRule,
  NextWorkdayRecoveryTarget,
} from "../domain/rules/structured-policy-contract";
import { applyScheduleSettingsPatch } from "../domain/rules/schedule-settings";
import { markActiveScheduleStale } from "../domain/kernel/schedule-lifecycle";
import { createId, normalizeText, splitList } from "../utils";
import {
  appendPolicyItem,
  deletePolicyItem,
  movePolicyItem,
  updatePolicyItem,
  type PolicyItemUpdate,
} from "./policy-collection-actions";

export type PolicyValue = string | number | boolean;
export type PolicyEntity =
  | "duty-priority"
  | "recovery-target"
  | "late-shift-recovery-position"
  | "cross-workday-reservation"
  | "transition-policy"
  | "supervisor-coverage";
export type PolicyFieldUpdateResult = "not-policy" | "missing" | "saved";

export interface SchedulePolicyInput {
  minimumRegularTransitionMinutes: number;
  highLoadProtectionEnabled: boolean;
  highLoadFatigueThreshold: number;
  highLoadRecoveryMinutes: number;
  remarkedPositionHighLoad: boolean;
  rollingLoadProtectionEnabled: boolean;
  rollingLoadWindowMinutes: number;
  rollingLoadMaxFatigue: number;
  positionRotationEnabled: boolean;
  latePriorityFlightNumbers: string[];
  lateShiftRecoveryEnabled: boolean;
  lateShiftEndTime: string;
  teamLeaderConcurrentSupervisionMaxOverlapMinutes: number;
  workloadBalanceEnabled: boolean;
  maxWorkHoursDifference: number;
  maxTodayFatigueDifference: number;
  dutyFatiguePoints: number;
  earlyDepartureCutoffTime: string;
  afternoonRestStartTime: string;
  afternoonRestEndTime: string;
}

function replacePolicyValue<T, K extends keyof T>(
  item: T,
  key: K,
  value: T[K]
): PolicyItemUpdate {
  if (Object.is(item[key], value)) return "unchanged";
  item[key] = value;
  return "changed";
}

export function applySchedulePolicy(
  state: AppState,
  input: SchedulePolicyInput
): boolean {
  state.settings = applyScheduleSettingsPatch(state.settings, input);
  return markActiveScheduleStale(state);
}

export function addDutyPriority(state: AppState): DutyPositionPriority {
  const priority: DutyPositionPriority = {
    id: createId("duty-priority"),
    flightNo: "",
    positionKeyword: "一号",
    enabled: true,
  };
  return appendPolicyItem(
    state,
    state.settings.dutyPositionPriorities,
    priority
  );
}

export function moveDutyPriority(
  state: AppState,
  id: string,
  direction: -1 | 1
): boolean {
  return movePolicyItem(
    state,
    state.settings.dutyPositionPriorities,
    id,
    direction
  );
}

export function deleteDutyPriority(state: AppState, id: string): boolean {
  return deletePolicyItem(state, state.settings.dutyPositionPriorities, id);
}

export function updateDutyPriority(
  state: AppState,
  id: string,
  field: string,
  value: string | number | boolean
): boolean {
  return updatePolicyItem(
    state,
    state.settings.dutyPositionPriorities,
    id,
    (priority) => {
      if (field === "flightNo")
        return replacePolicyValue(
          priority,
          "flightNo",
          normalizeText(value).toUpperCase()
        );
      if (field === "positionKeyword")
        return replacePolicyValue(
          priority,
          "positionKeyword",
          normalizeText(value)
        );
      if (field === "enabled")
        return replacePolicyValue(priority, "enabled", Boolean(value));
      return "invalid";
    }
  );
}

export function addNextWorkdayRecoveryTarget(
  state: AppState
): NextWorkdayRecoveryTarget {
  const target: NextWorkdayRecoveryTarget = {
    id: createId("recovery-target"),
    flightNo: "",
    positionKeyword: "一号",
    enabled: true,
  };
  return appendPolicyItem(
    state,
    state.settings.nextWorkdayRecoveryTargets,
    target
  );
}

export function addCrossWorkdayQualificationReservation(
  state: AppState
): CrossWorkdayQualificationReservation {
  const reservation: CrossWorkdayQualificationReservation = {
    id: createId("cross-workday-reservation"),
    enabled: true,
    flightNo: "",
    matchField: "position",
    keyword: "控制",
    minimumStaffCount: 1,
  };
  return appendPolicyItem(
    state,
    state.settings.crossWorkdayQualificationReservations,
    reservation
  );
}

export function moveCrossWorkdayQualificationReservation(
  state: AppState,
  id: string,
  direction: -1 | 1
): boolean {
  return movePolicyItem(
    state,
    state.settings.crossWorkdayQualificationReservations,
    id,
    direction
  );
}

export function deleteCrossWorkdayQualificationReservation(
  state: AppState,
  id: string
): boolean {
  return deletePolicyItem(
    state,
    state.settings.crossWorkdayQualificationReservations,
    id
  );
}

function updateCrossWorkdayQualificationReservation(
  state: AppState,
  id: string,
  field: string,
  value: PolicyValue
): boolean {
  return updatePolicyItem(
    state,
    state.settings.crossWorkdayQualificationReservations,
    id,
    (reservation) => {
      if (field === "enabled")
        return replacePolicyValue(reservation, "enabled", Boolean(value));
      if (field === "flightNo")
        return replacePolicyValue(
          reservation,
          "flightNo",
          normalizeText(value).toUpperCase()
        );
      if (field === "matchField")
        return replacePolicyValue(
          reservation,
          "matchField",
          value === "position" ? "position" : "remark"
        );
      if (field === "keyword")
        return replacePolicyValue(reservation, "keyword", normalizeText(value));
      if (field === "minimumStaffCount")
        return replacePolicyValue(
          reservation,
          "minimumStaffCount",
          Math.min(50, Math.max(1, Math.round(Number(value)) || 1))
        );
      return "invalid";
    }
  );
}

export function deleteNextWorkdayRecoveryTarget(
  state: AppState,
  id: string
): boolean {
  return deletePolicyItem(state, state.settings.nextWorkdayRecoveryTargets, id);
}

export function updateNextWorkdayRecoveryTarget(
  state: AppState,
  id: string,
  field: string,
  value: string | number | boolean
): boolean {
  return updatePolicyItem(
    state,
    state.settings.nextWorkdayRecoveryTargets,
    id,
    (target) => {
      if (field === "flightNo")
        return replacePolicyValue(
          target,
          "flightNo",
          normalizeText(value).toUpperCase()
        );
      if (field === "positionKeyword")
        return replacePolicyValue(
          target,
          "positionKeyword",
          normalizeText(value)
        );
      if (field === "enabled")
        return replacePolicyValue(target, "enabled", Boolean(value));
      return "invalid";
    }
  );
}

export function addLateShiftRecoveryPositionRule(
  state: AppState
): LateShiftRecoveryPositionRule {
  const rule: LateShiftRecoveryPositionRule = {
    id: createId("late-recovery-position"),
    enabled: true,
    flightNo: "",
    matchField: "remark",
    keyword: "一号",
    nextWorkdayCutoffTime: "",
  };
  return appendPolicyItem(
    state,
    state.settings.lateShiftRecoveryPositionRules,
    rule
  );
}

export function deleteLateShiftRecoveryPositionRule(
  state: AppState,
  id: string
): boolean {
  return deletePolicyItem(
    state,
    state.settings.lateShiftRecoveryPositionRules,
    id
  );
}

export function updateLateShiftRecoveryPositionRule(
  state: AppState,
  id: string,
  field: string,
  value: string | number | boolean
): boolean {
  return updatePolicyItem(
    state,
    state.settings.lateShiftRecoveryPositionRules,
    id,
    (rule) => {
      if (field === "flightNo")
        return replacePolicyValue(
          rule,
          "flightNo",
          normalizeText(value).toUpperCase()
        );
      if (field === "matchField")
        return replacePolicyValue(
          rule,
          "matchField",
          value === "position" ? "position" : "remark"
        );
      if (field === "keyword")
        return replacePolicyValue(rule, "keyword", normalizeText(value));
      if (field === "nextWorkdayCutoffTime") {
        const nextValue = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value))
          ? String(value)
          : "";
        return replacePolicyValue(rule, "nextWorkdayCutoffTime", nextValue);
      }
      if (field === "enabled")
        return replacePolicyValue(rule, "enabled", Boolean(value));
      return "invalid";
    }
  );
}

export function addTransitionPolicy(state: AppState): void {
  const sourceFlight = state.flights[0];
  const targetFlight = state.flights.at(-1) ?? sourceFlight;
  appendPolicyItem(state, state.settings.positionTransitionPolicies, {
    id: createId("transition-policy"),
    name: "新岗位衔接规则",
    enabled: false,
    sourceFlightNo: sourceFlight?.flightNo ?? "",
    sourcePositions: [],
    targetFlightNo: targetFlight?.flightNo ?? "",
    targetPosition: "",
    minimumGapMinutes: 180,
    mode: "prefer",
  });
}

export function deleteTransitionPolicy(state: AppState, id: string): boolean {
  return deletePolicyItem(state, state.settings.positionTransitionPolicies, id);
}

export function addMobileSupervisorCoverageRule(state: AppState): void {
  appendPolicyItem(state, state.settings.mobileSupervisorCoverageRules, {
    id: createId("supervisor-coverage"),
    enabled: true,
    flightNo: "",
    matchField: "remark",
    keyword: "",
    mode: "forbid",
  });
}

export function deleteMobileSupervisorCoverageRule(
  state: AppState,
  id: string
): boolean {
  return deletePolicyItem(
    state,
    state.settings.mobileSupervisorCoverageRules,
    id
  );
}

function updateTransitionPolicy(
  state: AppState,
  id: string,
  field: string,
  value: PolicyValue
): boolean {
  return updatePolicyItem(
    state,
    state.settings.positionTransitionPolicies,
    id,
    (policy) => {
      if (field === "sourcePositions") {
        const nextValue = splitList(value);
        if (policy.sourcePositions.join("\u0000") === nextValue.join("\u0000"))
          return "unchanged";
        policy.sourcePositions = nextValue;
        return "changed";
      }
      if (field === "minimumGapMinutes")
        return replacePolicyValue(
          policy,
          "minimumGapMinutes",
          Math.min(1440, Math.max(0, Math.round(Number(value)) || 0))
        );
      if (field === "sourceFlightNo" || field === "targetFlightNo")
        return replacePolicyValue(
          policy,
          field,
          normalizeText(value).toUpperCase()
        );
      if (field === "mode")
        return replacePolicyValue(
          policy,
          "mode",
          value === "forbid" ? "forbid" : "prefer"
        );
      if (field === "enabled")
        return replacePolicyValue(policy, "enabled", Boolean(value));
      if (field === "name" || field === "targetPosition")
        return replacePolicyValue(policy, field, normalizeText(value));
      return "invalid";
    }
  );
}

function updateMobileSupervisorCoverageRule(
  state: AppState,
  id: string,
  field: string,
  value: PolicyValue
): boolean {
  return updatePolicyItem(
    state,
    state.settings.mobileSupervisorCoverageRules,
    id,
    (rule) => {
      if (field === "enabled")
        return replacePolicyValue(rule, "enabled", Boolean(value));
      if (field === "flightNo")
        return replacePolicyValue(
          rule,
          "flightNo",
          normalizeText(value).toUpperCase()
        );
      if (field === "matchField")
        return replacePolicyValue(
          rule,
          "matchField",
          value === "position" ? "position" : "remark"
        );
      if (field === "keyword")
        return replacePolicyValue(rule, "keyword", normalizeText(value));
      if (field === "mode")
        return replacePolicyValue(
          rule,
          "mode",
          value === "allow" ? "allow" : "forbid"
        );
      return "invalid";
    }
  );
}

type PolicyEntityUpdater = (
  state: AppState,
  id: string,
  field: string,
  value: PolicyValue
) => boolean;

const POLICY_ENTITY_UPDATERS: Readonly<
  Record<PolicyEntity, PolicyEntityUpdater>
> = {
  "duty-priority": updateDutyPriority,
  "recovery-target": updateNextWorkdayRecoveryTarget,
  "late-shift-recovery-position": updateLateShiftRecoveryPositionRule,
  "cross-workday-reservation": updateCrossWorkdayQualificationReservation,
  "transition-policy": updateTransitionPolicy,
  "supervisor-coverage": updateMobileSupervisorCoverageRule,
};

function isPolicyEntity(entity: string): entity is PolicyEntity {
  return Object.hasOwn(POLICY_ENTITY_UPDATERS, entity);
}

export function updatePolicyEntityField(
  state: AppState,
  entity: string,
  id: string,
  field: string,
  value: PolicyValue
): PolicyFieldUpdateResult {
  if (!isPolicyEntity(entity)) return "not-policy";
  const updated = POLICY_ENTITY_UPDATERS[entity](state, id, field, value);
  return updated ? "saved" : "missing";
}
