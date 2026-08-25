import type { Assignment, Staff } from "../../model";
import { isLateEndingWork } from "./cross-day-recovery";
import { isPriorityRotationPosition } from "./position-rotation-policy";
import { assignmentRule } from "../flights/schedule-position-rules";
import { diagnoseSameAirlinePriorityEligibility } from "../candidates/assignment-eligibility";
import {
  consecutivePositionAssignments,
  type ScheduleFrequencyFacts,
} from "../statistics/schedule-frequency";
import type { ScheduleRunFacts } from "../shared/schedule-run-facts";
import type { ScheduleGenerationFacts } from "../shared/scheduling-facts";
import type { RotationStaffChange } from "./rotation-review-safety";
import { optimizeReassignment } from "../solver/reassignment-optimizer";
import type { SolverPort } from "../solver/solver-port";

export interface ConsecutiveRotationPlan {
  changes: RotationStaffChange[];
  fatigueRelief: boolean;
  protectedReplacementFallback: boolean;
}

export interface ConsecutiveRotationPlanSearchResult {
  plan: ConsecutiveRotationPlan | null;
  attemptedReasons: string[];
  termination: "optimal" | "infeasible" | "timed-out" | "failed";
}

interface ConsecutiveRotationPlanSearchOptions {
  solver: SolverPort;
  state: ScheduleGenerationFacts;
  assignments: Assignment[];
  primary: Assignment;
  availableAssignments: Assignment[];
  date: string;
  compareStaff: (leftId: string, rightId: string) => number;
  facts?: ScheduleRunFacts;
  frequencyFacts: ScheduleFrequencyFacts;
  timeoutMs?: number;
}

function configuredForAssignment(
  state: ScheduleGenerationFacts,
  assignment: Assignment,
  staffId: string
): boolean {
  return (
    assignmentRule(state, assignment)?.qualifiedStaffIds.includes(staffId) ??
    false
  );
}

function improvesPrimaryConsecutiveRun(
  state: ScheduleGenerationFacts,
  primary: Assignment,
  staff: Staff,
  date: string,
  frequencyFacts: ScheduleFrequencyFacts
): boolean {
  const before = consecutivePositionAssignments(
    state,
    primary.staffId!,
    primary.flightNo,
    primary.position,
    primary.remark,
    date,
    frequencyFacts
  );
  const after = consecutivePositionAssignments(
    state,
    staff.id,
    primary.flightNo,
    primary.position,
    primary.remark,
    date,
    frequencyFacts
  );
  return configuredForAssignment(state, primary, staff.id) && after < before;
}

function usesFatigueRelief(
  state: ScheduleGenerationFacts,
  assignments: readonly Assignment[],
  primary: Assignment,
  changes: readonly RotationStaffChange[]
): boolean {
  const originalStaffId = primary.staffId!;
  return changes.some((change) => {
    const assignment = assignments.find(
      (item) => item.id === change.assignmentId
    );
    const rule = assignment ? assignmentRule(state, assignment) : undefined;
    return Boolean(
      assignment &&
      change.staffId === originalStaffId &&
      assignment.id !== primary.id &&
      rule &&
      !isPriorityRotationPosition(rule) &&
      assignment.fatiguePoints < primary.fatiguePoints
    );
  });
}

