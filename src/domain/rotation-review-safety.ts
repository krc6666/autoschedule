import type { AppState, Assignment } from "../model";
import { canAssignStaff } from "./assignment-eligibility";
import {
  comparePositionFrequency,
  consecutivePositionAssignments,
  positionFrequencyProfileForAssignment,
  type ScheduleFrequencyFacts,
} from "./schedule-frequency";
import { assignmentRule } from "./schedule-position-rules";
import {
  hasHighLoadTransition,
  lateShiftRecoveryRisk,
  positionTransitionInsertionCost,
  rollingLoadCost,
} from "./schedule-protection";
import {
  isHighFatigueOrdinaryRotationPosition,
  isPriorityRotationPosition,
} from "./position-rotation-policy";
import { isNextDutyRestConflict } from "./next-duty-rest";
import {
  isInFinalLateBatch,
  isNextWorkdayCutoffConflict,
} from "./cross-day-recovery";
import { intervalsOverlap } from "./time";
import { applyConfiguredEarlyReleases } from "./assignment-timing";
import { evaluateWorkloadBalance } from "./workload-balance";
import type { ScheduleRunFacts } from "./schedule-run-facts";
import {
  comparePreviousWorkdayLoad,
  previousWorkdayLoadForStaff,
} from "./previous-workday-load";
import { hasDutyMorningAssignment } from "./duty-assignment";

export function isRotationLocked(
  state: AppState,
  assignment: Assignment,
  lockedAssignmentIds: ReadonlySet<string>
): boolean {
  const rule = assignmentRule(state, assignment);
  return (
    lockedAssignmentIds.has(assignment.id) ||
    assignment.status !== "assigned" ||
    !assignment.staffId ||
    !assignment.positionRuleId ||
    assignment.supervisorSourceAssignmentId !== undefined ||
    !rule ||
    rule.category !== "常规" ||
    rule.manual
  );
}

export function rotationCandidateAssignments(
  assignments: Assignment[],
  primary: Assignment,
  state: AppState,
  lockedAssignmentIds: ReadonlySet<string>
): Assignment[] {
  const available = assignments.filter(
    (assignment) =>
      assignment.id !== primary.id &&
      !isRotationLocked(state, assignment, lockedAssignmentIds)
  );
  const sameFlight = available.filter(
    (assignment) => assignment.flightId === primary.flightId
  );
  const overlappingFlights = available.filter(
    (assignment) =>
      assignment.flightId !== primary.flightId &&
      intervalsOverlap(
        assignment.startTime,
        assignment.endTime,
        primary.startTime,
        primary.endTime
      )
  );
  return [...sameFlight, ...overlappingFlights];
}

export function rotationCycleReason(reason: string): string {
  if (reason.includes("夜班")) return "候选人不具备夜班能力";
  if (reason.includes("不具备")) return "没有具备双向岗位资质的人员";
  if (reason.includes("已有排班")) return "交换后会产生时间冲突";
  if (reason.includes("超过每日")) return "交换后超过每日工时上限";
  if (reason.includes("衔接")) return "交换后违反严格岗位衔接保护";
  return reason;
}

export type RotationReview =
  | "consecutive"
  | "ke166-supervisor"
  | "frequency"
  | "recovery"
  | "next-duty-rest"
  | "coverage";

export interface RotationReviewSafetyPolicy {
  mandatoryPriorityRotation: "never" | "always" | "priority-primary";
  transitionMode: "prefer" | "forbid";
  assignedCount: "preserve" | "may-increase";
  consecutive: "none" | "improve-primary" | "preserve";
  frequency: "none" | "improve-primary" | "preserve-priority";
  protectPreviousWorkdayLoad: boolean;
  preventStaffWithoutWork: boolean;
  protectDutyMorning: boolean;
  protectWorkloadBalance: boolean;
}

export interface LatePriorityFatigueReliefPolicy {
  primaryAssignmentId: string;
  repeatedStaffId: string;
  allowProtectedReplacement: boolean;
}

export const ROTATION_REVIEW_POLICIES: Readonly<
  Record<RotationReview, RotationReviewSafetyPolicy>
