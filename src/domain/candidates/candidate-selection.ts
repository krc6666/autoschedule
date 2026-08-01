import type { AppState, Assignment, Staff } from "../../model";
import type {
  AssignmentEligibilityDiagnostic,
  AutomaticAssignmentEligibilityOptions,
} from "./assignment-eligibility";
import {
  buildCandidatePriority,
  type CandidatePriority,
} from "./candidate-priority";
import {
  compareCandidateRulePlan,
  firstDifferentCandidateRulePlan,
  type CandidateRulePlanItem,
} from "../rules/candidate-rule-plan";
import { compareKe166SupervisorRotation } from "../assignments/ke166-assignment";
import type { ScheduleRunFacts } from "../shared/schedule-run-facts";
import type { AssignmentTask } from "../flights/schedule-tasks";
import { violatedPositionTransitionPoliciesForInsertion } from "../reviews/schedule-protection";
import { workloadBalanceLoadSnapshots } from "../reviews/workload-balance";

export interface CandidateSelectionOptions {
  state: AppState;
  date: string;
  assignments: Assignment[];
  task: AssignmentTask;
  tasks: AssignmentTask[];
  processedTasks: Set<string>;
  eligibleStaffIds: Map<string, Set<string>>;
  eligibleCounts: Map<string, number>;
  runFacts: ScheduleRunFacts;
  dutyStaffId: string | null;
  hours: number;
  isDutyTarget: boolean;
  reserveDutyForPendingTarget: boolean;
  protectDutyFromAdditionalPriorityPosition: boolean;
  currentDutyTargetTaskKeys: ReadonlySet<string>;
  preNoonRequired: boolean;
  canBreakStrictTransition: boolean;
  finalizingKe166Supervisor: boolean;
  candidateRulePlan: readonly CandidateRulePlanItem[];
  evaluateEligibility(
    context: AutomaticAssignmentEligibilityOptions
  ): AssignmentEligibilityDiagnostic;
}

export interface CandidateSelection {
  candidates: Staff[];
  priorities: ReadonlyMap<string, CandidatePriority>;
  selected?: Staff;
  runnerUp?: Staff;
  decisiveRule: CandidateRulePlanItem | null;
  strictTransitionBlockNotes: string[];
}

export function selectAssignmentCandidate({
  state,
  date,
  assignments,
  task,
  tasks,
  processedTasks,
  eligibleStaffIds,
  eligibleCounts,
  runFacts,
  dutyStaffId,
  hours,
  isDutyTarget,
  reserveDutyForPendingTarget,
  protectDutyFromAdditionalPriorityPosition,
  currentDutyTargetTaskKeys,
  preNoonRequired,
  canBreakStrictTransition,
  finalizingKe166Supervisor,
  candidateRulePlan,
  evaluateEligibility,
}: CandidateSelectionOptions): CandidateSelection {
  const { flight, rule } = task;
  const workloadBalanceLoads = state.settings.workloadBalanceEnabled
    ? workloadBalanceLoadSnapshots(state, assignments, date, dutyStaffId)
    : undefined;
  let candidates = state.staff.filter(
    (person) =>
      evaluateEligibility({
        state,
        assignments,
        flight,
        rule,
        person,
        workHours: hours,
      }).eligible
  );
  if (
    reserveDutyForPendingTarget ||
    protectDutyFromAdditionalPriorityPosition
  ) {
    const withoutDuty = candidates.filter(
      (person) => person.id !== dutyStaffId
    );
    if (!preNoonRequired || withoutDuty.length) candidates = withoutDuty;
  }
  const transitionPreferred = candidates.filter(
    (person) =>
      evaluateEligibility({
        state,
        assignments,
        flight,
        rule,
        person,
        workHours: hours,
        transitionMode: "forbid",
      }).eligible
  );
  const reservedDuty = isDutyTarget
    ? candidates.find((person) => person.id === dutyStaffId)
    : undefined;
  if (reservedDuty && !transitionPreferred.includes(reservedDuty))
    transitionPreferred.push(reservedDuty);
  let strictTransitionBlockNotes: string[] = [];
  if (transitionPreferred.length) candidates = transitionPreferred;
  else if (candidates.length && !canBreakStrictTransition) {
    strictTransitionBlockNotes = [
      ...new Set(
        candidates.flatMap((person) =>
          violatedPositionTransitionPoliciesForInsertion(
            assignments,
            person.id,
            flight.flightNo,
            rule.name,
            flight.startTime,
            flight.endTime,
            state,
            "forbid"
          ).map((policy) => policy.name)
        )
      ),
    ];
    candidates = [];
  }
  const priorities = new Map(
    candidates.map((person) => [
      person.id,
      buildCandidatePriority(
        {
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
          workloadBalanceLoads,
        },
        person
      ),
    ])
  );
  candidates.sort(
    (left, right) =>
      (finalizingKe166Supervisor
        ? compareKe166SupervisorRotation(
            state,
            flight,
            rule,
            date,
            left.id,
            right.id
          )
        : 0) ||
      compareCandidateRulePlan(
        candidateRulePlan,
        task,
        left,
        priorities.get(left.id)!,
        right,
        priorities.get(right.id)!
      ) ||
      left.id.localeCompare(right.id, undefined, { numeric: true })
  );
  const selected = candidates[0];
  const runnerUp = candidates[1];
  const decisiveRule =
    selected && runnerUp
      ? firstDifferentCandidateRulePlan(
          candidateRulePlan,
          task,
          selected,
          priorities.get(selected.id)!,
          runnerUp,
          priorities.get(runnerUp.id)!
        )
      : null;
  return {
    candidates,
    priorities,
    selected,
    runnerUp,
    decisiveRule,
    strictTransitionBlockNotes,
  };
}
