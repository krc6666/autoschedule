import type { Assignment } from "../../model";
import type { ScheduleGenerationFacts } from "../shared/scheduling-facts";
import { buildAssignmentDecisionTrace } from "./assignment-decision-trace";
import { createAssignedPosition } from "./assignment-factory";
import { applyEarlyReleases } from "./assignment-timing";
import { assignKe166SupervisorByCounterCoverage } from "./ke166-assignment";
import { strictOverrideNotes } from "./schedule-decision-notes";
import { selectAssignmentCandidate } from "../candidates/candidate-selection";
import { makeUnfilled } from "../flights/schedule-position-rules";
import {
  isKe166MobileSupervisor,
  type AssignmentTask,
} from "../flights/schedule-tasks";
import { consecutivePositionAssignments } from "../statistics/schedule-frequency";
import { createCandidateRulePlan } from "../rules/candidate-rule-plan";
import { evaluateAutomaticHardConstraints } from "../rules/built-in-rule-registry";
import type { SolverPort } from "../solver/solver-port";
import { durationHours } from "../shared/time";
import type { SchedulePreparation } from "../kernel/schedule-preparation";

export interface FinalizeKe166SupervisorsOptions {
  solver: SolverPort;
  state: ScheduleGenerationFacts;
  date: string;
  assignments: Assignment[];
  preparation: SchedulePreparation;
  lockedAssignmentIds: ReadonlySet<string>;
}

function ke166SupervisorTasks(
  preparation: SchedulePreparation
): AssignmentTask[] {
  return preparation.tasks.filter((task) =>
    isKe166MobileSupervisor(task.flight, task.rule)
  );
}

export async function finalizeKe166Supervisors({
  solver,
  state,
  date,
  assignments,
  preparation,
  lockedAssignmentIds,
}: FinalizeKe166SupervisorsOptions): Promise<Assignment[]> {
  const tasks = ke166SupervisorTasks(preparation);
  const processedTasks = new Set(
    preparation.tasks
      .filter((task) => !isKe166MobileSupervisor(task.flight, task.rule))
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
      finalizingKe166Supervisor: true,
      candidateRulePlan,
      evaluateEligibility: evaluateAutomaticHardConstraints,
    });
    let { selected } = selection;
    const repeatedIndependentSupervisorCanBeReleased = Boolean(
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
      const reused = await assignKe166SupervisorByCounterCoverage(
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
      const reused = await assignKe166SupervisorByCounterCoverage(
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
      runnerUp: selection.runnerUp,
      candidates: selection.candidates,
      candidatePriorities: selection.priorities,
      candidateRulePlan,
      decisiveCandidateRule: selection.decisiveRule,
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
      finalizingKe166Supervisor: true,
    });
    assignments.push(
      createAssignedPosition(task, selected, hours, systemNotes, decisionTrace)
    );
    processedTasks.add(task.key);
  }
  return assignments;
}
