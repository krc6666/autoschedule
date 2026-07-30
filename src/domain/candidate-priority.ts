import type { AppState, Assignment, Staff } from "../model";
import type { SchedulingRuleId } from "../schedule-rule-contract";
import {
  priorityPositionScarceQualification,
  scarceQualificationPriority,
  type ScarceQualificationPriority,
} from "./candidate-qualification";
import {
  dutyPositionPriority,
  type DutyPositionDisposition,
} from "./duty-assignment";
import { isNextDutyRestConflict } from "./next-duty-rest";
import { previousWorkdayLoadForStaff } from "./previous-workday-load";
import {
  consecutivePositionAssignments,
  positionFrequencyProfileForRule,
} from "./schedule-frequency";
import {
  hasHighLoadTransition,
  lateShiftCutoffPriority,
  lateShiftRecoveryPriority,
  positionTransitionInsertionCost,
  rollingLoadCost,
  totalFatiguePriority,
  type LateShiftCutoffPriority,
  type LateShiftRecoveryPriority,
} from "./schedule-protection";
import type { ScheduleRunFacts } from "./schedule-run-facts";
import type { AssignmentTask } from "./schedule-tasks";
import {
  isHighFatigueOrdinaryRotationPosition,
  isPriorityRotationPosition,
} from "./position-rotation-policy";
import { timeToMinutes } from "./time";
import { workloadBalancePriority } from "./workload-balance";

export const CANDIDATE_PRIORITY_ORDER = [
  "duty-position",
  "scarce-qualification",
  "position-transition",
  "next-duty-rest",
  "late-shift-recovery",
  "late-shift-cutoff",
  "priority-position-consecutive",
  "high-fatigue-position-consecutive",
  "same-day-late-obligation",
  "preferred-position-transition",
  "staff-coverage",
  "rolling-load",
  "high-load-recovery",
  "cross-workday-load",
  "position-frequency",
  "workload-balance",
  "historical-fatigue",
  "staff-id",
] as const satisfies readonly SchedulingRuleId[];

export type CandidatePriorityId = (typeof CANDIDATE_PRIORITY_ORDER)[number];

export interface CandidatePriority {
  dutyPosition: DutyPositionDisposition;
  strictTransitionViolations: number;
  preferredTransitionViolations: number;
  scarceQualification: ScarceQualificationPriority;
  alreadyAssignedToday: boolean;
  nextDutyRestConflict: boolean;
  lateShiftRecovery: LateShiftRecoveryPriority;
  lateShiftCutoff: LateShiftCutoffPriority;
  repeatedPriorityPosition: boolean;
  repeatedHighFatiguePosition: boolean;
  unavoidableLaterTask: boolean;
  rollingLoadExcess: number;
  highLoadRecoveryConflict: boolean;
  previousWorkdayLoad: import("./previous-workday-load-model").PreviousWorkdayLoad;
  positionFrequency: {
    currentMonthCount: number;
    recentWorkdayCount: number;
  };
  workloadBalance: {
    violatesConfiguredTarget: boolean;
    todayHoursExcess: number;
    rollingHoursExcess: number;
    todayFatigueExcess: number;
    todayHoursSpread: number;
    rollingHoursSpread: number;
    todayFatigueSpread: number;
  };
  historicalFatigue: number;
  staffOrder: number;
}

function compareNumber(left: number, right: number): number {
  return left - right;
}

const DUTY_POSITION_ORDER: Readonly<
  Record<CandidatePriority["dutyPosition"], number>
> = {
  "reserved-target": 0,
  unrelated: 1,
  "reserved-elsewhere": 2,
};

function compareScarceQualification(
  left: CandidatePriority,
  right: CandidatePriority
): number {
  const leftHasFutureTask = left.scarceQualification.futureTaskCount > 0;
  const rightHasFutureTask = right.scarceQualification.futureTaskCount > 0;
  if (leftHasFutureTask !== rightHasFutureTask)
    return Number(leftHasFutureTask) - Number(rightHasFutureTask);
  if (!leftHasFutureTask) return 0;
  const minimumEligibleDifference =
    (right.scarceQualification.minimumEligibleStaff ?? 0) -
    (left.scarceQualification.minimumEligibleStaff ?? 0);
  return (
    minimumEligibleDifference ||
    left.scarceQualification.futureTaskCount -
      right.scarceQualification.futureTaskCount
  );
}