> = {
  consecutive: {
    mandatoryPriorityRotation: "priority-primary",
    transitionMode: "prefer",
    assignedCount: "preserve",
    consecutive: "improve-primary",
    frequency: "none",
    protectPreviousWorkdayLoad: false,
    preventStaffWithoutWork: false,
    protectDutyMorning: true,
    protectWorkloadBalance: false,
  },
  "ke166-supervisor": {
    mandatoryPriorityRotation: "always",
    transitionMode: "prefer",
    assignedCount: "preserve",
    consecutive: "preserve",
    frequency: "none",
    protectPreviousWorkdayLoad: false,
    preventStaffWithoutWork: false,
    protectDutyMorning: true,
    protectWorkloadBalance: false,
  },
  frequency: {
    mandatoryPriorityRotation: "never",
    transitionMode: "prefer",
    assignedCount: "preserve",
    consecutive: "none",
    frequency: "improve-primary",
    protectPreviousWorkdayLoad: true,
    preventStaffWithoutWork: true,
    protectDutyMorning: true,
    protectWorkloadBalance: false,
  },
  recovery: {
    mandatoryPriorityRotation: "never",
    transitionMode: "prefer",
    assignedCount: "preserve",
    consecutive: "none",
    frequency: "preserve-priority",
    protectPreviousWorkdayLoad: false,
    preventStaffWithoutWork: false,
    protectDutyMorning: true,
    protectWorkloadBalance: true,
  },
  "next-duty-rest": {
    mandatoryPriorityRotation: "never",
    transitionMode: "prefer",
    assignedCount: "preserve",
    consecutive: "none",
    frequency: "none",
    protectPreviousWorkdayLoad: false,
    preventStaffWithoutWork: false,
    protectDutyMorning: true,
    protectWorkloadBalance: false,
  },
  coverage: {
    mandatoryPriorityRotation: "never",
    transitionMode: "forbid",
    assignedCount: "may-increase",
    consecutive: "none",
    frequency: "none",
    protectPreviousWorkdayLoad: false,
    preventStaffWithoutWork: false,
    protectDutyMorning: false,
    protectWorkloadBalance: false,
  },
};

export interface SafeRotationCycleSearchOptions {
  state: AppState;
  assignments: Assignment[];
  primary: Assignment;
  date: string;
  review: RotationReview;
  lockedAssignmentIds: ReadonlySet<string>;
  facts?: ScheduleRunFacts;
  excludedAssignmentIds?: ReadonlySet<string>;
  maxAssignments?: 2 | 3;
}

export interface SafeRotationCycleSearchResult {
  cycle: Assignment[] | null;
  attemptedReasons: string[];
}

export interface RotationCycleStaffSnapshot {
  assignmentId: string;
  staffId: string;
  staffName: string;
  flightNo: string;
  position: string;
}

export function applyRotationCycleStaff(
  cycle: Assignment[]
): RotationCycleStaffSnapshot[] {
  const original = cycle.map((assignment) => ({
    assignmentId: assignment.id,
    staffId: assignment.staffId!,
    staffName: assignment.staffName,
    flightNo: assignment.flightNo,
    position: assignment.position,
  }));
  cycle.forEach((assignment, index) => {
    const incoming = original[(index + 1) % original.length]!;
    assignment.staffId = incoming.staffId;
    assignment.staffName = incoming.staffName;
  });
  return original;
}

