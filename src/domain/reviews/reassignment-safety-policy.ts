import type { AppState, Assignment } from "../../model";
import { assignmentRule } from "../flights/schedule-position-rules";
import type { ScheduleRunFacts } from "../shared/schedule-run-facts";
import {
  comparePreviousWorkdayLoad,
  previousWorkdayLoadForStaff,
} from "../shared/previous-workday-load";
import {
  comparePositionFrequency,
  consecutivePositionAssignments,
  positionFrequencyProfileForAssignment,
  type ScheduleFrequencyFacts,
} from "../statistics/schedule-frequency";
import {
  isInFinalLateBatch,
  isNextWorkdayCutoffConflict,
} from "./cross-day-recovery";
import { isNextDutyRestConflict } from "./next-duty-rest";
import {
  isHighFatigueOrdinaryRotationPosition,
  isPriorityRotationPosition,
} from "./position-rotation-policy";
import {
  hasHighLoadTransition,
  lateShiftRecoveryRisk,
  positionTransitionInsertionCost,
  rollingLoadCost,
} from "./schedule-protection";

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
    frequency: "preserve-priority",
    protectPreviousWorkdayLoad: false,
    preventStaffWithoutWork: true,
    protectDutyMorning: true,
    protectWorkloadBalance: false,
  },
  "ke166-supervisor": {
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

export interface ReassignmentCandidateSafetyOptions {
  state: AppState;
  assignment: Assignment;
  originalAssignment: Assignment;
  primaryAssignment: Assignment;
  date: string;
  review: RotationReview;
  facts?: ScheduleRunFacts;
  frequencyFacts?: ScheduleFrequencyFacts;
  latePriorityFatigueRelief?: LatePriorityFatigueReliefPolicy;
}

export function reassignmentCandidateSafetyReasons({
  state,
  assignment,
  originalAssignment,
  primaryAssignment,
  date,
  review,
  facts,
  frequencyFacts,
  latePriorityFatigueRelief,
}: ReassignmentCandidateSafetyOptions): string[] {
  if (!assignment.staffId) return ["交换后会造成其他岗位空缺"];
  const rule = assignmentRule(state, assignment);
  const primaryRule = assignmentRule(state, primaryAssignment);
  if (!rule || !primaryRule) return ["交换目标航班或岗位规则不存在"];
  const policy = ROTATION_REVIEW_POLICIES[review];
  const validLatePriorityRelief = Boolean(
    latePriorityFatigueRelief &&
    primaryAssignment.staffId === latePriorityFatigueRelief.repeatedStaffId &&
    isPriorityRotationPosition(primaryRule) &&
    isInFinalLateBatch(primaryAssignment, state.flights, state)
  );
  const recoveryProtectionMayYield = Boolean(
    validLatePriorityRelief &&
    latePriorityFatigueRelief &&
    ((assignment.id !== primaryAssignment.id &&
      assignment.staffId === latePriorityFatigueRelief.repeatedStaffId &&
      !isPriorityRotationPosition(rule) &&
      assignment.fatiguePoints < primaryAssignment.fatiguePoints) ||
      (latePriorityFatigueRelief.allowProtectedReplacement &&
        assignment.id === primaryAssignment.id &&
        assignment.staffId !== latePriorityFatigueRelief.repeatedStaffId))
  );
  const reasons: string[] = [];
  if (
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
  if (
    !recoveryProtectionMayYield &&
    lateShiftRecoveryRisk(
      state,
      assignment.staffId,
      {
        flightNo: assignment.flightNo,
        startTime: assignment.startTime,
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

  if (policy.consecutive !== "none") {
    const before = originalAssignment.staffId
      ? consecutivePositionAssignments(
          state,
          originalAssignment.staffId,
          originalAssignment.flightNo,
          originalAssignment.position,
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
    const rotationSensitive =
      isPriorityRotationPosition(rule) ||
      isHighFatigueOrdinaryRotationPosition(
        rule,
        state.settings.highLoadFatigueThreshold
      );
    const transfersConsecutiveProblem =
      policy.consecutive === "improve-primary" &&
      assignment.id === primaryAssignment.id
        ? after >= before
        : rotationSensitive && after > before;
    if (transfersConsecutiveProblem) {
      reasons.push("交换会把连续轮岗问题转移给其他人员");
    }
  } else if (policy.frequency === "improve-primary") {
    const before = originalAssignment.staffId
      ? positionFrequencyProfileForAssignment(
          state,
          originalAssignment,
          originalAssignment.staffId,
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
      assignment.id === primaryAssignment.id
        ? frequencyDifference >= 0
        : frequencyDifference > 0
    ) {
      reasons.push("重排未降低目标岗位同岗频率或会转移高频问题");
    }
    if (
      policy.protectPreviousWorkdayLoad &&
      assignment.id === primaryAssignment.id &&
      originalAssignment.staffId &&
      facts &&
      comparePreviousWorkdayLoad(
        previousWorkdayLoadForStaff(
          facts.previousWorkdayLoad,
          assignment.staffId
        ),
        previousWorkdayLoadForStaff(
          facts.previousWorkdayLoad,
          originalAssignment.staffId
        )
      ) > 0
    ) {
      reasons.push("调整会破坏跨工作班负荷互补");
    }
  } else if (
    policy.frequency === "preserve-priority" &&
    isPriorityRotationPosition(rule) &&
    originalAssignment.staffId
  ) {
    const frequencyBefore = positionFrequencyProfileForAssignment(
      state,
      originalAssignment,
      originalAssignment.staffId,
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
  return reasons;
}

export interface ReassignmentDynamicSafetyOptions {
  state: AppState;
  assignments: Assignment[];
  assignment: Assignment;
  primaryAssignment: Assignment;
  review: RotationReview;
}

export function reassignmentDynamicSafetyReasons({
  state,
  assignments,
  assignment,
  primaryAssignment,
  review,
}: ReassignmentDynamicSafetyOptions): string[] {
  if (!assignment.staffId) return ["交换后会造成其他岗位空缺"];
  const flight = state.flights.find((item) => item.id === assignment.flightId);
  const rule = assignmentRule(state, assignment);
  const primaryRule = assignmentRule(state, primaryAssignment);
  if (!flight || !rule || !primaryRule) return ["交换目标航班或岗位规则不存在"];
  const policy = ROTATION_REVIEW_POLICIES[review];
  const mandatoryPriorityRotation =
    policy.mandatoryPriorityRotation === "always" ||
    (policy.mandatoryPriorityRotation === "priority-primary" &&
      isPriorityRotationPosition(primaryRule));
  if (mandatoryPriorityRotation) return [];
  const reasons: string[] = [];
  if (
    positionTransitionInsertionCost(
      assignments,
      assignment.staffId,
      {
        key: `${flight.id}:${assignment.positionRuleId ?? assignment.id}`,
        flight,
        rule,
      },
      state,
      policy.transitionMode
    ) > 0
  ) {
    reasons.push("交换后违反岗位衔接保护");
  }
  if (
    state.settings.highLoadProtectionEnabled &&
    hasHighLoadTransition(
      assignments,
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
      assignments,
      assignment.staffId,
      assignment.startTime,
      assignment.fatiguePoints,
      assignment.remark,
      state
    ) > 0
  ) {
    reasons.push("交换后违反滚动负荷保护");
  }
  return reasons;
}
