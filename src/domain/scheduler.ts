import type { AppState, Assignment, Flight, PositionRule, ScheduleResult, Staff } from "../model";
import { createId } from "../utils";
import { getDutyRosterForDate } from "./duty-roster";
import { historyFatigue, recentHistory } from "./fatigue";
import { durationHours, intervalsOverlap, isNightInterval, timeToMinutes } from "./time";
import { canMobileSupervisorCoverPosition } from "./mobile-supervisor-coverage";
import { analyzeWorkloadPressure, workloadBalanceCost } from "./workload-balance";

export function isAuxiliaryCategory(category: PositionRule["category"] | undefined): boolean {
  return category === "行政支援";
}

export function isFixedBottomPosition(position: string): boolean {
  return position.includes("引导") && !position.includes("督导");
}

export function isSupervisorPosition(position: string): boolean {
  return position.includes("督导");
}

function assignmentRule(state: AppState, assignment: Assignment): PositionRule | undefined {
  return assignment.positionRuleId
    ? state.positionRules.find((rule) => rule.id === assignment.positionRuleId)
    : undefined;
}

export function isGuideAssignment(state: AppState, assignment: Assignment): boolean {
  return assignmentRule(state, assignment)?.category === "引导";
}

function isReusableAssignment(state: AppState, assignment: Assignment): boolean {
  return isGuideAssignment(state, assignment);
}

function canReleaseForFlight(assignment: Assignment, flight: Pick<Flight, "startTime" | "endTime">, state: AppState): boolean {
  const rule = assignment.positionRuleId ? state.positionRules.find((item) => item.id === assignment.positionRuleId) : undefined;
  if (rule?.category !== "分流" || rule.earlyReleaseMinutes <= 0 || timeToMinutes(assignment.startTime) < 12 * 60) return false;
  const assignmentStart = timeToMinutes(assignment.startTime);
  let assignmentEnd = timeToMinutes(assignment.endTime);
  let nextStart = timeToMinutes(flight.startTime);
  if (assignmentEnd <= assignmentStart) assignmentEnd += 24 * 60;
  if (nextStart < assignmentStart) nextStart += 24 * 60;
  const overlapMinutes = assignmentEnd - nextStart;
  return overlapMinutes > 0 && overlapMinutes <= rule.earlyReleaseMinutes;
}

function staffConflicts(assignments: Assignment[], staffId: string, flight: Pick<Flight, "startTime" | "endTime">): Assignment[] {
  return assignments.filter((assignment) => assignment.staffId === staffId
    && intervalsOverlap(assignment.startTime, assignment.endTime, flight.startTime, flight.endTime));
}

function projectedAssignedHours(assignments: Assignment[], staffId: string, flight: Pick<Flight, "startTime" | "endTime">, state: AppState): number {
  return assignments.filter((assignment) => assignment.staffId === staffId).reduce((sum, assignment) => {
    return sum + (canReleaseForFlight(assignment, flight, state) ? durationHours(assignment.startTime, flight.startTime) : assignment.workHours);
  }, 0);
}

function applyEarlyReleases(assignments: Assignment[], staffId: string, flight: Pick<Flight, "startTime" | "endTime">, state: AppState): void {
  staffConflicts(assignments, staffId, flight).filter((assignment) => canReleaseForFlight(assignment, flight, state)).forEach((assignment) => {
    assignment.endTime = flight.startTime;
    assignment.workHours = durationHours(assignment.startTime, assignment.endTime);
  });
}

function candidateScore(
  person: Staff,
  assignments: Assignment[],
  state: AppState,
  date: string
): number {
  const prior = historyFatigue(state.history, person.id, date, state.settings);
  const current = assignments
    .filter((assignment) => assignment.staffId === person.id)
    .reduce((sum, assignment) => sum + assignment.fatiguePoints, 0);
  const dutyFatigue = getDutyRosterForDate(state, date).dutyStaffId === person.id ? state.settings.dutyFatiguePoints : 0;
  return prior + current + dutyFatigue;
}

export function isHighLoadPosition(fatiguePoints: number, remark: string, state: AppState): boolean {
  return fatiguePoints >= state.settings.highLoadFatigueThreshold
    || (state.settings.remarkedPositionHighLoad && Boolean(remark.trim()));
}

function recoveryGapMinutes(previous: Pick<Assignment, "startTime" | "endTime">, nextStartTime: string): number {
  const previousStart = timeToMinutes(previous.startTime);
  let previousEnd = timeToMinutes(previous.endTime);
  let nextStart = timeToMinutes(nextStartTime);
  if (previousEnd <= previousStart) previousEnd += 24 * 60;
  if (nextStart < previousStart) nextStart += 24 * 60;
  return nextStart - previousEnd;
}

function hasHighLoadTransition(
  assignments: Assignment[],
  staffId: string,
  nextStartTime: string,
  nextEndTime: string,
  nextFatiguePoints: number,
  nextRemark: string,
  state: AppState
): boolean {
  if (!state.settings.highLoadProtectionEnabled || !isHighLoadPosition(nextFatiguePoints, nextRemark, state)) return false;
  return assignments.some((assignment) => {
    if (assignment.staffId !== staffId || assignment.status !== "assigned" || !isHighLoadPosition(assignment.fatiguePoints, assignment.remark, state)) return false;
    const assignmentStartsFirst = timeToMinutes(assignment.startTime) <= timeToMinutes(nextStartTime);
    const gap = assignmentStartsFirst
      ? recoveryGapMinutes(assignment, nextStartTime)
      : recoveryGapMinutes({ startTime: nextStartTime, endTime: nextEndTime }, assignment.startTime);
    return gap >= 0 && gap <= state.settings.highLoadRecoveryMinutes;
  });
}

function normalizedPolicyValue(value: string): string {
  return value.trim().toUpperCase();
}

function positionTransitionCost(
  assignments: Assignment[],
  staffId: string,
  targetFlightNo: string,
  targetPosition: string,
  targetStartTime: string,
  state: AppState,
  mode: "prefer" | "forbid"
): number {
  return violatedPositionTransitionPolicies(assignments, staffId, targetFlightNo, targetPosition, targetStartTime, state, mode).length;
}

function violatedPositionTransitionPolicies(
  assignments: Assignment[],
  staffId: string,
  targetFlightNo: string,
  targetPosition: string,
  targetStartTime: string,
  state: AppState,
  mode: "prefer" | "forbid"
) {
  const targetFlight = normalizedPolicyValue(targetFlightNo);
  const targetRole = normalizedPolicyValue(targetPosition);
  return state.settings.positionTransitionPolicies
    .filter((policy) => policy.enabled && policy.mode === mode
      && normalizedPolicyValue(policy.targetFlightNo) === targetFlight
      && normalizedPolicyValue(policy.targetPosition) === targetRole)
    .filter((policy) => assignments.some((assignment) => {
      if (assignment.staffId !== staffId || assignment.status !== "assigned") return false;
      if (policy.sourceFlightNo.trim() && normalizedPolicyValue(policy.sourceFlightNo) !== normalizedPolicyValue(assignment.flightNo)) return false;
      if (policy.sourcePositions.length && !policy.sourcePositions.some((position) => normalizedPolicyValue(position) === normalizedPolicyValue(assignment.position))) return false;
      const gap = recoveryGapMinutes(assignment, targetStartTime);
      return gap >= 0 && gap < policy.minimumGapMinutes;
    }));
}