function compareLateShiftRecovery(
  left: CandidatePriority,
  right: CandidatePriority
): number {
  return (
    Number(left.lateShiftRecovery.protectedMorningTarget) -
      Number(right.lateShiftRecovery.protectedMorningTarget) ||
    Number(left.lateShiftRecovery.protectedLatePriorityTarget) -
      Number(right.lateShiftRecovery.protectedLatePriorityTarget)
  );
}

const CUTOFF_DISPOSITION_ORDER: Readonly<
  Record<CandidatePriority["lateShiftCutoff"]["disposition"], number>
> = {
  "before-cutoff": 0,
  unprotected: 1,
  "after-cutoff": 2,
};

function compareLateShiftCutoff(
  left: CandidatePriority,
  right: CandidatePriority
): number {
  const disposition =
    CUTOFF_DISPOSITION_ORDER[left.lateShiftCutoff.disposition] -
    CUTOFF_DISPOSITION_ORDER[right.lateShiftCutoff.disposition];
  if (disposition) return disposition;
  const leftCutoff = left.lateShiftCutoff.cutoffMinutes ?? 0;
  const rightCutoff = right.lateShiftCutoff.cutoffMinutes ?? 0;
  const leftPreviousEnd = left.lateShiftCutoff.previousEndMinutes ?? 0;
  const rightPreviousEnd = right.lateShiftCutoff.previousEndMinutes ?? 0;
  if (left.lateShiftCutoff.disposition === "before-cutoff") {
    return leftCutoff - rightCutoff || rightPreviousEnd - leftPreviousEnd;
  }
  if (left.lateShiftCutoff.disposition === "after-cutoff") {
    return rightCutoff - leftCutoff || leftPreviousEnd - rightPreviousEnd;
  }
  return 0;
}

function compareWorkloadBalance(
  left: CandidatePriority,
  right: CandidatePriority
): number {
  return (
    Number(left.workloadBalance.violatesConfiguredTarget) -
      Number(right.workloadBalance.violatesConfiguredTarget) ||
    left.workloadBalance.todayHoursExcess -
      right.workloadBalance.todayHoursExcess ||
    left.workloadBalance.rollingHoursExcess -
      right.workloadBalance.rollingHoursExcess ||
    left.workloadBalance.todayFatigueExcess -
      right.workloadBalance.todayFatigueExcess ||
    left.workloadBalance.todayHoursSpread -
      right.workloadBalance.todayHoursSpread ||
    left.workloadBalance.rollingHoursSpread -
      right.workloadBalance.rollingHoursSpread ||
    left.workloadBalance.todayFatigueSpread -
      right.workloadBalance.todayFatigueSpread
  );
}

function comparePositionFrequency(
  left: CandidatePriority,
  right: CandidatePriority
): number {
  return (
    compareNumber(
      left.positionFrequency.currentMonthCount,
      right.positionFrequency.currentMonthCount
    ) ||
    compareNumber(
      left.positionFrequency.recentWorkdayCount,
      right.positionFrequency.recentWorkdayCount
    )
  );
}

function comparePreviousWorkdayLoad(
  left: CandidatePriority,
  right: CandidatePriority
): number {
  return (
    left.previousWorkdayLoad.fatiguePoints -
      right.previousWorkdayLoad.fatiguePoints ||
    left.previousWorkdayLoad.latestEndMinutes -
      right.previousWorkdayLoad.latestEndMinutes ||
    left.previousWorkdayLoad.workHours - right.previousWorkdayLoad.workHours ||
    left.previousWorkdayLoad.priorityPositionCount -
      right.previousWorkdayLoad.priorityPositionCount
  );
}

