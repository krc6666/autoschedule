import type { AppState, Assignment, Staff } from "../../model";
import { isInFinalLateBatch } from "./cross-day-recovery";
import { isPriorityRotationPosition } from "./position-rotation-policy";
import { assignmentRule } from "../flights/schedule-position-rules";
import {
  consecutivePositionAssignments,
  type ScheduleFrequencyFacts,
} from "../statistics/schedule-frequency";
import type { ScheduleRunFacts } from "../shared/schedule-run-facts";
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
  state: AppState;
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
  state: AppState,
  assignment: Assignment,
  staffId: string
): boolean {
  return (
    assignmentRule(state, assignment)?.qualifiedStaffIds.includes(staffId) ??
    false
  );
}

function improvesPrimaryConsecutiveRun(
  state: AppState,
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
    date,
    frequencyFacts
  );
  const after = consecutivePositionAssignments(
    state,
    staff.id,
    primary.flightNo,
    primary.position,
    date,
    frequencyFacts
  );
  return configuredForAssignment(state, primary, staff.id) && after < before;
}

function usesFatigueRelief(
  state: AppState,
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
  const latePriorityReliefApplies =
    isPriorityRotationPosition(primaryRule) &&
    isInFinalLateBatch(primary, state.flights, state);
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