function violatedPositionTransitionPoliciesForInsertion(
  assignments: Assignment[],
  staffId: string,
  flightNo: string,
  position: string,
  startTime: string,
  endTime: string,
  state: AppState,
  mode: "prefer" | "forbid"
) {
  const forward = violatedPositionTransitionPolicies(assignments, staffId, flightNo, position, startTime, state, mode);
  const sourceFlight = normalizedPolicyValue(flightNo);
  const sourcePosition = normalizedPolicyValue(position);
  const reverse = state.settings.positionTransitionPolicies
    .filter((policy) => policy.enabled && policy.mode === mode)
    .filter((policy) => (!policy.sourceFlightNo.trim() || normalizedPolicyValue(policy.sourceFlightNo) === sourceFlight)
      && (!policy.sourcePositions.length || policy.sourcePositions.some((item) => normalizedPolicyValue(item) === sourcePosition)))
    .filter((policy) => assignments.some((assignment) => assignment.staffId === staffId
      && assignment.status === "assigned"
      && normalizedPolicyValue(assignment.flightNo) === normalizedPolicyValue(policy.targetFlightNo)
      && normalizedPolicyValue(assignment.position) === normalizedPolicyValue(policy.targetPosition)
      && recoveryGapMinutes({ startTime, endTime }, assignment.startTime) >= 0
      && recoveryGapMinutes({ startTime, endTime }, assignment.startTime) < policy.minimumGapMinutes));
  return [...new Map([...forward, ...reverse].map((policy) => [policy.id, policy])).values()];
}

function positionTransitionInsertionCost(
  assignments: Assignment[],
  staffId: string,
  task: AssignmentTask,
  state: AppState,
  mode: "prefer" | "forbid"
): number {
  return violatedPositionTransitionPoliciesForInsertion(
    assignments,
    staffId,
    task.flight.flightNo,
    task.rule.name,
    task.flight.startTime,
    task.flight.endTime,
    state,
    mode
  ).length;
}

function rollingLoadCost(
  assignments: Assignment[],
  staffId: string,
  targetStartTime: string,
  targetFatiguePoints: number,
  targetRemark: string,
  state: AppState
): number {
  if (!state.settings.rollingLoadProtectionEnabled || !isHighLoadPosition(targetFatiguePoints, targetRemark, state)) return 0;
  const recentFatigue = assignments
    .filter((assignment) => assignment.staffId === staffId && assignment.status === "assigned")
    .filter((assignment) => {
      const gap = recoveryGapMinutes(assignment, targetStartTime);
      return gap >= 0 && gap <= state.settings.rollingLoadWindowMinutes;
    })
    .reduce((sum, assignment) => sum + assignment.fatiguePoints, 0);
  return Math.max(0, recentFatigue + targetFatiguePoints - state.settings.rollingLoadMaxFatigue);
}

function positionRotationCost(
  state: AppState,
  staffId: string,
  flightNo: string,
  position: string,
  date: string | null
): number {
  if (!state.settings.positionRotationEnabled || !date) return 0;
  const normalizedFlight = normalizedPolicyValue(flightNo);
  const normalizedPosition = normalizedPolicyValue(position);
  return recentHistory(state.history, date, state.settings.positionRotationLookbackDays)
    .filter((record) => record.staffId === staffId
      && normalizedPolicyValue(record.flightNo) === normalizedFlight
      && normalizedPolicyValue(record.position) === normalizedPosition)
    .length;
}

function lateShiftOperationalStart(startTime: string, state: AppState): number | null {
  const start = timeToMinutes(startTime);
  const cutoff = timeToMinutes(state.settings.lateShiftStartTime);
  const nightEnd = timeToMinutes(state.settings.nightEnd);
  if (![start, cutoff, nightEnd].every(Number.isFinite)) return null;
  if (start >= cutoff) return start;
  if (start < nightEnd) return start + 24 * 60;
  return null;
}

export function isInFinalLateBatch(target: Pick<Flight, "startTime">, items: Array<Pick<Flight, "startTime">>, state: AppState): boolean {
  const targetStart = lateShiftOperationalStart(target.startTime, state);
  const lateStarts = items.map((item) => lateShiftOperationalStart(item.startTime, state)).filter((value): value is number => value !== null);
  if (targetStart === null || !lateStarts.length) return false;
  return Math.max(...lateStarts) - targetStart <= state.settings.lateShiftLatestWindowMinutes;
}

function lateShiftRecoveryRisk(
  state: AppState,
  staffId: string,
  targetFlight: Pick<Flight, "startTime">,
  targetFatiguePoints: number,
  date: string | null
): { protected: boolean; excess: number } {
  if (!state.settings.lateShiftRecoveryEnabled || !date || !isInFinalLateBatch(targetFlight, state.flights, state)) {
    return { protected: false, excess: 0 };
  }
  const recentDutyHistory = recentHistory(state.history, date, 3);
  const previousDutyDate = recentDutyHistory.map((record) => record.date).sort().at(-1);
  const previousDutyDay = recentDutyHistory.filter((record) => record.date === previousDutyDate);
  const finalLateRecords = previousDutyDay.filter((record) => isInFinalLateBatch(record, previousDutyDay, state));
  const protectedWorker = finalLateRecords.some((record) => record.staffId === staffId
    && isHighLoadPosition(record.fatiguePoints, record.remark, state));
  return {
    protected: protectedWorker,
    excess: protectedWorker ? Math.max(0, targetFatiguePoints - state.settings.nextDayLateMaxFatigue) : 0
  };
}

function lateShiftRecoveryCost(
  state: AppState,
  staffId: string,
  targetFlight: Pick<Flight, "startTime">,
  targetFatiguePoints: number,
  date: string | null
): number {
  const risk = lateShiftRecoveryRisk(state, staffId, targetFlight, targetFatiguePoints, date);
  return risk.protected ? 1 + risk.excess : 0;
}

interface AssignmentTask {
  key: string;
  flight: Flight;
  rule: PositionRule;
}

const PRE_NOON_CUTOFF_MINUTES = 12 * 60;

export function isPreNoonFlight(target: Pick<Flight, "startTime">): boolean {
  const start = timeToMinutes(target.startTime);
  return Number.isFinite(start) && start < PRE_NOON_CUTOFF_MINUTES;
}

function mustAutoFillPreNoon(flight: Flight, rule: PositionRule): boolean {
  return isPreNoonFlight(flight) && rule.category === "常规";
}

function isKe166MobileSupervisor(flight: Flight, rule: PositionRule): boolean {
  return flight.flightNo.trim().toUpperCase().replaceAll(/[^A-Z0-9]/g, "") === "KE166"
    && rule.category === "机动督导";
}

function isNumberedRegularPosition(rule: PositionRule): boolean {
  return rule.category === "常规" && /\d/.test(rule.name);
}

function shouldAutoAssign(flight: Flight, rule: PositionRule): boolean {
  if (isKe166MobileSupervisor(flight, rule)) return true;
  if (mustAutoFillPreNoon(flight, rule)) return true;
  return !["引导", "行政支援"].includes(rule.category)
    && !rule.manual
    && (rule.minPassengers ?? 0) <= flight.bookedPassengers;
}

export function dutyLatePositionPriority(position: string, remark: string): number {
  const value = `${position} ${remark}`;
  if (value.includes("一号")) return 0;
  if (isSupervisorPosition(position)) return 1;
  if (value.includes("申报")) return 2;
  if (value.includes("送资料")) return 3;
  return 4;
}

function matchesDutyPositionPriority(
  priority: AppState["settings"]["dutyPositionPriorities"][number],
  target: Pick<Assignment, "flightNo" | "position" | "remark">
): boolean {
  const flightNo = target.flightNo.trim().toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
  const positionText = `${target.position} ${target.remark}`.trim().toLowerCase();
  return priority.enabled
    && priority.flightNo.trim().toUpperCase().replaceAll(/[^A-Z0-9]/g, "") === flightNo
    && (!priority.positionKeyword.trim() || positionText.includes(priority.positionKeyword.trim().toLowerCase()));
}

export function configuredDutyPositionPriority(
  state: AppState,
  target: Pick<Assignment, "flightNo" | "position" | "remark">
): number {
  return state.settings.dutyPositionPriorities.findIndex((item) => matchesDutyPositionPriority(item, target));
}

export const DUTY_MORNING_CUTOFF = "08:30";

export function isDutyMorningFlight(target: Pick<Flight, "startTime">, state: AppState): boolean {
  const start = timeToMinutes(target.startTime);
  const morningStart = timeToMinutes(state.settings.nightEnd);
  const cutoff = timeToMinutes(DUTY_MORNING_CUTOFF);
  return [start, morningStart, cutoff].every(Number.isFinite) && start >= morningStart && start <= cutoff;
}