const CANDIDATE_PRIORITY_COMPARATORS: Readonly<
  Record<
    CandidatePriorityId,
    (left: CandidatePriority, right: CandidatePriority) => number
  >
> = {
  "duty-position": (left, right) =>
    compareNumber(
      DUTY_POSITION_ORDER[left.dutyPosition],
      DUTY_POSITION_ORDER[right.dutyPosition]
    ),
  "position-transition": (left, right) =>
    compareNumber(
      left.strictTransitionViolations,
      right.strictTransitionViolations
    ),
  "next-duty-rest": (left, right) =>
    Number(left.nextDutyRestConflict) - Number(right.nextDutyRestConflict),
  "preferred-position-transition": (left, right) =>
    compareNumber(
      left.preferredTransitionViolations,
      right.preferredTransitionViolations
    ),
  "scarce-qualification": compareScarceQualification,
  "staff-coverage": (left, right) =>
    Number(left.alreadyAssignedToday) - Number(right.alreadyAssignedToday),
  "late-shift-recovery": compareLateShiftRecovery,
  "late-shift-cutoff": compareLateShiftCutoff,
  "priority-position-consecutive": (left, right) =>
    Number(left.repeatedPriorityPosition) -
    Number(right.repeatedPriorityPosition),
  "high-fatigue-position-consecutive": (left, right) =>
    Number(left.repeatedHighFatiguePosition) -
    Number(right.repeatedHighFatiguePosition),
  "same-day-late-obligation": (left, right) =>
    Number(left.unavoidableLaterTask) - Number(right.unavoidableLaterTask),
  "rolling-load": (left, right) =>
    compareNumber(left.rollingLoadExcess, right.rollingLoadExcess),
  "high-load-recovery": (left, right) =>
    Number(left.highLoadRecoveryConflict) -
    Number(right.highLoadRecoveryConflict),
  "cross-workday-load": comparePreviousWorkdayLoad,
  "position-frequency": comparePositionFrequency,
  "workload-balance": compareWorkloadBalance,
  "historical-fatigue": (left, right) =>
    compareNumber(left.historicalFatigue, right.historicalFatigue),
  "staff-id": (left, right) => compareNumber(left.staffOrder, right.staffOrder),
};

export function firstDifferentCandidateRule(
  left: CandidatePriority,
  right: CandidatePriority
): CandidatePriorityId | null {
  return (
    CANDIDATE_PRIORITY_ORDER.find(
      (ruleId) => CANDIDATE_PRIORITY_COMPARATORS[ruleId](left, right) !== 0
    ) ?? null
  );
}

export function compareCandidatePriority(
  left: CandidatePriority,
  right: CandidatePriority
): number {
  for (const ruleId of CANDIDATE_PRIORITY_ORDER) {
    const difference = CANDIDATE_PRIORITY_COMPARATORS[ruleId](left, right);
    if (difference) return difference;
  }
  return 0;
}

export interface CandidatePriorityContext {
  state: AppState;
  assignments: Assignment[];
  tasks: AssignmentTask[];
  processedTasks: Set<string>;
  eligibleStaffIds: Map<string, Set<string>>;
  eligibleCounts: Map<string, number>;
  runFacts: ScheduleRunFacts;
  date: string;
  dutyStaffId: string | null;
  task: AssignmentTask;
  hours: number;
  isDutyTarget: boolean;
  reserveDutyForPendingTarget: boolean;
  currentDutyTargetTaskKeys: ReadonlySet<string>;
}

