import type { AppState } from "../model";
import type {
  DutyPositionPriority,
  LateShiftRecoveryPositionRule,
  NextWorkdayRecoveryTarget,
} from "../domain/rules/structured-policy-contract";
import { applyScheduleSettingsPatch } from "../domain/rules/schedule-settings";
import {
  BUILT_IN_RULE_REGISTRY,
  isConfigurableRuleHook,
  isReorderableRuleHook,
} from "../domain/rules/built-in-rule-registry";
import { markActiveScheduleStale } from "../domain/kernel/schedule-lifecycle";
import { createId, normalizeText, splitList } from "../utils";

export type PolicyValue = string | number | boolean;
export type PolicyEntity =
  | "duty-priority"
  | "recovery-target"
  | "late-shift-recovery-position"
  | "transition-policy"
  | "supervisor-coverage";
export type PolicyFieldUpdateResult = "not-policy" | "missing" | "saved";

export interface SchedulePolicyInput {
  highLoadProtectionEnabled: boolean;
  highLoadFatigueThreshold: number;
  highLoadRecoveryMinutes: number;
  remarkedPositionHighLoad: boolean;
  rollingLoadProtectionEnabled: boolean;
  rollingLoadWindowMinutes: number;
  rollingLoadMaxFatigue: number;
  positionRotationEnabled: boolean;
  nextDutyRestProtectionEnabled: boolean;
  lateShiftRecoveryEnabled: boolean;
  lateShiftStartTime: string;
  lateShiftLatestWindowMinutes: number;
  teamLeaderConcurrentSupervisionMaxOverlapMinutes: number;
  workloadBalanceEnabled: boolean;
  maxWorkHoursDifference: number;
  maxTodayFatigueDifference: number;
  dutyFatiguePoints: number;
  earlyDepartureCutoffTime: string;
  afternoonRestStartTime: string;
  afternoonRestEndTime: string;
}

function markPolicyMutation(state: AppState): void {
  markActiveScheduleStale(state);
}

export function applySchedulePolicy(
  state: AppState,
  input: SchedulePolicyInput
): boolean {
  state.settings = applyScheduleSettingsPatch(state.settings, input);
  return markActiveScheduleStale(state);
}

export function setRuleHookEnabled(
  state: AppState,
  id: string,
  enabled: boolean
): boolean {
  if (!isConfigurableRuleHook(id)) return false;
  const disabled = new Set(state.settings.disabledRuleHookIds);
  if (enabled) disabled.delete(id);
  else disabled.add(id);
  const next = [...disabled];
  if (
    next.length === state.settings.disabledRuleHookIds.length &&
    next.every(
      (value, index) => value === state.settings.disabledRuleHookIds[index]
    )
  )
    return true;
  state.settings.disabledRuleHookIds = next;
  markPolicyMutation(state);
  return true;
}

export function moveRuleHook(
  state: AppState,
  id: string,
  direction: -1 | 1
): boolean {
  if (!isReorderableRuleHook(id)) return false;
  const definition = BUILT_IN_RULE_REGISTRY.definition(id)!;
  const order = [...state.settings.ruleHookOrder];
  const index = order.indexOf(id);
  if (index < 0) return false;
  const eligible = order.filter((candidateId) => {
    const candidate = BUILT_IN_RULE_REGISTRY.definition(candidateId);
    return (
      candidate?.stage === definition.stage &&
      isReorderableRuleHook(candidateId)
    );
  });
  const eligibleIndex = eligible.indexOf(id);
  const targetId = eligible[eligibleIndex + direction];
  if (!targetId) return false;
  const targetIndex = order.indexOf(targetId);
  [order[index], order[targetIndex]] = [order[targetIndex]!, order[index]!];
  state.settings.ruleHookOrder = order;
  markPolicyMutation(state);
  return true;
}

export function addDutyPriority(state: AppState): DutyPositionPriority {
  const priority: DutyPositionPriority = {
    id: createId("duty-priority"),
    flightNo: "",
    positionKeyword: "一号",
    enabled: true,
  };
  state.settings.dutyPositionPriorities.push(priority);
  markPolicyMutation(state);
  return priority;
}

export function moveDutyPriority(
  state: AppState,
  id: string,
  direction: -1 | 1
): boolean {
  const index = state.settings.dutyPositionPriorities.findIndex(
    (item) => item.id === id
  );
  const targetIndex = index + direction;
  if (
    index < 0 ||
    targetIndex < 0 ||
    targetIndex >= state.settings.dutyPositionPriorities.length
  )
    return false;
  [
    state.settings.dutyPositionPriorities[index],
    state.settings.dutyPositionPriorities[targetIndex],
  ] = [
    state.settings.dutyPositionPriorities[targetIndex]!,
    state.settings.dutyPositionPriorities[index]!,
  ];
  markPolicyMutation(state);
  return true;
}