function operationalStartMinutes(startTime: string, state: AppState): number {
  const start = timeToMinutes(startTime);
  const nightEnd = timeToMinutes(state.settings.nightEnd);
  return start < nightEnd ? start + 24 * 60 : start;
}

function preferredDutyLateTasks(state: AppState, date: string, tasks: AssignmentTask[]): AssignmentTask[] {
  const dutyStaffId = getDutyRosterForDate(state, date).dutyStaffId;
  if (!dutyStaffId || !tasks.length) return [];
  const eligibleTasks = tasks
    .filter((task) => durationHours(task.flight.startTime, task.flight.endTime) <= state.settings.maxDailyHours)
    .filter((task) => eligibleStaffForRule(state, task.flight, task.rule).some((person) => person.id === dutyStaffId));
  const ordered: AssignmentTask[] = [];
  for (const priority of state.settings.dutyPositionPriorities.filter((item) => item.enabled)) {
    const target = eligibleTasks.find((task) => matchesDutyPositionPriority(priority, {
      flightNo: task.flight.flightNo,
      position: task.rule.name,
      remark: task.rule.remark
    }));
    if (target && !ordered.includes(target)) ordered.push(target);
  }
  const latestStarts = [...new Set(state.flights.map((flight) => operationalStartMinutes(flight.startTime, state)))]
    .sort((left, right) => right - left)
    .slice(0, 2);
  for (const start of latestStarts) {
    const targets = tasks
      .filter((task) => operationalStartMinutes(task.flight.startTime, state) === start)
      .filter((task) => dutyLatePositionPriority(task.rule.name, task.rule.remark) < 4)
      .filter((task) => eligibleTasks.includes(task))
      .sort((left, right) => dutyLatePositionPriority(left.rule.name, left.rule.remark)
        - dutyLatePositionPriority(right.rule.name, right.rule.remark));
    targets.forEach((target) => { if (!ordered.includes(target)) ordered.push(target); });
  }
  return ordered;
}

function preferredDutyMorningTask(state: AppState, date: string, tasks: AssignmentTask[]): AssignmentTask | undefined {
  const dutyStaffId = getDutyRosterForDate(state, date).dutyStaffId;
  if (!dutyStaffId) return undefined;
  return tasks
    .filter((task) => isDutyMorningFlight(task.flight, state))
    .filter((task) => durationHours(task.flight.startTime, task.flight.endTime) <= state.settings.maxDailyHours)
    .filter((task) => eligibleStaffForRule(state, task.flight, task.rule).some((person) => person.id === dutyStaffId))
    .sort((left, right) => timeToMinutes(right.flight.startTime) - timeToMinutes(left.flight.startTime)
      || left.rule.fatiguePoints - right.rule.fatiguePoints)[0];
}

function dutyAssignmentCost(staffId: string, taskKey: string, dutyStaffId: string | null, targetTaskKeys: ReadonlySet<string>): number {
  if (!dutyStaffId || !targetTaskKeys.size || staffId !== dutyStaffId) return 0;
  return targetTaskKeys.has(taskKey) ? -1 : 1;
}

function eligibleStaffForRule(state: AppState, flight: Flight, rule: PositionRule): Staff[] {
  return state.staff
    .filter((person) => person.status === "正常" && person.staffType !== "行政支援")
    .filter((person) => rule.qualifiedStaffIds.includes(person.id))
    .filter((person) => !isNightInterval(flight.startTime, flight.endTime, state.settings.nightStart, state.settings.nightEnd) || person.nightShift);
}

function preferNonTeamLeaderCandidates(candidates: Staff[]): Staff[] {
  const regularCandidates = candidates.filter((person) => !person.teamLeader);
  return regularCandidates.length ? regularCandidates : candidates;
}

function reuseKe166RegularWorkerAsSupervisor(
  state: AppState,
  assignments: Assignment[],
  flight: Flight,
  rule: PositionRule,
  date: string
): Assignment | undefined {
  if (!isKe166MobileSupervisor(flight, rule)) return undefined;
  const eligibleIds = new Set(eligibleStaffForRule(state, flight, rule).map((person) => person.id));
  const regularAssignment = assignments
    .filter((assignment) => {
      const sourceRule = assignmentRule(state, assignment);
      return assignment.flightId === flight.id
        && assignment.status === "assigned"
        && assignment.staffId
        && eligibleIds.has(assignment.staffId)
        && Boolean(sourceRule
          && isNumberedRegularPosition(sourceRule)
          && canMobileSupervisorCoverPosition(state, {
            flightNo: flight.flightNo,
            position: sourceRule.name,
            remark: sourceRule.remark
          }));
    })
    .sort((left, right) => {
      const leftPerson = state.staff.find((person) => person.id === left.staffId)!;
      const rightPerson = state.staff.find((person) => person.id === right.staffId)!;
      return Number(leftPerson.teamLeader) - Number(rightPerson.teamLeader)
        || candidateScore(leftPerson, assignments, state, date) - candidateScore(rightPerson, assignments, state, date)
        || leftPerson.id.localeCompare(rightPerson.id, undefined, { numeric: true });
    })[0];
  if (!regularAssignment?.staffId) return undefined;

  const supervisorAssignment: Assignment = {
    id: createId("assignment"),
    flightId: flight.id,
    flightNo: flight.flightNo,
    positionRuleId: rule.id,
    position: rule.name,
    staffId: regularAssignment.staffId,
    staffName: regularAssignment.staffName,
    startTime: flight.startTime,
    endTime: flight.endTime,
    workHours: durationHours(flight.startTime, flight.endTime),
    fatiguePoints: rule.fatiguePoints,
    remark: rule.remark,
    manualRemark: "",
    status: "assigned"
  };
  regularAssignment.workHours = 0;
  regularAssignment.supervisorSourceAssignmentId = supervisorAssignment.id;
  return supervisorAssignment;
}

function reservationCost(
  person: Staff,
  flight: Flight,
  tasks: AssignmentTask[],
  processedTasks: Set<string>,
  eligibleCounts: Map<string, number>,
  eligibleStaffIds: Map<string, Set<string>>
): number {
  return tasks.reduce((cost, task) => {
    if (processedTasks.has(task.key)
      || !eligibleStaffIds.get(task.key)?.has(person.id)
      || !intervalsOverlap(flight.startTime, flight.endTime, task.flight.startTime, task.flight.endTime)) return cost;
    return cost + 1 / Math.max(1, eligibleCounts.get(task.key) ?? 1);
  }, 0);
}

function makeUnfilled(flight: Flight, position: string, rule: PositionRule | undefined): Assignment {
  return {
    id: createId("assignment"),
    flightId: flight.id,
    flightNo: flight.flightNo,
    positionRuleId: rule?.id ?? null,
    position,
    staffId: null,
    staffName: "",
    startTime: flight.startTime,
    endTime: flight.endTime,
    workHours: durationHours(flight.startTime, flight.endTime),
    fatiguePoints: rule?.fatiguePoints ?? durationHours(flight.startTime, flight.endTime),
    remark: rule?.remark ?? "未找到岗位规则",
    manualRemark: "",
    status: rule?.manual || isAuxiliaryCategory(rule?.category) ? "manual" : "unfilled"
  };
}

export function activeFlightRules(state: AppState, flight: Flight): PositionRule[] {
  const flightRules = state.positionRules.filter((rule) => rule.flightNo === flight.flightNo);
  const administrativePositions = new Set(flightRules
    .filter((rule) => rule.category === "行政支援")
    .map((rule) => rule.name.trim()));
  const configured = state.settings.adminSupportEnabled
    ? flightRules.filter((rule) => rule.category === "行政支援" || !administrativePositions.has(rule.name.trim()))
    : flightRules.filter((rule) => rule.category !== "行政支援");
  const primary = configured.filter((rule) => rule.category !== "引导" && !isFixedBottomPosition(rule.name));
  const fixedBottom = configured.filter((rule) => rule.category === "引导" || isFixedBottomPosition(rule.name));
  const orderedPrimary = primary
    .map((rule, index) => ({ rule, index }))
    .sort((left, right) => Number(right.rule.category === "机动督导" || isSupervisorPosition(right.rule.name))
      - Number(left.rule.category === "机动督导" || isSupervisorPosition(left.rule.name)) || left.index - right.index)
    .map(({ rule }) => rule);
  return [...orderedPrimary, ...fixedBottom];
}