export function buildCandidatePriority(
  context: CandidatePriorityContext,
  person: Staff
): CandidatePriority {
  const {
    state,
    assignments,
    tasks,
    processedTasks,
    eligibleStaffIds,
    eligibleCounts,
    runFacts,
    date,
    dutyStaffId,
    task,
    hours,
    isDutyTarget,
    reserveDutyForPendingTarget,
    currentDutyTargetTaskKeys,
  } = context;
  const { flight, rule, key: taskKey } = task;
  const operationalMinutes = (value: string): number => {
    const minutes = timeToMinutes(value);
    return minutes < timeToMinutes(state.settings.nightEnd)
      ? minutes + 24 * 60
      : minutes;
  };
  return {
    dutyPosition:
      isDutyTarget || reserveDutyForPendingTarget
        ? dutyPositionPriority(
            person.id,
            taskKey,
            dutyStaffId,
            currentDutyTargetTaskKeys
          )
        : "unrelated",
    strictTransitionViolations: positionTransitionInsertionCost(
      assignments,
      person.id,
      task,
      state,
      "forbid"
    ),
    preferredTransitionViolations: positionTransitionInsertionCost(
      assignments,
      person.id,
      task,
      state,
      "prefer"
    ),
    scarceQualification: isPriorityRotationPosition(rule)
      ? priorityPositionScarceQualification(
          person,
          task,
          state,
          assignments,
          tasks,
          processedTasks,
          eligibleCounts,
          eligibleStaffIds
        )
      : scarceQualificationPriority(
          person,
          flight,
          tasks,
          processedTasks,
          eligibleCounts,
          eligibleStaffIds
        ),
    alreadyAssignedToday: assignments.some(
      (item) => item.staffId === person.id && item.workHours > 0
    ),
    nextDutyRestConflict: isNextDutyRestConflict(
      state,
      person.id,
      rule,
      date,
      runFacts.nextDutyRest
    ),
    lateShiftRecovery: lateShiftRecoveryPriority(
      state,
      person.id,
      {
        ...flight,
        position: rule.name,
        remark: rule.remark,
        fatiguePoints: rule.fatiguePoints,
      },
      date,
      runFacts.crossDayRecovery
    ),
    lateShiftCutoff: lateShiftCutoffPriority(
      state,
      person.id,
      flight,
      date,
      runFacts.crossDayRecovery
    ),
    repeatedPriorityPosition:
      isPriorityRotationPosition(rule) &&
      consecutivePositionAssignments(
        state,
        person.id,
        flight.flightNo,
        rule.name,
        date,
        runFacts.scheduleFrequency
      ) > 0,
    repeatedHighFatiguePosition:
      isHighFatigueOrdinaryRotationPosition(
        rule,
        state.settings.highLoadFatigueThreshold
      ) &&
      consecutivePositionAssignments(
        state,
        person.id,
        flight.flightNo,
        rule.name,
        date,
        runFacts.scheduleFrequency
      ) > 0,
    unavoidableLaterTask:
      isPriorityRotationPosition(rule) &&
      tasks.some((futureTask) => {
        if (
          processedTasks.has(futureTask.key) ||
          futureTask.key === taskKey ||
          operationalMinutes(futureTask.flight.startTime) <
            operationalMinutes(flight.endTime) ||
          !eligibleStaffIds.get(futureTask.key)?.has(person.id)
        )
          return false;
        return (eligibleCounts.get(futureTask.key) ?? 0) === 1;
      }),
    rollingLoadExcess: rollingLoadCost(
      assignments,
      person.id,
      flight.startTime,
      rule.fatiguePoints,
      rule.remark,
      state
    ),
    highLoadRecoveryConflict:
      state.settings.highLoadProtectionEnabled &&
      hasHighLoadTransition(
        assignments,
        person.id,
        flight.startTime,
        flight.endTime,
        rule.fatiguePoints,
        rule.remark,
        state
      ),
    previousWorkdayLoad: previousWorkdayLoadForStaff(
      runFacts.previousWorkdayLoad,
      person.id
    ),
    positionFrequency: positionFrequencyProfileForRule(
      state,
      person.id,
      flight.flightNo,
      rule,
      date,
      runFacts.scheduleFrequency
    ),
    workloadBalance: workloadBalancePriority(
      person,
      assignments,
      state,
      hours,
      rule.fatiguePoints,
      dutyStaffId,
      date,
      runFacts.workloadPressure
    ),
    historicalFatigue: totalFatiguePriority(
      person,
      assignments,
      state,
      date,
      dutyStaffId
    ),
    staffOrder: Math.max(
      0,
      state.staff.findIndex((item) => item.id === person.id)
    ),
  };
}