export function deleteDutyPriority(state: AppState, id: string): boolean {
  const before = state.settings.dutyPositionPriorities.length;
  state.settings.dutyPositionPriorities =
    state.settings.dutyPositionPriorities.filter((item) => item.id !== id);
  const deleted = state.settings.dutyPositionPriorities.length !== before;
  if (deleted) markPolicyMutation(state);
  return deleted;
}

export function updateDutyPriority(
  state: AppState,
  id: string,
  field: string,
  value: string | number | boolean
): boolean {
  const priority = state.settings.dutyPositionPriorities.find(
    (item) => item.id === id
  );
  if (!priority) return false;
  if (field === "flightNo") {
    const nextValue = normalizeText(value).toUpperCase();
    if (priority.flightNo !== nextValue) {
      priority.flightNo = nextValue;
      markPolicyMutation(state);
    }
  } else if (field === "positionKeyword") {
    const nextValue = normalizeText(value);
    if (priority.positionKeyword !== nextValue) {
      priority.positionKeyword = nextValue;
      markPolicyMutation(state);
    }
  } else if (field === "enabled") {
    const nextValue = Boolean(value);
    if (priority.enabled !== nextValue) {
      priority.enabled = nextValue;
      markPolicyMutation(state);
    }
  } else return false;
  return true;
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
  state.settings.nextWorkdayRecoveryTargets.push(target);
  markPolicyMutation(state);
  return target;
}

export function deleteNextWorkdayRecoveryTarget(
  state: AppState,
  id: string
): boolean {
  const before = state.settings.nextWorkdayRecoveryTargets.length;
  state.settings.nextWorkdayRecoveryTargets =
    state.settings.nextWorkdayRecoveryTargets.filter((item) => item.id !== id);
  const deleted = state.settings.nextWorkdayRecoveryTargets.length !== before;
  if (deleted) markPolicyMutation(state);
  return deleted;
}

export function updateNextWorkdayRecoveryTarget(
  state: AppState,
  id: string,
  field: string,
  value: string | number | boolean
): boolean {
  const target = state.settings.nextWorkdayRecoveryTargets.find(
    (item) => item.id === id
  );
  if (!target) return false;
  if (field === "flightNo") {
    const nextValue = normalizeText(value).toUpperCase();
    if (target.flightNo !== nextValue) {
      target.flightNo = nextValue;
      markPolicyMutation(state);
    }
  } else if (field === "positionKeyword") {
    const nextValue = normalizeText(value);
    if (target.positionKeyword !== nextValue) {
      target.positionKeyword = nextValue;
      markPolicyMutation(state);
    }
  } else if (field === "enabled") {
    const nextValue = Boolean(value);
    if (target.enabled !== nextValue) {
      target.enabled = nextValue;
      markPolicyMutation(state);
    }
  } else return false;
  return true;
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
  state.settings.lateShiftRecoveryPositionRules.push(rule);
  markPolicyMutation(state);
  return rule;
}

export function deleteLateShiftRecoveryPositionRule(
  state: AppState,
  id: string
): boolean {
  const before = state.settings.lateShiftRecoveryPositionRules.length;
  state.settings.lateShiftRecoveryPositionRules =
    state.settings.lateShiftRecoveryPositionRules.filter(
      (item) => item.id !== id
    );
  const deleted =
    state.settings.lateShiftRecoveryPositionRules.length !== before;
  if (deleted) markPolicyMutation(state);
  return deleted;
}

export function updateLateShiftRecoveryPositionRule(
  state: AppState,
  id: string,
  field: string,
  value: string | number | boolean
): boolean {
  const rule = state.settings.lateShiftRecoveryPositionRules.find(
    (item) => item.id === id
  );
  if (!rule) return false;
  let changed = false;
  if (field === "flightNo") {
    const nextValue = normalizeText(value).toUpperCase();
    changed = rule.flightNo !== nextValue;
    rule.flightNo = nextValue;
  } else if (field === "matchField") {
    const nextValue = value === "position" ? "position" : "remark";
    changed = rule.matchField !== nextValue;
    rule.matchField = nextValue;
  } else if (field === "keyword") {
    const nextValue = normalizeText(value);
    changed = rule.keyword !== nextValue;
    rule.keyword = nextValue;
  } else if (field === "nextWorkdayCutoffTime") {
    const nextValue = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value))
      ? String(value)
      : "";
    changed = rule.nextWorkdayCutoffTime !== nextValue;
    rule.nextWorkdayCutoffTime = nextValue;
  } else if (field === "enabled") {
    const nextValue = Boolean(value);
    changed = rule.enabled !== nextValue;
    rule.enabled = nextValue;
  } else return false;
  if (changed) markPolicyMutation(state);
  return true;
}

