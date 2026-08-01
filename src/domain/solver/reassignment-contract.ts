import type { AppState, Assignment, Staff } from "../../model";
import type {
  LatePriorityFatigueReliefPolicy,
  RotationReview,
} from "../reviews/reassignment-safety-policy";
import type { RotationStaffChange } from "../reviews/rotation-review-safety";
import type { ScheduleRunFacts } from "../shared/schedule-run-facts";
import type { ScheduleFrequencyFacts } from "../statistics/schedule-frequency";
import type { SolverPort } from "./solver-port";

export interface ReassignmentChoiceObjective {
  id: string;
  direction: "minimize" | "maximize";
  coefficient(input: {
    assignment: Assignment;
    person: Staff;
    keepsCurrentStaff: boolean;
  }): number;
}

export interface ReassignmentOptimizationOptions {
  solver: SolverPort;
  state: AppState;
  assignments: Assignment[];
  primary: Assignment;
  movableAssignments: readonly Assignment[];
  date: string;
  review: RotationReview;
  facts?: ScheduleRunFacts;
  frequencyFacts?: ScheduleFrequencyFacts;
  permittedConcurrentAssignmentIds?: ReadonlySet<string>;
  coupledAssignmentGroups?: readonly (readonly string[])[];
  latePriorityFatigueRelief?: LatePriorityFatigueReliefPolicy;
  candidateAllowed?(assignment: Assignment, staff: Staff): boolean;
  primaryCandidateAllowed(staff: Staff): boolean;
  primaryCandidateRejectionReason?(staff: Staff): string | null;
  compareCandidates?(assignment: Assignment, left: Staff, right: Staff): number;
  choiceWorkHours?(assignment: Assignment, staff: Staff): number;
  normalizeChanges?(
    changes: readonly RotationStaffChange[]
  ): readonly RotationStaffChange[];
  leadingObjectives?: readonly ReassignmentChoiceObjective[];
  validateChanges?(changes: readonly RotationStaffChange[]): readonly string[];
  timeoutMs?: number;
}

export interface ReassignmentOptimizationResult {
  changes: RotationStaffChange[] | null;
  attemptedReasons: string[];
  termination: "optimal" | "infeasible" | "timed-out" | "failed";
}
