import type { AppState, Assignment, Flight, PositionRule, ScheduleResult, Staff } from "../model";
import { createId } from "../utils";
import { getDutyRosterForDate } from "./duty-roster";
import { historyFatigue, recentHistory } from "./fatigue";
import { durationHours, intervalsOverlap, isNightInterval, timeToMinutes } from "./time";
import { analyzeWorkloadPressure, workloadBalanceCost } from "./workload-balance";

export function isAuxiliaryCategory(category: PositionRule["category"] | undefined): boolean {
  return category === "行政支援";
}

export function isFixedBottomPosition(position: string): boolean {
  return position.includes("引导") && !position.includes("督导");
}

function isSupervisorPosition(position: string): boolean {
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
  nextFatiguePoints: number,
  nextRemark: string,
  state: AppState
): boolean {
  if (!state.settings.highLoadProtectionEnabled || !isHighLoadPosition(nextFatiguePoints, nextRemark, state)) return false;
  return assignments.some((assignment) => {
    if (assignment.staffId !== staffId || assignment.status !== "assigned" || !isHighLoadPosition(assignment.fatiguePoints, assignment.remark, state)) return false;
    const gap = recoveryGapMinutes(assignment, nextStartTime);
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
    })).length;
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

export function dutyLatePositionPriority(position: string, remark: string): number {
  const value = `${position} ${remark}`;
  if (value.includes("一号")) return 0;
  if (isSupervisorPosition(position)) return 1;
  if (value.includes("申报")) return 2;
  if (value.includes("送资料")) return 3;
  return 4;
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

function preferredDutyLateTask(state: AppState, date: string, tasks: AssignmentTask[]): AssignmentTask | undefined {
  const dutyStaffId = getDutyRosterForDate(state, date).dutyStaffId;
  if (!dutyStaffId || !tasks.length) return undefined;
  const latestStarts = [...new Set(state.flights.map((flight) => operationalStartMinutes(flight.startTime, state)))]
    .sort((left, right) => right - left)
    .slice(0, 2);
  for (const start of latestStarts) {
    const target = tasks
      .filter((task) => operationalStartMinutes(task.flight.startTime, state) === start)
      .filter((task) => dutyLatePositionPriority(task.rule.name, task.rule.remark) < 4)
      .filter((task) => durationHours(task.flight.startTime, task.flight.endTime) <= state.settings.maxDailyHours)
      .filter((task) => eligibleStaffForRule(state, task.flight, task.rule).some((person) => person.id === dutyStaffId))
      .filter((task) => state.settings.positionRotationMode !== "forbid"
        || positionRotationCost(state, dutyStaffId, task.flight.flightNo, task.rule.name, date) === 0)
      .filter((task) => state.settings.lateShiftRecoveryMode !== "forbid"
        || lateShiftRecoveryRisk(state, dutyStaffId, task.flight, task.rule.fatiguePoints, date).excess === 0)
      .sort((left, right) => dutyLatePositionPriority(left.rule.name, left.rule.remark)
        - dutyLatePositionPriority(right.rule.name, right.rule.remark))[0];
    if (target) return target;
  }
  return undefined;
}

function preferredDutyMorningTask(state: AppState, date: string, tasks: AssignmentTask[]): AssignmentTask | undefined {
  const dutyStaffId = getDutyRosterForDate(state, date).dutyStaffId;
  if (!dutyStaffId) return undefined;
  return tasks
    .filter((task) => isDutyMorningFlight(task.flight, state))
    .filter((task) => durationHours(task.flight.startTime, task.flight.endTime) <= state.settings.maxDailyHours)
    .filter((task) => eligibleStaffForRule(state, task.flight, task.rule).some((person) => person.id === dutyStaffId))
    .filter((task) => state.settings.positionRotationMode !== "forbid"
      || positionRotationCost(state, dutyStaffId, task.flight.flightNo, task.rule.name, date) === 0)
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
    .sort((left, right) => Number(isSupervisorPosition(right.rule.name)) - Number(isSupervisorPosition(left.rule.name)) || left.index - right.index)
    .map(({ rule }) => rule);
  return [...orderedPrimary, ...fixedBottom];
}

export function activeFlightPositions(state: AppState, flight: Flight): string[] {
  return activeFlightRules(state, flight).map((rule) => rule.name);
}

export function generateSchedule(state: AppState, date: string): ScheduleResult {
  const assignments: Assignment[] = [];
  const warnings: string[] = [];

  const flights = [...state.flights].sort((left, right) => left.startTime.localeCompare(right.startTime));
  const tasks: AssignmentTask[] = flights.flatMap((flight) => activeFlightRules(state, flight)
    .filter((rule) => rule.category !== "引导" && rule.category !== "行政支援" && !rule.manual)
    .filter((rule) => (rule.minPassengers ?? 0) <= flight.bookedPassengers)
    .map((rule) => ({ key: `${flight.id}:${rule.id}`, flight, rule })));
  const eligibleStaffIds = new Map(tasks.map((task) => [task.key, new Set(eligibleStaffForRule(state, task.flight, task.rule).map((person) => person.id))]));
  const eligibleCounts = new Map(tasks.map((task) => [task.key, eligibleStaffIds.get(task.key)?.size ?? 0]));
  const workloadPressure = analyzeWorkloadPressure(state);
  const dutyStaffId = getDutyRosterForDate(state, date).dutyStaffId;
  const preferredDutyMorningTaskKey = preferredDutyMorningTask(state, date, tasks)?.key ?? null;
  const preferredDutyLateTaskKey = preferredDutyLateTask(state, date, tasks)?.key ?? null;
  const dutyTargetTaskKeys = new Set([preferredDutyMorningTaskKey, preferredDutyLateTaskKey].filter((key): key is string => Boolean(key)));
  const processedTasks = new Set<string>();

  for (const flight of flights) {
    const displayRules = activeFlightRules(state, flight);
    const displayIndex = new Map(displayRules.map((rule, index) => [rule.id, index]));
    const processingRules = displayRules
      .filter((rule) => rule.category !== "引导" && rule.category !== "行政支援")
      .sort((left, right) => {
        const leftKey = `${flight.id}:${left.id}`;
        const rightKey = `${flight.id}:${right.id}`;
        if (dutyTargetTaskKeys.has(leftKey) || dutyTargetTaskKeys.has(rightKey)) return dutyTargetTaskKeys.has(leftKey) ? -1 : 1;
        const leftDeferred = left.manual || (left.minPassengers ?? 0) > flight.bookedPassengers;
        const rightDeferred = right.manual || (right.minPassengers ?? 0) > flight.bookedPassengers;
        if (leftDeferred !== rightDeferred) return leftDeferred ? 1 : -1;
        const leftCount = eligibleCounts.get(`${flight.id}:${left.id}`) ?? Number.MAX_SAFE_INTEGER;
        const rightCount = eligibleCounts.get(`${flight.id}:${right.id}`) ?? Number.MAX_SAFE_INTEGER;
        return leftCount - rightCount || (displayIndex.get(left.id) ?? 0) - (displayIndex.get(right.id) ?? 0);
      })
      .concat(displayRules.filter((rule) => rule.category === "引导"))
      .concat(displayRules.filter((rule) => rule.category === "行政支援"));
    const flightAssignmentStart = assignments.length;
    for (const rule of processingRules) {
      const position = rule.name;
      const taskKey = `${flight.id}:${rule.id}`;
      processedTasks.add(taskKey);
      if (rule.category === "行政支援") {
        assignments.push({ ...makeUnfilled(flight, position, rule), status: "manual" });
        continue;
      }
      if ((rule.minPassengers ?? 0) > flight.bookedPassengers) {
        assignments.push({ ...makeUnfilled(flight, position, rule), status: "manual" });
        continue;
      }
      const hours = durationHours(flight.startTime, flight.endTime);
      if (rule.category === "引导") {
        const usedGuideStaff = new Set(assignments
          .filter((item) => item.flightId === flight.id && isGuideAssignment(state, item))
          .map((item) => item.staffId)
          .filter((staffId): staffId is string => Boolean(staffId)));
        const reusedCandidates = assignments
          .filter((item) => item.flightId === flight.id && item.staffId && item.status === "assigned" && !usedGuideStaff.has(item.staffId))
          .map((item) => ({
            assignment: item,
            sourceRule: assignmentRule(state, item),
            person: state.staff.find((person) => person.id === item.staffId)
          }))
          .filter((item): item is typeof item & { person: Staff } => Boolean(
            item.sourceRule?.category === "常规"
            && item.person?.status === "正常"
            && item.person.staffType === "常规"
          ))
          .sort((left, right) => (displayIndex.get(right.assignment.positionRuleId ?? "") ?? -1)
            - (displayIndex.get(left.assignment.positionRuleId ?? "") ?? -1));
        const selected = reusedCandidates[0]?.person;
        if (!selected) {
          assignments.push({ ...makeUnfilled(flight, position, rule), workHours: 0 });
          warnings.push(`${flight.flightNo} / ${position} 没有可复用的常规岗位人员`);
        } else {
          assignments.push({
            id: createId("assignment"), flightId: flight.id, flightNo: flight.flightNo, positionRuleId: rule.id,
            position, staffId: selected.id, staffName: selected.name, startTime: flight.startTime, endTime: flight.endTime,
            workHours: 0, fatiguePoints: rule.fatiguePoints, remark: rule.remark, manualRemark: "", status: "assigned"
          });
        }
        continue;
      }
      if (rule.manual) {
        assignments.push(makeUnfilled(flight, position, rule));
        continue;
      }
      const reserveDutyForTarget = Boolean(dutyStaffId
        && !dutyTargetTaskKeys.has(taskKey)
        && [...dutyTargetTaskKeys].some((targetKey) => !processedTasks.has(targetKey)));
      let candidates = eligibleStaffForRule(state, flight, rule)
        .filter((person) => !reserveDutyForTarget || person.id !== dutyStaffId)
        .filter((person) => staffConflicts(assignments, person.id, flight).every((assignment) => canReleaseForFlight(assignment, flight, state)))
        .filter((person) => projectedAssignedHours(assignments, person.id, flight, state) + hours <= state.settings.maxDailyHours);
      if (state.settings.highLoadTransitionMode === "forbid") {
        candidates = candidates.filter((person) => !hasHighLoadTransition(assignments, person.id, flight.startTime, rule.fatiguePoints, rule.remark, state));
      }
      candidates = candidates.filter((person) => positionTransitionCost(assignments, person.id, flight.flightNo, rule.name, flight.startTime, state, "forbid") === 0);
      if (state.settings.rollingLoadMode === "forbid") {
        candidates = candidates.filter((person) => rollingLoadCost(assignments, person.id, flight.startTime, rule.fatiguePoints, rule.remark, state) === 0);
      }
      if (state.settings.positionRotationMode === "forbid") {
        candidates = candidates.filter((person) => positionRotationCost(state, person.id, flight.flightNo, rule.name, date) === 0);
      }
      if (state.settings.lateShiftRecoveryMode === "forbid") {
        candidates = candidates.filter((person) => lateShiftRecoveryRisk(state, person.id, flight, rule.fatiguePoints, date).excess === 0);
      }
      candidates.sort((left, right) => dutyAssignmentCost(left.id, taskKey, dutyStaffId, dutyTargetTaskKeys)
        - dutyAssignmentCost(right.id, taskKey, dutyStaffId, dutyTargetTaskKeys)
        || positionTransitionCost(assignments, left.id, flight.flightNo, rule.name, flight.startTime, state, "prefer")
        - positionTransitionCost(assignments, right.id, flight.flightNo, rule.name, flight.startTime, state, "prefer")
        || (state.settings.lateShiftRecoveryMode === "prefer"
          ? lateShiftRecoveryCost(state, left.id, flight, rule.fatiguePoints, date)
            - lateShiftRecoveryCost(state, right.id, flight, rule.fatiguePoints, date)
          : 0)
        || (state.settings.rollingLoadMode === "prefer"
          ? rollingLoadCost(assignments, left.id, flight.startTime, rule.fatiguePoints, rule.remark, state)
            - rollingLoadCost(assignments, right.id, flight.startTime, rule.fatiguePoints, rule.remark, state)
          : 0)
        || (state.settings.positionRotationMode === "prefer"
          ? positionRotationCost(state, left.id, flight.flightNo, rule.name, date)
            - positionRotationCost(state, right.id, flight.flightNo, rule.name, date)
          : 0)
        || (state.settings.highLoadTransitionMode === "prefer"
        ? Number(hasHighLoadTransition(assignments, left.id, flight.startTime, rule.fatiguePoints, rule.remark, state))
          - Number(hasHighLoadTransition(assignments, right.id, flight.startTime, rule.fatiguePoints, rule.remark, state))
        : 0)
          || Number(assignments.some((item) => item.staffId === left.id && item.workHours > 0))
            - Number(assignments.some((item) => item.staffId === right.id && item.workHours > 0))
          || reservationCost(left, flight, tasks, processedTasks, eligibleCounts, eligibleStaffIds) - reservationCost(right, flight, tasks, processedTasks, eligibleCounts, eligibleStaffIds)
          || workloadBalanceCost(left, assignments, state, hours, dutyStaffId, date, workloadPressure)
            - workloadBalanceCost(right, assignments, state, hours, dutyStaffId, date, workloadPressure)
          || candidateScore(left, assignments, state, date) - candidateScore(right, assignments, state, date)
          || left.id.localeCompare(right.id, undefined, { numeric: true }));

      const selected = candidates[0];
      if (!selected) {
        assignments.push(makeUnfilled(flight, position, rule));
        warnings.push(`${flight.flightNo} / ${position} 无可用人员`);
        continue;
      }

      applyEarlyReleases(assignments, selected.id, flight, state);

      assignments.push({
        id: createId("assignment"),
        flightId: flight.id,
        flightNo: flight.flightNo,
        positionRuleId: rule.id,
        position,
        staffId: selected.id,
        staffName: selected.name,
        startTime: flight.startTime,
        endTime: flight.endTime,
        workHours: hours,
        fatiguePoints: rule.fatiguePoints,
        remark: rule.remark,
        manualRemark: "",
        status: "assigned"
      });
    }

    const sortedFlightAssignments = assignments.splice(flightAssignmentStart);
    sortedFlightAssignments.sort((left, right) => {
      const leftIndex = displayRules.findIndex((rule) => rule.id === left.positionRuleId);
      const rightIndex = displayRules.findIndex((rule) => rule.id === right.positionRuleId);
      return (leftIndex < 0 ? displayRules.length : leftIndex) - (rightIndex < 0 ? displayRules.length : rightIndex);
    });
    assignments.push(...sortedFlightAssignments);
  }

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
  if (rule && rule.category !== "引导" && !administrativeStaff && !rule.manual && !rule.qualifiedStaffIds.includes(person.id)) return `${person.name} 不具备该岗位资质`;
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
    : others.filter((item) => item.flightId !== assignment.flightId || !isGuideAssignment(state, item));
  if (conflicts.some((item) => intervalsOverlap(item.startTime, item.endTime, assignment.startTime, assignment.endTime) && !canReleaseForFlight(item, assignment, state))) {
    return `${person.name} 在该时段已有排班`;
  }
  if (projectedAssignedHours(others, staffId, assignment, state) + assignment.workHours > state.settings.maxDailyHours) {
    return `${person.name} 将超过每日 ${state.settings.maxDailyHours} 小时上限`;
  }
  if (state.settings.highLoadTransitionMode === "forbid"
    && hasHighLoadTransition(others, staffId, assignment.startTime, assignment.fatiguePoints, assignment.remark, state)) {
    return `${person.name} 尚处于高负荷岗位恢复期`;
  }
  if (positionTransitionCost(others, staffId, assignment.flightNo, assignment.position, assignment.startTime, state, "forbid") > 0) {
    return `${person.name} 不满足该岗位的最小衔接间隔`;
  }
  if (state.settings.rollingLoadMode === "forbid"
    && rollingLoadCost(others, staffId, assignment.startTime, assignment.fatiguePoints, assignment.remark, state) > 0) {
    return `${person.name} 将超过滚动时间窗口的疲劳上限`;
  }
  if (state.settings.positionRotationMode === "forbid"
    && positionRotationCost(state, staffId, assignment.flightNo, assignment.position, state.activeScheduleDate) > 0) {
    return `${person.name} 在轮换回看期内已承担过该岗位`;
  }
  if (state.settings.lateShiftRecoveryMode === "forbid"
    && lateShiftRecoveryRisk(state, staffId, assignment, assignment.fatiguePoints, state.activeScheduleDate).excess > 0) {
    return `${person.name} 最近工作日最后一批晚班承担过高负荷岗位，本次岗位超过下个工作日晚班负荷上限`;
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
