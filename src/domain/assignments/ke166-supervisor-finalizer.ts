import type { Assignment } from "../../model";
import type { ScheduleGenerationFacts } from "../shared/scheduling-facts";
import { buildAssignmentDecisionTrace } from "./assignment-decision-trace";
import { createAssignedPosition } from "./assignment-factory";
import { applyEarlyReleases } from "./assignment-timing";
import { diversionTransferCount } from "./diversion-release-usage";
import { assignMobileSupervisorByCounterCoverage } from "./ke166-assignment";
import { strictOverrideNotes } from "./schedule-decision-notes";
import { selectAssignmentCandidate } from "../candidates/candidate-selection";
import { makeUnfilled } from "../flights/schedule-position-rules";
import {
  isKe166MobileSupervisor,
  isMobileSupervisor,
  type AssignmentTask,
} from "../flights/schedule-tasks";
import { consecutivePositionAssignments } from "../statistics/schedule-frequency";
import { createCandidateRulePlan } from "../rules/candidate-rule-plan";
import { evaluateAutomaticHardConstraints } from "../rules/built-in-rule-registry";
import type { SolverPort } from "../solver/solver-port";
import { durationHours } from "../shared/time";
import type { SchedulePreparation } from "../kernel/schedule-preparation";
import { halfRestPeriodViolation } from "../rules/half-rest";
import { schedulingDecision } from "../rules/schedule-rule-contract";

export interface FinalizeMobileSupervisorsOptions {
  solver: SolverPort;
  state: ScheduleGenerationFacts;
  date: string;
  assignments: Assignment[];
  preparation: SchedulePreparation;
  lockedAssignmentIds: ReadonlySet<string>;
}

function mobileSupervisorTasks(
  preparation: SchedulePreparation
): AssignmentTask[] {
  return preparation.tasks
    .filter((task) => isMobileSupervisor(task.flight, task.rule))
    .sort(
      (left, right) =>
        Number(!isKe166MobileSupervisor(left.flight, left.rule)) -
        Number(!isKe166MobileSupervisor(right.flight, right.rule))
    );
}