export function addTransitionPolicy(state: AppState): void {
  const sourceFlight = state.flights[0];
  const targetFlight = state.flights.at(-1) ?? sourceFlight;
  state.settings.positionTransitionPolicies.push({
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
  markPolicyMutation(state);
}

export function deleteTransitionPolicy(state: AppState, id: string): boolean {
  const before = state.settings.positionTransitionPolicies.length;
  state.settings.positionTransitionPolicies =
    state.settings.positionTransitionPolicies.filter((item) => item.id !== id);
  const deleted = state.settings.positionTransitionPolicies.length !== before;
  if (deleted) markPolicyMutation(state);
  return deleted;
}

export function addMobileSupervisorCoverageRule(state: AppState): void {
  state.settings.mobileSupervisorCoverageRules.push({
    id: createId("supervisor-coverage"),
    enabled: true,
    flightNo: "",
    matchField: "remark",
    keyword: "",
    mode: "forbid",
  });
  markPolicyMutation(state);
}

export function deleteMobileSupervisorCoverageRule(
  state: AppState,
  id: string
): boolean {
  const before = state.settings.mobileSupervisorCoverageRules.length;
  state.settings.mobileSupervisorCoverageRules =
    state.settings.mobileSupervisorCoverageRules.filter(
      (item) => item.id !== id
    );
  const deleted =
    state.settings.mobileSupervisorCoverageRules.length !== before;
  if (deleted) markPolicyMutation(state);
  return deleted;
}

function updateTransitionPolicy(
  state: AppState,
  id: string,
  field: string,
  value: PolicyValue
): boolean {
  const policy = state.settings.positionTransitionPolicies.find(
    (item) => item.id === id
  );
  if (!policy) return false;
  let changed = false;
  if (field === "sourcePositions") {
    const nextValue = splitList(value);
    changed =
      policy.sourcePositions.join("\u0000") !== nextValue.join("\u0000");
    policy.sourcePositions = nextValue;
  } else if (field === "minimumGapMinutes") {
    const nextValue = Math.min(
      1440,
      Math.max(0, Math.round(Number(value)) || 0)
    );
    changed = policy.minimumGapMinutes !== nextValue;
    policy.minimumGapMinutes = nextValue;
  } else if (field === "sourceFlightNo" || field === "targetFlightNo") {
    const nextValue = normalizeText(value).toUpperCase();
    changed = policy[field] !== nextValue;
    policy[field] = nextValue;
  } else if (field === "mode") {
    const nextValue = value === "forbid" ? "forbid" : "prefer";
    changed = policy.mode !== nextValue;
    policy.mode = nextValue;
  } else if (field === "enabled") {
    const nextValue = Boolean(value);
    changed = policy.enabled !== nextValue;
    policy.enabled = nextValue;
  } else if (field === "name" || field === "targetPosition") {
    const nextValue = normalizeText(value);
    changed = policy[field] !== nextValue;
    policy[field] = nextValue;
  } else return false;
  if (changed) markPolicyMutation(state);
  return true;
}

function updateMobileSupervisorCoverageRule(
  state: AppState,
  id: string,
  field: string,
  value: PolicyValue
): boolean {
  const rule = state.settings.mobileSupervisorCoverageRules.find(
    (item) => item.id === id
  );
  if (!rule) return false;
  let changed = false;
  if (field === "enabled") {
    const nextValue = Boolean(value);
    changed = rule.enabled !== nextValue;
    rule.enabled = nextValue;
  } else if (field === "flightNo") {
    const nextValue = normalizeText(value).toUpperCase();
    changed = rule.flightNo !== nextValue;
    rule.flightNo = nextValue;
  } else if (field === "matchField") {
    const nextValue = value === "position" ? "position" : "remark";
    changed = rule.matchField !== nextValue;
    rule.matchField = nextValue;
  } else if (field === "keyword") {
    const nextValue = normalizeText(value);
    changed = rule.keyword !== nextValue;
    rule.keyword = nextValue;
  } else if (field === "mode") {
    const nextValue = value === "allow" ? "allow" : "forbid";
    changed = rule.mode !== nextValue;
    rule.mode = nextValue;
  } else return false;
  if (changed) markPolicyMutation(state);
  return true;
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