function plannedAssignmentSafetyReasons(
  state: AppState,
  assignments: Assignment[],
  planned: Assignment[],
  changedAssignmentIds: ReadonlySet<string>,
  primaryAssignmentId: string,
  date: string,
  review: RotationReview,
  facts?: ScheduleRunFacts,
  permittedConcurrentAssignmentIds: ReadonlySet<string> = new Set(),
  frequencyFacts?: ScheduleFrequencyFacts,
  latePriorityFatigueRelief?: LatePriorityFatigueReliefPolicy
): string[] {
  const originalById = new Map(
    assignments.map((assignment) => [assignment.id, assignment])
  );
  const changedStaffIds = new Set(
    planned
      .filter((assignment) => changedAssignmentIds.has(assignment.id))
      .flatMap((assignment) => (assignment.staffId ? [assignment.staffId] : []))
  );
  planned = planned.map((assignment) => ({ ...assignment }));
  applyConfiguredEarlyReleases(planned, state, changedStaffIds);
  const plannedState: AppState = { ...state, assignments: planned };
  const policy = ROTATION_REVIEW_POLICIES[review];
  const primaryRule = assignmentRule(
    state,
    originalById.get(primaryAssignmentId)!
  );
  const mandatoryPriorityRotation =
    policy.mandatoryPriorityRotation === "always" ||
    (policy.mandatoryPriorityRotation === "priority-primary" &&
      Boolean(primaryRule && isPriorityRotationPosition(primaryRule)));
  const originalPrimary = originalById.get(primaryAssignmentId);
  const validLatePriorityRelief = Boolean(
    latePriorityFatigueRelief &&
    originalPrimary &&
    originalPrimary.staffId === latePriorityFatigueRelief.repeatedStaffId &&
    primaryRule &&
    isPriorityRotationPosition(primaryRule) &&
    isInFinalLateBatch(originalPrimary, state.flights, state)
  );
  const reasons: string[] = [];
  for (const assignment of planned.filter((item) =>
    changedAssignmentIds.has(item.id)
  )) {
    if (!assignment.staffId) {
      reasons.push("交换后会造成其他岗位空缺");
      continue;
    }
    const conflicts = planned.filter(
      (other) =>
        other.id !== assignment.id &&
        other.staffId === assignment.staffId &&
        intervalsOverlap(
          other.startTime,
          other.endTime,
          assignment.startTime,
          assignment.endTime
        ) &&
        !(
          permittedConcurrentAssignmentIds.has(assignment.id) &&
          permittedConcurrentAssignmentIds.has(other.id)
        )
    );
    if (conflicts.length) reasons.push("交换后会产生时间冲突");
    const validationState = permittedConcurrentAssignmentIds.has(assignment.id)
      ? {
          ...plannedState,
          assignments: planned.filter(
            (item) =>
              item.id === assignment.id ||
              !permittedConcurrentAssignmentIds.has(item.id)
          ),
        }
      : plannedState;
    const assignmentError = canAssignStaff(
      validationState,
      assignment.id,
      assignment.staffId
    );
    if (assignmentError) reasons.push(rotationCycleReason(assignmentError));
    const flight = state.flights.find(
      (item) => item.id === assignment.flightId
    );
    const rule = assignmentRule(state, assignment);
    if (!flight || !rule) {
      reasons.push("交换目标航班或岗位规则不存在");
      continue;
    }
    const recoveryProtectionMayYield = Boolean(
      validLatePriorityRelief &&
      latePriorityFatigueRelief &&
      originalPrimary &&
      ((assignment.id !== primaryAssignmentId &&
        assignment.staffId === latePriorityFatigueRelief.repeatedStaffId &&
        !isPriorityRotationPosition(rule) &&
        assignment.fatiguePoints < originalPrimary.fatiguePoints) ||
        (latePriorityFatigueRelief.allowProtectedReplacement &&
          assignment.id === primaryAssignmentId &&
          assignment.staffId !== latePriorityFatigueRelief.repeatedStaffId))
    );
    if (
      rule &&
      isNextDutyRestConflict(
        state,
        assignment.staffId,
        rule,
        date,
        facts?.nextDutyRest
      )
    ) {
      reasons.push("交换后会让下个工作班值班人员承担重点岗位");
    }
    if (
      !recoveryProtectionMayYield &&
      isNextWorkdayCutoffConflict(
        state,
        assignment.staffId,
        assignment.startTime,
        date,
        facts?.crossDayRecovery
      )
    ) {
      reasons.push("交换后会让末班重点岗位人员承担截止时间后的航班");
    }
    const safetyAssignments = permittedConcurrentAssignmentIds.has(
      assignment.id
    )
      ? planned.filter(
          (item) =>
            item.id === assignment.id ||
            !permittedConcurrentAssignmentIds.has(item.id)
        )
      : planned;
    if (!mandatoryPriorityRotation) {
      if (
        positionTransitionInsertionCost(
          safetyAssignments,
          assignment.staffId,
          {
            key: `${flight.id}:${assignment.positionRuleId ?? assignment.id}`,
            flight,
            rule: rule!,
          },
          state,
          policy.transitionMode
        ) > 0
      )
        reasons.push("交换后违反岗位衔接保护");
      if (
        state.settings.highLoadProtectionEnabled &&
        hasHighLoadTransition(
          safetyAssignments,
          assignment.staffId,
          assignment.startTime,
          assignment.endTime,
          assignment.fatiguePoints,
          assignment.remark,
          state
        )
      ) {
        reasons.push("交换后违反高负荷疲劳保护");
      }
      if (
        state.settings.rollingLoadProtectionEnabled &&
        rollingLoadCost(
          safetyAssignments,
          assignment.staffId,
          assignment.startTime,
          assignment.fatiguePoints,
          assignment.remark,
          state
        ) > 0
      ) {
        reasons.push("交换后违反滚动负荷保护");
      }
    }
    if (
      !recoveryProtectionMayYield &&
      lateShiftRecoveryRisk(
        state,
        assignment.staffId,
        {
          ...flight,
          position: assignment.position,
          remark: assignment.remark,
          fatiguePoints: assignment.fatiguePoints,
        },
        date,
        facts?.crossDayRecovery
      ).excess > 0
    ) {
      reasons.push("交换后违反跨工作日末班重点岗位恢复保护");
    }

    const original = originalById.get(assignment.id)!;
    if (policy.consecutive !== "none") {
      const before = original.staffId
        ? consecutivePositionAssignments(
            state,
            original.staffId,
            original.flightNo,
            original.position,
            date,
            frequencyFacts
          )
        : 0;
      const after = consecutivePositionAssignments(
        state,
        assignment.staffId,
        assignment.flightNo,
        assignment.position,
        date,
        frequencyFacts
      );
      const rotationSensitive = Boolean(
        rule &&
        (isPriorityRotationPosition(rule) ||
          isHighFatigueOrdinaryRotationPosition(
            rule,
            state.settings.highLoadFatigueThreshold
          ))
      );
      const transfersConsecutiveProblem =
        policy.consecutive === "improve-primary" &&
        assignment.id === primaryAssignmentId
          ? after >= before
          : rotationSensitive && after > before;
      if (transfersConsecutiveProblem) {
        reasons.push("交换会把连续轮岗问题转移给其他人员");
      }
    } else if (policy.frequency === "improve-primary") {
      const before = original.staffId
        ? positionFrequencyProfileForAssignment(
            state,
            original,
            original.staffId,
            date,
            frequencyFacts
          )
        : { currentMonthCount: 0, recentWorkdayCount: 0 };
      const after = positionFrequencyProfileForAssignment(
        state,
        assignment,
        assignment.staffId,
        date,
        frequencyFacts
      );
      const frequencyDifference = comparePositionFrequency(after, before);
      if (
        assignment.id === primaryAssignmentId
          ? frequencyDifference >= 0
          : frequencyDifference > 0
      ) {
        reasons.push("重排未降低目标岗位同岗频率或会转移高频问题");
      }
      if (
        policy.protectPreviousWorkdayLoad &&
        assignment.id === primaryAssignmentId &&
        original.staffId &&
        facts &&
        comparePreviousWorkdayLoad(
          previousWorkdayLoadForStaff(
            facts.previousWorkdayLoad,
            assignment.staffId
          ),
          previousWorkdayLoadForStaff(
            facts.previousWorkdayLoad,
            original.staffId
          )
        ) > 0
      ) {
        reasons.push("调整会破坏跨工作班负荷互补");
      }
    } else if (
      policy.frequency === "preserve-priority" &&
      rule &&
      isPriorityRotationPosition(rule) &&
      original.staffId
    ) {
      const frequencyBefore = positionFrequencyProfileForAssignment(
        state,
        original,
        original.staffId,
        date,
        frequencyFacts
      );
      const frequencyAfter = positionFrequencyProfileForAssignment(
        state,
        assignment,
        assignment.staffId,
        date,
        frequencyFacts
      );
      if (comparePositionFrequency(frequencyAfter, frequencyBefore) > 0) {
        reasons.push("调整会破坏重点岗位频率均衡");
      }
    }
  }
  const originalAssigned = assignments.filter(
    (assignment) => assignment.status === "assigned" && assignment.staffId
  ).length;
  const plannedAssigned = planned.filter(
    (assignment) => assignment.status === "assigned" && assignment.staffId
  ).length;
  if (
    policy.assignedCount === "may-increase"
      ? plannedAssigned < originalAssigned
      : originalAssigned !== plannedAssigned
  ) {
    reasons.push("交换后会造成其他岗位空缺");
  }
  if (policy.preventStaffWithoutWork) {
    const changedIds = new Set(
      planned
        .filter(
          (assignment) =>
            originalById.get(assignment.id)?.staffId !== assignment.staffId
        )
        .map((assignment) => assignment.id)
    );
    const originalStaffIds = new Set(
      assignments
        .filter(
          (assignment) => changedIds.has(assignment.id) && assignment.staffId
        )
        .map((assignment) => assignment.staffId!)
    );
    const incomingStaffIds = new Set(
      planned
        .filter(
          (assignment) => changedIds.has(assignment.id) && assignment.staffId
        )
        .map((assignment) => assignment.staffId!)
    );
    for (const staffId of originalStaffIds) {
      if (incomingStaffIds.has(staffId)) continue;
      const hasOtherWork = planned.some(
        (assignment) =>
          !changedIds.has(assignment.id) &&
          assignment.staffId === staffId &&
          assignment.status === "assigned" &&
          assignment.workHours > 0
      );
      if (!hasOtherWork) reasons.push("重排会使原人员当日无实际岗位");
    }
  }
  if (
    policy.protectDutyMorning &&
    facts?.currentDutyStaffId &&
    !hasDutyMorningAssignment(plannedState, planned, facts.currentDutyStaffId)
  ) {
    reasons.push("交换后值班人员没有12点前开始的航班");
  }
  if (policy.protectWorkloadBalance) {
    const before = evaluateWorkloadBalance(
      state,
      date,
      assignments,
      facts?.currentDutyStaffId
    );
    const after = evaluateWorkloadBalance(
      plannedState,
      date,
      planned,
      facts?.currentDutyStaffId
    );
    if (
      after.workHoursDifference > before.workHoursDifference ||
      after.rollingWorkHoursDifference > before.rollingWorkHoursDifference ||
      after.todayFatigueDifference > before.todayFatigueDifference
    ) {
      reasons.push("调整会扩大工时或疲劳差");
    }
  }
  return [...new Set(reasons)];
}