export async function finalizeMobileSupervisors({
  solver,
  state,
  date,
  assignments,
  preparation,
  lockedAssignmentIds,
}: FinalizeMobileSupervisorsOptions): Promise<Assignment[]> {
  const tasks = mobileSupervisorTasks(preparation);
  const processedTasks = new Set(
    preparation.tasks
      .filter((task) => !isMobileSupervisor(task.flight, task.rule))
      .map((task) => task.key)
  );
  const dutyTargetTaskKeys = new Set([
    ...(preparation.preferredDutyMorningTaskKey
      ? [preparation.preferredDutyMorningTaskKey]
      : []),
    ...preparation.preferredDutyLateTaskCandidates.map((task) => task.key),
  ]);
  const candidateRulePlan = createCandidateRulePlan(state.settings);

  for (const task of tasks) {
    const ke166 = isKe166MobileSupervisor(task.flight, task.rule);
    const hours = durationHours(task.flight.startTime, task.flight.endTime);
    const selection = selectAssignmentCandidate({
      state,
      date,
      assignments,
      task,
      tasks: preparation.tasks,
      processedTasks,
      eligibleStaffIds: preparation.eligibleStaffIds,
      eligibleCounts: preparation.eligibleCounts,
      runFacts: preparation.runFacts,
      dutyStaffId: preparation.dutyStaffId,
      hours,
      isDutyTarget: dutyTargetTaskKeys.has(task.key),
      reserveDutyForPendingTarget: false,
      protectDutyFromAdditionalPriorityPosition: false,
      currentDutyTargetTaskKeys: dutyTargetTaskKeys,
      preNoonRequired: false,
      canBreakStrictTransition: true,
      finalizingKe166Supervisor: ke166,
      candidateRulePlan,
      evaluateEligibility: evaluateAutomaticHardConstraints,
    });
    const existingDiversionCount = diversionTransferCount(assignments, state);
    const candidateDiversionCount = (staffId: string): number => {
      const person = state.staff.find((item) => item.id === staffId)!;
      return (
        diversionTransferCount(
          [...assignments, createAssignedPosition(task, person, hours, [], [])],
          state
        ) - existingDiversionCount
      );
    };
    const orderedCandidates = selection.candidates
      .filter(
        (person) =>
          !halfRestPeriodViolation({
            facts: preparation.runFacts.halfRest,
            staffId: person.id,
            startTime: task.flight.startTime,
          })
      )
      .sort(
        (left, right) =>
          candidateDiversionCount(left.id) -
            candidateDiversionCount(right.id) ||
          selection.candidates.indexOf(left) -
            selection.candidates.indexOf(right)
      );
    const selected = orderedCandidates[0];
    const runnerUp = orderedCandidates[1];
    const repeatedIndependentSupervisorCanBeReleased = Boolean(
      ke166 &&
      selected &&
      consecutivePositionAssignments(
        state,
        selected.id,
        task.flight.flightNo,
        task.rule.name,
        task.rule.remark,
        date
      ) > 0 &&
      (selected.teamLeader ||
        assignments.some(
          (assignment) =>
            assignment.staffId === selected!.id &&
            assignment.status === "assigned" &&
            assignment.workHours > 0
        ))
    );
    if (repeatedIndependentSupervisorCanBeReleased) {
      const reused = await assignMobileSupervisorByCounterCoverage(
        solver,
        state,
        assignments,
        task.flight,
        task.rule,
        date,
        preparation.runFacts,
        lockedAssignmentIds,
        selected!.id
      );
      if (reused) {
        assignments.push(reused);
        processedTasks.add(task.key);
        continue;
      }
    }
    if (!selected) {
      const reused = await assignMobileSupervisorByCounterCoverage(
        solver,
        state,
        assignments,
        task.flight,
        task.rule,
        date,
        preparation.runFacts,
        lockedAssignmentIds
      );
      if (reused) {
        assignments.push(reused);
        processedTasks.add(task.key);
        continue;
      }
    }
    if (!selected) {
      assignments.push(makeUnfilled(task.flight, task.rule.name, task.rule));
      processedTasks.add(task.key);
      continue;
    }

    applyEarlyReleases(assignments, selected.id, task.flight, state);
    const systemNotes = strictOverrideNotes(state, assignments, selected, task);
    const decisionTrace = buildAssignmentDecisionTrace({
      state,
      date,
      assignments,
      task,
      selected,
      runnerUp,
      candidates: selection.candidates,
      candidatePriorities: selection.priorities,
      candidateRulePlan,
      decisiveCandidateRule:
        selected?.id === selection.selected?.id &&
        runnerUp?.id === selection.runnerUp?.id
          ? selection.decisiveRule
          : null,
      runFacts: preparation.runFacts,
      dutyStaffId: preparation.dutyStaffId,
      isDutyTarget: dutyTargetTaskKeys.has(task.key),
      hasAssignedDutyLateTask: preparation.preferredDutyLateTaskCandidates.some(
        (candidate) =>
          assignments.some(
            (assignment) =>
              assignment.flightId === candidate.flight.id &&
              assignment.positionRuleId === candidate.rule.id &&
              assignment.staffId === preparation.dutyStaffId
          )
      ),
      finalizingKe166Supervisor: ke166,
    });
    if (!ke166) {
      decisionTrace.push(
        schedulingDecision(
          "mobile-supervisor",
          "selected",
          `${selected.name}在普通岗位排班完成后独立担任${task.flight.flightNo}/${task.rule.name}`
        )
      );
    }
    assignments.push(
      createAssignedPosition(task, selected, hours, systemNotes, decisionTrace)
    );
    processedTasks.add(task.key);
  }
  return assignments;
}