export function activeFlightPositions(state: AppState, flight: Flight): string[] {
  return activeFlightRules(state, flight).map((rule) => rule.name);
}

function strictOverrideNotes(
  state: AppState,
  assignments: Assignment[],
  person: Staff,
  task: AssignmentTask,
  date: string
): string[] {
  if (!mustAutoFillPreNoon(task.flight, task.rule)) return [];
  const rules: string[] = [];
  if (state.settings.highLoadProtectionEnabled
    && state.settings.highLoadTransitionMode === "forbid"
    && hasHighLoadTransition(assignments, person.id, task.flight.startTime, task.flight.endTime, task.rule.fatiguePoints, task.rule.remark, state)) {
    rules.push("高负荷岗位衔接保护");
  }
  rules.push(...violatedPositionTransitionPoliciesForInsertion(
    assignments,
    person.id,
    task.flight.flightNo,
    task.rule.name,
    task.flight.startTime,
    task.flight.endTime,
    state,
    "forbid"
  ).map((policy) => policy.name));
  if (state.settings.rollingLoadProtectionEnabled
    && state.settings.rollingLoadMode === "forbid"
    && rollingLoadCost(assignments, person.id, task.flight.startTime, task.rule.fatiguePoints, task.rule.remark, state) > 0) {
    rules.push("滚动负荷上限");
  }
  if (state.settings.positionRotationEnabled
    && state.settings.positionRotationMode === "forbid"
    && positionRotationCost(state, person.id, task.flight.flightNo, task.rule.name, date) > 0) {
    rules.push("同岗轮换");
  }
  if (state.settings.lateShiftRecoveryEnabled
    && state.settings.lateShiftRecoveryMode === "forbid"
    && lateShiftRecoveryRisk(state, person.id, task.flight, task.rule.fatiguePoints, date).excess > 0) {
    rules.push("跨工作日晚班减负");
  }
  return [...new Set(rules)].map((rule) => `已突破严格限制仍安排：${rule}`);
}

function preNoonShortageNote(state: AppState, assignments: Assignment[], task: AssignmentTask): string {
  const qualified = state.staff.filter((person) => person.staffType === "常规" && task.rule.qualifiedStaffIds.includes(person.id));
  const normal = qualified.filter((person) => person.status === "正常");
  const nightCapable = normal.filter((person) => !isNightInterval(
    task.flight.startTime,
    task.flight.endTime,
    state.settings.nightStart,
    state.settings.nightEnd
  ) || person.nightShift);
  const withoutConflict = nightCapable.filter((person) => staffConflicts(assignments, person.id, task.flight)
    .every((assignment) => canReleaseForFlight(assignment, task.flight, state)));
  const hours = durationHours(task.flight.startTime, task.flight.endTime);
  const withinHours = withoutConflict.filter((person) => projectedAssignedHours(assignments, person.id, task.flight, state) + hours <= state.settings.maxDailyHours);
  const reasons = [
    qualified.length === 0 ? "具备岗位资质 0 人" : "",
    qualified.length > normal.length ? `状态非正常 ${qualified.length - normal.length} 人` : "",
    normal.length > nightCapable.length ? `夜班能力不符 ${normal.length - nightCapable.length} 人` : "",
    nightCapable.length > withoutConflict.length ? `时段冲突 ${nightCapable.length - withoutConflict.length} 人` : "",
    withoutConflict.length > withinHours.length ? `超过每日工时上限 ${withoutConflict.length - withinHours.length} 人` : "",
    withinHours.length ? "无可继续调配的空闲人员" : ""
  ].filter(Boolean);
  return `因合格人数不足而无法填满（缺少 1 人：${reasons.join("，") || "无满足全部硬约束的常规人员"}）`;
}

interface RegularPlacement {
  person: Staff;
  sourceAssignment: Assignment;
  sourceRule: PositionRule;
  originalIndex: number;
  manualRemark: string;
  supervisorSourceAssignmentId: string | undefined;
}

interface RegularSlot {
  assignment: Assignment;
  rule: PositionRule;
}

function canMoveRegularPlacement(
  state: AppState,
  assignments: Assignment[],
  flight: Flight,
  placement: RegularPlacement,
  targetRule: PositionRule
): boolean {
  if (!eligibleStaffForRule(state, flight, targetRule).some((person) => person.id === placement.person.id)) return false;
  if (placement.supervisorSourceAssignmentId && !canMobileSupervisorCoverPosition(state, {
    flightNo: flight.flightNo,
    position: targetRule.name,
    remark: targetRule.remark
  })) return false;
  const otherFlights = assignments.filter((assignment) => assignment.flightId !== flight.id);
  const sourceCost = positionTransitionInsertionCost(
    otherFlights,
    placement.person.id,
    { key: `${flight.id}:${placement.sourceRule.id}`, flight, rule: placement.sourceRule },
    state,
    "forbid"
  );
  const targetCost = positionTransitionInsertionCost(
    otherFlights,
    placement.person.id,
    { key: `${flight.id}:${targetRule.id}`, flight, rule: targetRule },
    state,
    "forbid"
  );
  return targetCost <= sourceCost;
}

function canMatchEveryPlacement(
  placements: RegularPlacement[],
  slots: RegularSlot[],
  canPlace: (placement: RegularPlacement, slot: RegularSlot) => boolean
): boolean {
  return matchEveryPlacement(placements, slots, canPlace) !== null;
}

function matchEveryPlacement(
  placements: RegularPlacement[],
  slots: RegularSlot[],
  canPlace: (placement: RegularPlacement, slot: RegularSlot) => boolean
): Map<string, RegularPlacement> | null {
  if (placements.length > slots.length) return null;
  const placementById = new Map(placements.map((placement) => [placement.sourceAssignment.id, placement]));
  const matchedPlacementBySlot = new Map<string, string>();

  const tryMatch = (placement: RegularPlacement, visitedSlots: Set<string>): boolean => {
    for (const slot of slots) {
      if (visitedSlots.has(slot.assignment.id) || !canPlace(placement, slot)) continue;
      visitedSlots.add(slot.assignment.id);
      const matchedId = matchedPlacementBySlot.get(slot.assignment.id);
      const matched = matchedId ? placementById.get(matchedId) : undefined;
      if (!matched || tryMatch(matched, visitedSlots)) {
        matchedPlacementBySlot.set(slot.assignment.id, placement.sourceAssignment.id);
        return true;
      }
    }
    return false;
  };

  const matched = [...placements]
    .sort((left, right) => left.originalIndex - right.originalIndex)
    .every((placement) => tryMatch(placement, new Set()));
  if (!matched) return null;
  return new Map([...matchedPlacementBySlot].map(([slotId, placementId]) => [slotId, placementById.get(placementId)!]));
}