export function findSafeRotationCycle({
  state,
  assignments,
  primary,
  date,
  review,
  lockedAssignmentIds,
  facts,
  excludedAssignmentIds = new Set(),
  maxAssignments = 3,
}: SafeRotationCycleSearchOptions): SafeRotationCycleSearchResult {
  const candidates = rotationCandidateAssignments(
    assignments,
    primary,
    state,
    lockedAssignmentIds
  ).filter((candidate) => !excludedAssignmentIds.has(candidate.id));
  const attemptedReasons: string[] = [];

  for (const candidate of candidates) {
    const cycle = [primary, candidate];
    const reasons = reassignmentSafetyReasons({
      kind: "cycle",
      state,
      assignments,
      cycle,
      date,
      review,
      facts,
    });
    if (!reasons.length) return { cycle, attemptedReasons };
    attemptedReasons.push(...reasons);
  }

  if (maxAssignments >= 3) {
    for (const second of candidates) {
      const thirdCandidates = rotationCandidateAssignments(
        assignments,
        second,
        state,
        lockedAssignmentIds
      ).filter(
        (candidate) =>
          candidate.id !== primary.id &&
          candidate.id !== second.id &&
          !excludedAssignmentIds.has(candidate.id)
      );
      for (const third of thirdCandidates) {
        const cycle = [primary, second, third];
        const reasons = reassignmentSafetyReasons({
          kind: "cycle",
          state,
          assignments,
          cycle,
          date,
          review,
          facts,
        });
        if (!reasons.length) return { cycle, attemptedReasons };
        attemptedReasons.push(...reasons);
      }
    }
  }

  return { cycle: null, attemptedReasons };
}