export async function findConsecutiveRotationPlan({
  solver,
  state,
  assignments,
  primary,
  availableAssignments,
  date,
  compareStaff,
  facts,
  frequencyFacts,
  timeoutMs = 4_000,
}: ConsecutiveRotationPlanSearchOptions): Promise<ConsecutiveRotationPlanSearchResult> {
  const attemptedReasons: string[] = [];
  const deadline = Date.now() + timeoutMs;
  const primaryRule = assignmentRule(state, primary)!;
  const hasHardConstraintSafeReplacement = state.staff.some(
    (staff) =>
      staff.id !== primary.staffId &&
      staff.status === "正常" &&
      staff.staffType === "常规" &&
      improvesPrimaryConsecutiveRun(
        state,
        primary,
        staff,
        date,
        frequencyFacts
      ) &&
      diagnoseSameAirlinePriorityEligibility(
        {
          state,
          assignments,
          flight: state.flights.find(
            (flight) => flight.id === primary.flightId
          ) ?? {
            id: primary.flightId,
            flightNo: primary.flightNo,
            startTime: primary.startTime,
            endTime: primary.endTime,
            bookedPassengers: 0,
            positions: [primary.position],
            remark: "",
          },
          rule: primaryRule,
          person: staff,
        },
        new Set([primary.id])
      ).eligible
  );
  if (!hasHardConstraintSafeReplacement) {
    return {
      plan: null,
      attemptedReasons: [
        isPriorityRotationPosition(primaryRule)
          ? "没有满足同航司重点岗位互斥且能降低连续次数的替代人员"
          : "唯一合格人员或没有可安全接替的人员",
      ],
      termination: "infeasible",
    };
  }
  const latePriorityReliefApplies =
    isPriorityRotationPosition(primaryRule) && isLateEndingWork(primary, state);
  const run = async (
    allowFatigueRelief: boolean,
    allowProtectedReplacement: boolean
  ) => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0)
      return {
        changes: null,
        attemptedReasons: ["整体重排达到时间上限，未提交部分结果"],
        termination: "timed-out" as const,
      };
    return optimizeReassignment({
      solver,
      state,
      assignments,
      primary,
      movableAssignments: availableAssignments,
      date,
      review: "consecutive",
      facts,
      frequencyFacts,
      primaryCandidateAllowed: (staff) =>
        improvesPrimaryConsecutiveRun(
          state,
          primary,
          staff,
          date,
          frequencyFacts
        ),
      compareCandidates: (_assignment, left, right) =>
        compareStaff(left.id, right.id),
      maxParticipants: 5,
      ...(allowFatigueRelief
        ? {
            leadingObjectives: [
              {
                id: "repeated-worker-destination-fatigue",
                direction: "minimize" as const,
                coefficient: ({
                  assignment,
                  person,
                }: {
                  assignment: Assignment;
                  person: Staff;
                }) =>
                  person.id === primary.staffId && assignment.id !== primary.id
                    ? assignment.fatiguePoints
                    : 0,
              },
            ],
            latePriorityFatigueRelief: {
              primaryAssignmentId: primary.id,
              repeatedStaffId: primary.staffId!,
              allowProtectedReplacement,
            },
          }
        : {}),
      timeoutMs: remainingMs,
    });
  };

  const attempts = latePriorityReliefApplies
    ? [
        { fatigueRelief: false, protectedReplacementFallback: false },
        { fatigueRelief: true, protectedReplacementFallback: false },
        { fatigueRelief: true, protectedReplacementFallback: true },
      ]
    : [{ fatigueRelief: false, protectedReplacementFallback: false }];

  for (const attempt of attempts) {
    const result = await run(
      attempt.fatigueRelief,
      attempt.protectedReplacementFallback
    );
    attemptedReasons.push(...result.attemptedReasons);
    if (result.changes) {
      return {
        plan: {
          changes: result.changes,
          fatigueRelief: usesFatigueRelief(
            state,
            assignments,
            primary,
            result.changes
          ),
          protectedReplacementFallback: attempt.protectedReplacementFallback,
        },
        attemptedReasons: [...new Set(attemptedReasons)],
        termination: "optimal",
      };
    }
    if (result.termination === "timed-out" || result.termination === "failed")
      return {
        plan: null,
        attemptedReasons: [...new Set(attemptedReasons)],
        termination: result.termination,
      };
  }

  return {
    plan: null,
    attemptedReasons: [...new Set(attemptedReasons)],
    termination: "infeasible",
  };
}