function canCoverRegularSlots(
  placements: RegularPlacement[],
  allSlots: RegularSlot[],
  requiredSlots: RegularSlot[],
  canPlace: (placement: RegularPlacement, slot: RegularSlot) => boolean
): boolean {
  if (requiredSlots.length > placements.length) return false;
  const requiredIds = new Set(requiredSlots.map((slot) => slot.assignment.id));
  const optionalSlots = allSlots.filter((slot) => !requiredIds.has(slot.assignment.id));
  const memo = new Map<string, boolean>();

  const search = (requiredIndex: number, usedPlacementIds: Set<string>): boolean => {
    const key = `${requiredIndex}:${[...usedPlacementIds].sort().join(",")}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    if (requiredIndex >= requiredSlots.length) {
      const remaining = placements.filter((placement) => !usedPlacementIds.has(placement.sourceAssignment.id));
      const result = canMatchEveryPlacement(remaining, optionalSlots, canPlace);
      memo.set(key, result);
      return result;
    }
    const requiredSlot = requiredSlots[requiredIndex]!;
    const result = placements.some((placement) => {
      if (usedPlacementIds.has(placement.sourceAssignment.id) || !canPlace(placement, requiredSlot)) return false;
      const nextUsed = new Set(usedPlacementIds);
      nextUsed.add(placement.sourceAssignment.id);
      return search(requiredIndex + 1, nextUsed);
    });
    memo.set(key, result);
    return result;
  };

  return search(0, new Set());
}

function compactRegularAssignments(state: AppState, assignments: Assignment[]): Set<string> {
  const changedFlightIds = new Set<string>();

  for (const flight of state.flights) {
    const orderedRules = activeFlightRules(state, flight).filter((rule) => rule.category === "常规");
    const slots = orderedRules
      .map((rule) => ({
        rule,
        assignment: assignments.find((assignment) => assignment.flightId === flight.id && assignment.positionRuleId === rule.id)
      }))
      .filter((slot): slot is RegularSlot => Boolean(slot.assignment && slot.assignment.status !== "manual"));
    const firstVacancy = slots.findIndex((slot, index) => slot.assignment.status !== "assigned"
      && slots.slice(index + 1).some((later) => later.assignment.status === "assigned"));
    if (firstVacancy < 0) continue;

    const tailSlots = slots;
    const placements = tailSlots
      .map((slot, index) => {
        if (slot.assignment.status !== "assigned" || !slot.assignment.staffId) return null;
        const person = state.staff.find((item) => item.id === slot.assignment.staffId);
        return person ? {
          person,
          sourceAssignment: slot.assignment,
          sourceRule: slot.rule,
          originalIndex: index,
          manualRemark: slot.assignment.manualRemark,
          supervisorSourceAssignmentId: slot.assignment.supervisorSourceAssignmentId
        } : null;
      })
      .filter((placement): placement is RegularPlacement => Boolean(placement));
    const canPlace = (placement: RegularPlacement, slot: RegularSlot) => canMoveRegularPlacement(
      state,
      assignments,
      flight,
      placement,
      slot.rule
    );
    const occupiedSlots: RegularSlot[] = [];
    for (const slot of tailSlots) {
      if (canCoverRegularSlots(placements, tailSlots, [...occupiedSlots, slot], canPlace)) occupiedSlots.push(slot);
      if (occupiedSlots.length === placements.length) break;
    }
    const placementBySlot = matchEveryPlacement(placements, occupiedSlots, canPlace);
    if (!placementBySlot) continue;
    const changed = tailSlots.some((slot) => placementBySlot.get(slot.assignment.id)?.sourceAssignment.id !== slot.assignment.id
      && (placementBySlot.has(slot.assignment.id) || slot.assignment.status === "assigned"));
    if (!changed) continue;

    for (const slot of tailSlots) {
      const placement = placementBySlot.get(slot.assignment.id);
      delete slot.assignment.systemNotes;
      delete slot.assignment.supervisorSourceAssignmentId;
      if (!placement) {
        slot.assignment.staffId = null;
        slot.assignment.staffName = "";
        slot.assignment.workHours = durationHours(flight.startTime, flight.endTime);
        slot.assignment.manualRemark = "";
        slot.assignment.status = "unfilled";
        continue;
      }
      slot.assignment.staffId = placement.person.id;
      slot.assignment.staffName = placement.person.name;
      slot.assignment.workHours = placement.supervisorSourceAssignmentId
        ? 0
        : durationHours(flight.startTime, flight.endTime);
      slot.assignment.manualRemark = placement.manualRemark;
      slot.assignment.status = "assigned";
      if (placement.supervisorSourceAssignmentId) {
        slot.assignment.supervisorSourceAssignmentId = placement.supervisorSourceAssignmentId;
      }
    }
    changedFlightIds.add(flight.id);
  }

  for (const flightId of changedFlightIds) {
    const flight = state.flights.find((item) => item.id === flightId)!;
    const displayRules = activeFlightRules(state, flight);
    const displayIndex = new Map(displayRules.map((rule, index) => [rule.id, index]));
    const regularAssignments = assignments
      .filter((assignment) => assignment.flightId === flightId
        && assignment.status === "assigned"
        && assignment.staffId
        && assignmentRule(state, assignment)?.category === "常规")
      .sort((left, right) => (displayIndex.get(right.positionRuleId ?? "") ?? -1)
        - (displayIndex.get(left.positionRuleId ?? "") ?? -1));
    const usedStaffIds = new Set<string>();
    assignments
      .filter((assignment) => assignment.flightId === flightId && assignmentRule(state, assignment)?.category === "引导")
      .sort((left, right) => (displayIndex.get(left.positionRuleId ?? "") ?? 0)
        - (displayIndex.get(right.positionRuleId ?? "") ?? 0))
      .forEach((guide) => {
        const source = regularAssignments.find((assignment) => assignment.staffId && !usedStaffIds.has(assignment.staffId));
        guide.staffId = source?.staffId ?? null;
        guide.staffName = source?.staffName ?? "";
        guide.workHours = 0;
        guide.status = source ? "assigned" : "unfilled";
        delete guide.systemNotes;
        if (source?.staffId) usedStaffIds.add(source.staffId);
      });
  }

  assignments
    .filter((assignment) => changedFlightIds.has(assignment.flightId)
      && assignment.status === "unfilled"
      && isPreNoonFlight(assignment)
      && assignmentRule(state, assignment)?.category === "常规")
    .forEach((assignment) => {
      const flight = state.flights.find((item) => item.id === assignment.flightId)!;
      const rule = assignmentRule(state, assignment)!;
      assignment.systemNotes = [preNoonShortageNote(
        state,
        assignments,
        { key: `${flight.id}:${rule.id}`, flight, rule }
      )];
    });

  return changedFlightIds;
}

export function generateSchedule(state: AppState, date: string): ScheduleResult {
  const assignments: Assignment[] = [];
  const warnings: string[] = [];
  const flights = [...state.flights].sort((left, right) => left.startTime.localeCompare(right.startTime));
  const displayRulesByFlight = new Map(flights.map((flight) => [flight.id, activeFlightRules(state, flight)]));
  const tasks: AssignmentTask[] = flights.flatMap((flight) => (displayRulesByFlight.get(flight.id) ?? [])
    .filter((rule) => shouldAutoAssign(flight, rule))
    .map((rule) => ({ key: `${flight.id}:${rule.id}`, flight, rule })));
  const eligibleStaffIds = new Map(tasks.map((task) => [task.key, new Set(eligibleStaffForRule(state, task.flight, task.rule).map((person) => person.id))]));
  const eligibleCounts = new Map(tasks.map((task) => [task.key, eligibleStaffIds.get(task.key)?.size ?? 0]));
  const workloadPressure = analyzeWorkloadPressure(state);
  const prioritizeWorkloadBalance = workloadPressure.pressure === "密集" || flights.length >= 4;
  const dutyStaffId = getDutyRosterForDate(state, date).dutyStaffId;
  const preferredDutyMorningTaskKey = preferredDutyMorningTask(state, date, tasks)?.key ?? null;
  const preferredDutyLateTaskCandidates = preferredDutyLateTasks(state, date, tasks);
  const dutyTargetTaskKeys = new Set([preferredDutyMorningTaskKey, ...preferredDutyLateTaskCandidates.map((task) => task.key)].filter((key): key is string => Boolean(key)));
  let assignedDutyLateTaskKey: string | null = null;
  const ke166SupervisorTask = tasks.find((task) => isKe166MobileSupervisor(task.flight, task.rule));
  const ke166SupervisorStaffIds = new Set(ke166SupervisorTask ? eligibleStaffIds.get(ke166SupervisorTask.key) ?? [] : []);
  const ke166NonTeamLeaderSupervisorStaffIds = new Set([...ke166SupervisorStaffIds]
    .filter((staffId) => !state.staff.find((person) => person.id === staffId)?.teamLeader));
  const ke166RegularTargets = tasks
    .filter((task) => task.flight.id === ke166SupervisorTask?.flight.id && isNumberedRegularPosition(task.rule))
    .filter((task) => canMobileSupervisorCoverPosition(state, {
      flightNo: task.flight.flightNo,
      position: task.rule.name,
      remark: task.rule.remark
    }))
    .filter((task) => [...(eligibleStaffIds.get(task.key) ?? [])].some((staffId) => ke166SupervisorStaffIds.has(staffId)))
    .sort((left, right) => Number([...(eligibleStaffIds.get(right.key) ?? [])].some((staffId) => ke166NonTeamLeaderSupervisorStaffIds.has(staffId)))
      - Number([...(eligibleStaffIds.get(left.key) ?? [])].some((staffId) => ke166NonTeamLeaderSupervisorStaffIds.has(staffId)))
      || (eligibleCounts.get(right.key) ?? 0) - (eligibleCounts.get(left.key) ?? 0));
  const ke166RegularTargetTaskKey = (ke166RegularTargets.find((task) => task.key !== preferredDutyMorningTaskKey)
    ?? ke166RegularTargets[0])?.key ?? null;
  const processedTasks = new Set<string>();

  const scheduleTask = (task: AssignmentTask, allowMorningReallocation: boolean): void => {
    const { flight, rule, key: taskKey } = task;
    const hours = durationHours(flight.startTime, flight.endTime);
    const preNoonRequired = mustAutoFillPreNoon(flight, rule);
    processedTasks.add(taskKey);
    const reusedSupervisor = reuseKe166RegularWorkerAsSupervisor(state, assignments, flight, rule, date);
    if (reusedSupervisor) {
      assignments.push(reusedSupervisor);
      return;
    }
    let candidates = eligibleStaffForRule(state, flight, rule)
      .filter((person) => staffConflicts(assignments, person.id, flight).every((assignment) => canReleaseForFlight(assignment, flight, state)))
      .filter((person) => projectedAssignedHours(assignments, person.id, flight, state) + hours <= state.settings.maxDailyHours);
    const reserveDutyForTarget = Boolean(dutyStaffId
      && taskKey !== preferredDutyMorningTaskKey
      && taskKey !== assignedDutyLateTaskKey
      && (Boolean(assignedDutyLateTaskKey)
        || (!dutyTargetTaskKeys.has(taskKey) && [...dutyTargetTaskKeys].some((targetKey) => !processedTasks.has(targetKey)))));
    if (reserveDutyForTarget) {
      const withoutDuty = candidates.filter((person) => person.id !== dutyStaffId);
      if (!preNoonRequired || withoutDuty.length) candidates = withoutDuty;
    }
    const reserveKe166Supervisor = Boolean(
      (ke166RegularTargetTaskKey
        && taskKey !== ke166RegularTargetTaskKey
        && !processedTasks.has(ke166RegularTargetTaskKey))
      || (!ke166RegularTargetTaskKey
        && ke166SupervisorTask
        && taskKey !== ke166SupervisorTask.key
        && task.flight.id === ke166SupervisorTask.flight.id
        && !processedTasks.has(ke166SupervisorTask.key))
    );
    if (reserveKe166Supervisor) {
      const withoutKe166Supervisor = candidates.filter((person) => !ke166SupervisorStaffIds.has(person.id));
      if (withoutKe166Supervisor.length) candidates = withoutKe166Supervisor;
    }
    if (taskKey === ke166RegularTargetTaskKey) {
      const mobileSupervisorCandidates = candidates.filter((person) => ke166SupervisorStaffIds.has(person.id));
      if (mobileSupervisorCandidates.length) candidates = mobileSupervisorCandidates;
    }
    if (state.settings.highLoadTransitionMode === "forbid") {
      const protectedCandidates = candidates.filter((person) => !hasHighLoadTransition(assignments, person.id, flight.startTime, flight.endTime, rule.fatiguePoints, rule.remark, state));
      if (protectedCandidates.length) candidates = protectedCandidates;
    }
    const transitionSafe = candidates.filter((person) => positionTransitionInsertionCost(assignments, person.id, task, state, "forbid") === 0);
    candidates = preNoonRequired ? (transitionSafe.length ? transitionSafe : candidates) : transitionSafe;
    if (state.settings.rollingLoadMode === "forbid") {
      const protectedCandidates = candidates.filter((person) => rollingLoadCost(assignments, person.id, flight.startTime, rule.fatiguePoints, rule.remark, state) === 0);
      if (protectedCandidates.length) candidates = protectedCandidates;
    }
    if (state.settings.positionRotationMode === "forbid") {
      const rotatedCandidates = candidates.filter((person) => positionRotationCost(state, person.id, flight.flightNo, rule.name, date) === 0);
      if (rotatedCandidates.length) candidates = rotatedCandidates;
    }
    if (state.settings.lateShiftRecoveryMode === "forbid") {
      const protectedCandidates = candidates.filter((person) => lateShiftRecoveryRisk(state, person.id, flight, rule.fatiguePoints, date).excess === 0);
      if (protectedCandidates.length) candidates = protectedCandidates;
    }
    if (isSupervisorPosition(rule.name) || taskKey === ke166RegularTargetTaskKey) {
      const teamLeaderNeededForCoverage = candidates.some((person) => person.teamLeader
        && !assignments.some((assignment) => assignment.staffId === person.id && assignment.workHours > 0)
        && !tasks.some((futureTask) => futureTask.key !== taskKey
          && !processedTasks.has(futureTask.key)
          && !isSupervisorPosition(futureTask.rule.name)
          && eligibleStaffIds.get(futureTask.key)?.has(person.id)
          && staffConflicts(assignments, person.id, futureTask.flight).every((assignment) => canReleaseForFlight(assignment, futureTask.flight, state))
          && projectedAssignedHours(assignments, person.id, futureTask.flight, state) + durationHours(futureTask.flight.startTime, futureTask.flight.endTime) <= state.settings.maxDailyHours));
      if (!teamLeaderNeededForCoverage) candidates = preferNonTeamLeaderCandidates(candidates);
    }
    candidates.sort((left, right) => dutyAssignmentCost(left.id, taskKey, dutyStaffId, dutyTargetTaskKeys)
      - dutyAssignmentCost(right.id, taskKey, dutyStaffId, dutyTargetTaskKeys)
      || (taskKey === ke166RegularTargetTaskKey
        ? Number(!ke166SupervisorStaffIds.has(left.id)) - Number(!ke166SupervisorStaffIds.has(right.id))
        : 0)
      || positionTransitionInsertionCost(assignments, left.id, task, state, "prefer")
      - positionTransitionInsertionCost(assignments, right.id, task, state, "prefer")
      || (prioritizeWorkloadBalance
        ? workloadBalanceCost(left, assignments, state, hours, rule.fatiguePoints, dutyStaffId, date, workloadPressure)
          - workloadBalanceCost(right, assignments, state, hours, rule.fatiguePoints, dutyStaffId, date, workloadPressure)
        : 0)
      || (state.settings.lateShiftRecoveryEnabled
        ? lateShiftRecoveryCost(state, left.id, flight, rule.fatiguePoints, date)
          - lateShiftRecoveryCost(state, right.id, flight, rule.fatiguePoints, date)
        : 0)
      || (state.settings.rollingLoadProtectionEnabled
        ? rollingLoadCost(assignments, left.id, flight.startTime, rule.fatiguePoints, rule.remark, state)
          - rollingLoadCost(assignments, right.id, flight.startTime, rule.fatiguePoints, rule.remark, state)
        : 0)
      || (state.settings.positionRotationEnabled
        ? positionRotationCost(state, left.id, flight.flightNo, rule.name, date)
          - positionRotationCost(state, right.id, flight.flightNo, rule.name, date)
        : 0)
      || (state.settings.highLoadProtectionEnabled
        ? Number(hasHighLoadTransition(assignments, left.id, flight.startTime, flight.endTime, rule.fatiguePoints, rule.remark, state))
          - Number(hasHighLoadTransition(assignments, right.id, flight.startTime, flight.endTime, rule.fatiguePoints, rule.remark, state))
        : 0)
      || Number(assignments.some((item) => item.staffId === left.id && item.workHours > 0))
        - Number(assignments.some((item) => item.staffId === right.id && item.workHours > 0))
      || reservationCost(left, flight, tasks, processedTasks, eligibleCounts, eligibleStaffIds)
        - reservationCost(right, flight, tasks, processedTasks, eligibleCounts, eligibleStaffIds)
      || workloadBalanceCost(left, assignments, state, hours, rule.fatiguePoints, dutyStaffId, date, workloadPressure)
        - workloadBalanceCost(right, assignments, state, hours, rule.fatiguePoints, dutyStaffId, date, workloadPressure)
      || candidateScore(left, assignments, state, date) - candidateScore(right, assignments, state, date)
      || left.id.localeCompare(right.id, undefined, { numeric: true }));

    let selected = candidates[0];
    if (!selected && allowMorningReallocation && preNoonRequired) {
      const donors = assignments
        .filter((assignment) => assignment.status === "assigned" && assignment.staffId && assignment.flightId !== flight.id && isPreNoonFlight(assignment))
        .map((assignment) => ({
          assignment,
          sourceRule: assignmentRule(state, assignment),
          person: state.staff.find((person) => person.id === assignment.staffId)
        }))
        .filter((item): item is typeof item & { person: Staff; sourceRule: PositionRule } => Boolean(
          item.person
          && item.sourceRule?.category === "常规"
          && item.person.status === "正常"
          && item.person.staffType === "常规"
          && rule.qualifiedStaffIds.includes(item.person.id)
          && (!isNightInterval(flight.startTime, flight.endTime, state.settings.nightStart, state.settings.nightEnd) || item.person.nightShift)
        ))
        .filter((item) => {
          const remaining = assignments.filter((assignment) => assignment.id !== item.assignment.id);
          return staffConflicts(remaining, item.person.id, flight).every((assignment) => canReleaseForFlight(assignment, flight, state))
            && projectedAssignedHours(remaining, item.person.id, flight, state) + hours <= state.settings.maxDailyHours;
        })
        .sort((left, right) => (eligibleCounts.get(`${right.assignment.flightId}:${right.sourceRule.id}`) ?? 0)
          - (eligibleCounts.get(`${left.assignment.flightId}:${left.sourceRule.id}`) ?? 0)
          || left.assignment.startTime.localeCompare(right.assignment.startTime));
      const donor = donors[0];
      if (donor) {
        selected = donor.person;
        donor.assignment.staffId = null;
        donor.assignment.staffName = "";
        donor.assignment.status = "unfilled";
        donor.assignment.systemNotes = [`因抽调至 ${flight.flightNo}/${rule.name} 而空缺`];
        warnings.push(`${donor.assignment.flightNo} / ${donor.assignment.position} 因抽调至 ${flight.flightNo}/${rule.name} 而空缺`);
      }
    }

    if (!selected) {
      const unfilled = makeUnfilled(flight, rule.name, rule);
      if (preNoonRequired) {
        unfilled.status = "unfilled";
        unfilled.systemNotes = [preNoonShortageNote(state, assignments, task)];
      }
      assignments.push(unfilled);
      warnings.push(`${flight.flightNo} / ${rule.name} ${unfilled.systemNotes?.[0] ?? "无可用人员"}`);
      return;
    }

    applyEarlyReleases(assignments, selected.id, flight, state);
    const systemNotes = strictOverrideNotes(state, assignments, selected, task, date);
    assignments.push({
      id: createId("assignment"),
      flightId: flight.id,
      flightNo: flight.flightNo,
      positionRuleId: rule.id,
      position: rule.name,
      staffId: selected.id,
      staffName: selected.name,
      startTime: flight.startTime,
      endTime: flight.endTime,
      workHours: hours,
      fatiguePoints: rule.fatiguePoints,
      remark: rule.remark,
      manualRemark: "",
      status: "assigned",
      ...(systemNotes.length ? { systemNotes } : {})
    });
    warnings.push(...systemNotes.map((note) => `${flight.flightNo} / ${rule.name} ${note}`));
  };

  const preNoonTasks = tasks
    .filter((task) => mustAutoFillPreNoon(task.flight, task.rule))
    .sort((left, right) => Number(right.key === ke166RegularTargetTaskKey) - Number(left.key === ke166RegularTargetTaskKey)
      || (eligibleCounts.get(left.key) ?? 0) - (eligibleCounts.get(right.key) ?? 0)
      || timeToMinutes(left.flight.startTime) - timeToMinutes(right.flight.startTime)
      || (displayRulesByFlight.get(left.flight.id)?.findIndex((rule) => rule.id === left.rule.id) ?? 0)
        - (displayRulesByFlight.get(right.flight.id)?.findIndex((rule) => rule.id === right.rule.id) ?? 0)
      || left.key.localeCompare(right.key));
  preNoonTasks.forEach((task) => { scheduleTask(task, true); });

  for (const task of preferredDutyLateTaskCandidates) {
    if (!processedTasks.has(task.key)) scheduleTask(task, false);
    if (assignments.some((assignment) => assignment.flightId === task.flight.id
      && assignment.positionRuleId === task.rule.id
      && assignment.staffId === dutyStaffId)) {
      assignedDutyLateTaskKey = task.key;
      break;
    }
  }

  for (const flight of flights) {
    const displayRules = displayRulesByFlight.get(flight.id) ?? [];
    const displayIndex = new Map(displayRules.map((rule, index) => [rule.id, index]));
    const processingRules = displayRules
      .filter((rule) => !mustAutoFillPreNoon(flight, rule))
      .filter((rule) => rule.category !== "引导" && rule.category !== "行政支援")
      .sort((left, right) => {
        const leftKey = `${flight.id}:${left.id}`;
        const rightKey = `${flight.id}:${right.id}`;
        if (dutyTargetTaskKeys.has(leftKey) || dutyTargetTaskKeys.has(rightKey)) return dutyTargetTaskKeys.has(leftKey) ? -1 : 1;
        const leftDeferred = left.manual || (left.minPassengers ?? 0) > flight.bookedPassengers;
        const rightDeferred = right.manual || (right.minPassengers ?? 0) > flight.bookedPassengers;
        if (leftDeferred !== rightDeferred) return leftDeferred ? 1 : -1;
        const leftCount = eligibleCounts.get(leftKey) ?? Number.MAX_SAFE_INTEGER;
        const rightCount = eligibleCounts.get(rightKey) ?? Number.MAX_SAFE_INTEGER;
        return leftCount - rightCount || (displayIndex.get(left.id) ?? 0) - (displayIndex.get(right.id) ?? 0);
      })
      .concat(displayRules.filter((rule) => rule.category === "引导"))
      .concat(displayRules.filter((rule) => rule.category === "行政支援"));

    for (const rule of processingRules) {
      const taskKey = `${flight.id}:${rule.id}`;
      if (processedTasks.has(taskKey)) continue;
      const ke166MobileSupervisor = isKe166MobileSupervisor(flight, rule);
      if (rule.category === "行政支援") {
        assignments.push({ ...makeUnfilled(flight, rule.name, rule), status: "manual" });
        continue;
      }
      if (!ke166MobileSupervisor && (rule.minPassengers ?? 0) > flight.bookedPassengers) {
        assignments.push({ ...makeUnfilled(flight, rule.name, rule), status: "manual" });
        continue;
      }
      if (rule.category === "引导") {
        const usedReusableStaff = new Set(assignments
          .filter((item) => item.flightId === flight.id && assignmentRule(state, item)?.category === rule.category)
          .map((item) => item.staffId)
          .filter((staffId): staffId is string => Boolean(staffId)));
        const reusedCandidates = assignments
          .filter((item) => item.flightId === flight.id && item.staffId && item.status === "assigned" && !usedReusableStaff.has(item.staffId))
          .map((item) => ({ assignment: item, sourceRule: assignmentRule(state, item), person: state.staff.find((person) => person.id === item.staffId) }))
          .filter((item): item is typeof item & { person: Staff } => Boolean(
            item.sourceRule?.category === "常规"
            && item.person?.status === "正常"
            && item.person.staffType === "常规"
          ))
          .sort((left, right) => (displayIndex.get(right.assignment.positionRuleId ?? "") ?? -1)
            - (displayIndex.get(left.assignment.positionRuleId ?? "") ?? -1));
        const selected = reusedCandidates[0]?.person;
        if (!selected) {
          assignments.push({ ...makeUnfilled(flight, rule.name, rule), workHours: 0 });
          warnings.push(`${flight.flightNo} / ${rule.name} 没有可复用的常规岗位人员`);
        } else {
          assignments.push({
            id: createId("assignment"), flightId: flight.id, flightNo: flight.flightNo, positionRuleId: rule.id,
            position: rule.name, staffId: selected.id, staffName: selected.name, startTime: flight.startTime, endTime: flight.endTime,
            workHours: 0, fatiguePoints: rule.fatiguePoints, remark: rule.remark, manualRemark: "", status: "assigned"
          });
        }
        continue;
      }
      if (rule.manual && !ke166MobileSupervisor) {
        assignments.push(makeUnfilled(flight, rule.name, rule));
        continue;
      }
      scheduleTask({ key: taskKey, flight, rule }, false);
    }
  }

  compactRegularAssignments(state, assignments);

  assignments.filter((assignment) => assignment.status === "assigned" && assignment.staffId && isPreNoonFlight(assignment)).forEach((assignment) => {
    const rule = assignmentRule(state, assignment);
    const flight = state.flights.find((item) => item.id === assignment.flightId);
    const person = state.staff.find((item) => item.id === assignment.staffId);
    if (!rule || rule.category !== "常规" || !flight || !person) return;
    const preserved = (assignment.systemNotes ?? []).filter((note) => !note.startsWith("已突破严格限制仍安排："));
    const strictNotes = strictOverrideNotes(
      state,
      assignments.filter((item) => item.id !== assignment.id),
      person,
      { key: `${flight.id}:${rule.id}`, flight, rule },
      date
    );
    assignment.systemNotes = [...preserved, ...strictNotes];
    if (!assignment.systemNotes.length) delete assignment.systemNotes;
  });

  warnings.length = 0;
  assignments.forEach((assignment) => {
    if (assignment.systemNotes?.length) {
      warnings.push(...assignment.systemNotes.map((note) => `${assignment.flightNo} / ${assignment.position} ${note}`));
      return;
    }
    if (assignment.status !== "unfilled") return;
    const category = assignmentRule(state, assignment)?.category;
    warnings.push(`${assignment.flightNo} / ${assignment.position} ${category === "引导" ? "没有可复用的常规岗位人员" : "无可用人员"}`);
  });

  const flightOrder = new Map(flights.map((flight, index) => [flight.id, index]));
  assignments.sort((left, right) => (flightOrder.get(left.flightId) ?? flights.length) - (flightOrder.get(right.flightId) ?? flights.length)
    || ((displayRulesByFlight.get(left.flightId)?.findIndex((rule) => rule.id === left.positionRuleId) ?? -1) + 1 || Number.MAX_SAFE_INTEGER)
      - ((displayRulesByFlight.get(right.flightId)?.findIndex((rule) => rule.id === right.positionRuleId) ?? -1) + 1 || Number.MAX_SAFE_INTEGER));

  return {
    assignments,
    unfilledCount: assignments.filter((assignment) => assignment.status === "unfilled").length,
    warnings: [...new Set(warnings)]
  };
}

export function canAssignStaff(state: AppState, assignmentId: string, staffId: string, ignoreAssignmentId?: string): string | null {
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  const person = state.staff.find((item) => item.id === staffId);
  if (!assignment || !person) return "人员或岗位不存在";
  if (person.status !== "正常") return `${person.name} 当前状态为${person.status}`;
  const rule = assignment.positionRuleId
    ? state.positionRules.find((item) => item.id === assignment.positionRuleId)
    : undefined;
  const administrativeStaff = person.staffType === "行政支援";
  if (administrativeStaff && !state.settings.adminSupportEnabled) return "行政支援模式尚未启用";
  if (administrativeStaff && (!rule || !rule.qualifiedStaffIds.includes(person.id))) return `${person.name} 不具备该岗位资质`;
  if (rule && rule.category !== "引导" && !rule.manual && !rule.qualifiedStaffIds.includes(person.id)) return `${person.name} 不具备该岗位资质`;
  if (administrativeStaff && rule) {
    const flight = state.flights.find((item) => item.id === assignment.flightId);
    const otherAssignments = state.assignments.filter((item) => item.id !== assignmentId);
    const regularAvailable = flight && eligibleStaffForRule(state, flight, rule).some((regular) => {
      const conflicts = otherAssignments.filter((item) => item.staffId === regular.id)
        .filter((item) => item.flightId !== assignment.flightId || !isReusableAssignment(state, item));
      return conflicts.every((item) => !intervalsOverlap(item.startTime, item.endTime, flight.startTime, flight.endTime) || canReleaseForFlight(item, flight, state))
        && projectedAssignedHours(otherAssignments, regular.id, flight, state) + assignment.workHours <= state.settings.maxDailyHours
        && positionTransitionCost(otherAssignments, regular.id, assignment.flightNo, assignment.position, assignment.startTime, state, "forbid") === 0;
    });
    if (regularAvailable) return "仍有满足硬约束的常规人员可用，应优先安排常规人员";
  }
  if (isNightInterval(assignment.startTime, assignment.endTime, state.settings.nightStart, state.settings.nightEnd) && !person.nightShift) {
    return `${person.name} 不可上夜班`;
  }
  const reuse = rule?.category === "引导";
  const others = state.assignments.filter((item) => item.id !== assignmentId && (reuse || item.id !== ignoreAssignmentId) && item.staffId === staffId);
  if (reuse) {
    if (person.staffType !== "常规") return "引导岗位只能复用常规人员";
    const source = others.find((item) => item.flightId === assignment.flightId && item.status === "assigned"
      && assignmentRule(state, item)?.category === "常规");
    if (!source) return `${person.name} 未在该航班承担常规岗位`;
  }
  const conflicts = reuse
    ? others.filter((item) => item.flightId !== assignment.flightId)
    : others.filter((item) => item.flightId !== assignment.flightId || !isReusableAssignment(state, item));
  if (conflicts.some((item) => intervalsOverlap(item.startTime, item.endTime, assignment.startTime, assignment.endTime) && !canReleaseForFlight(item, assignment, state))) {
    return `${person.name} 在该时段已有排班`;
  }
  if (projectedAssignedHours(others, staffId, assignment, state) + assignment.workHours > state.settings.maxDailyHours) {
    return `${person.name} 将超过每日 ${state.settings.maxDailyHours} 小时上限`;
  }
  if (positionTransitionCost(others, staffId, assignment.flightNo, assignment.position, assignment.startTime, state, "forbid") > 0) {
    return `${person.name} 不满足该岗位的最小衔接间隔`;
  }
  return null;
}

export function applyEarlyReleaseForStaff(state: AppState, assignmentId: string, staffId: string): void {
  const assignment = state.assignments.find((item) => item.id === assignmentId);
  if (!assignment) return;
  const others = state.assignments.filter((item) => item.id !== assignmentId);
  applyEarlyReleases(others, staffId, assignment, state);
}

export function isDiversionTransfer(state: AppState, sourceAssignmentId: string, targetAssignmentId: string): boolean {
  const source = state.assignments.find((item) => item.id === sourceAssignmentId);
  const target = state.assignments.find((item) => item.id === targetAssignmentId);
  return Boolean(source && target && canReleaseForFlight(source, target, state));
}