export interface RotationStaffChange {
  assignmentId: string;
  staffId: string;
  startTime?: string;
  endTime?: string;
  workHours?: number;
  status?: Assignment["status"];
}

interface ReassignmentSafetyOptionsBase {
  state: AppState;
  assignments: Assignment[];
  date: string;
  facts?: ScheduleRunFacts;
  frequencyFacts?: ScheduleFrequencyFacts;
  latePriorityFatigueRelief?: LatePriorityFatigueReliefPolicy;
}

interface RotationCycleSafetyOptions extends ReassignmentSafetyOptionsBase {
  kind: "cycle";
  cycle: Assignment[];
  review: RotationReview;
}

interface ReassignmentPlanSafetyOptions extends ReassignmentSafetyOptionsBase {
  kind: "plan";
  changes: readonly RotationStaffChange[];
  primaryAssignmentId: string;
  review: RotationReview;
  permittedConcurrentAssignmentIds?: ReadonlySet<string>;
}

interface DirectReassignmentSafetyOptions extends ReassignmentSafetyOptionsBase {
  kind: "direct";
  assignmentId: string;
  staffId: string;
}

export type ReassignmentSafetyOptions =
  | RotationCycleSafetyOptions
  | ReassignmentPlanSafetyOptions
  | DirectReassignmentSafetyOptions;

export function reassignmentSafetyReasons(
  options: ReassignmentSafetyOptions
): string[] {
  const { state, assignments, date, facts } = options;
  const frequencyFacts = options.frequencyFacts ?? facts?.scheduleFrequency;
  if (options.kind === "cycle") {
    const planned = assignments.map((assignment) => {
      const index = options.cycle.findIndex(
        (item) => item.id === assignment.id
      );
      if (index < 0) return assignment;
      const incoming = options.cycle[(index + 1) % options.cycle.length]!;
      const person = incoming.staffId
        ? state.staff.find((item) => item.id === incoming.staffId)
        : undefined;
      return {
        ...assignment,
        staffId: incoming.staffId,
        staffName: person?.name ?? incoming.staffName,
      };
    });
    return plannedAssignmentSafetyReasons(
      state,
      assignments,
      planned,
      new Set(options.cycle.map((assignment) => assignment.id)),
      options.cycle[0]!.id,
      date,
      options.review,
      facts,
      undefined,
      frequencyFacts,
      options.latePriorityFatigueRelief
    );
  }

  if (options.kind === "plan") {
    const personById = new Map(
      state.staff.map((person) => [person.id, person])
    );
    const incomingByAssignmentId = new Map(
      options.changes.map((change) => [change.assignmentId, change.staffId])
    );
    const planned = assignments.map((assignment) => {
      const incomingStaffId = incomingByAssignmentId.get(assignment.id);
      if (!incomingStaffId) return assignment;
      const person = personById.get(incomingStaffId);
      const change = options.changes.find(
        (item) => item.assignmentId === assignment.id
      )!;
      return {
        ...assignment,
        staffId: incomingStaffId,
        staffName: person?.name ?? assignment.staffName,
        ...(change.startTime !== undefined
          ? { startTime: change.startTime }
          : {}),
        ...(change.endTime !== undefined ? { endTime: change.endTime } : {}),
        ...(change.workHours !== undefined
          ? { workHours: change.workHours }
          : {}),
        ...(change.status !== undefined ? { status: change.status } : {}),
      };
    });
    return plannedAssignmentSafetyReasons(
      state,
      assignments,
      planned,
      new Set(options.changes.map((change) => change.assignmentId)),
      options.primaryAssignmentId,
      date,
      options.review,
      facts,
      options.permittedConcurrentAssignmentIds,
      frequencyFacts,
      options.latePriorityFatigueRelief
    );
  }

  const person = state.staff.find((item) => item.id === options.staffId);
  const planned = assignments.map((assignment) =>
    assignment.id === options.assignmentId
      ? {
          ...assignment,
          staffId: options.staffId,
          staffName: person?.name ?? assignment.staffName,
        }
      : assignment
  );
  return plannedAssignmentSafetyReasons(
    state,
    assignments,
    planned,
    new Set([options.assignmentId]),
    options.assignmentId,
    date,
    "recovery",
    facts,
    undefined,
    frequencyFacts
  );
}
