import type { AppState, Assignment } from "../../model";
import { buildAssignmentDecisionTrace } from "../assignments/assignment-decision-trace";
import { createAssignedPosition } from "../assignments/assignment-factory";
import {
  type AssignmentEligibilityDiagnostic,
  type AutomaticAssignmentEligibilityOptions,
} from "../candidates/assignment-eligibility";
import { applyEarlyReleases } from "../assignments/assignment-timing";
import type { CandidateRulePlanItem } from "../rules/candidate-rule-plan";
import { selectAssignmentCandidate } from "../candidates/candidate-selection";
import { createDutyTargetTracker } from "../assignments/duty-target-tracker";
import { assignKe166SupervisorByCounterCoverage } from "../assignments/ke166-assignment";
import { findMorningReallocation } from "../coverage/morning-reallocation";
import { strictOverrideNotes } from "../assignments/schedule-decision-notes";
import { preNoonShortageNote } from "../coverage/schedule-coverage";
import { makeUnfilled } from "../flights/schedule-position-rules";
import { consecutivePositionAssignments } from "../statistics/schedule-frequency";
import type { ScheduleRunFacts } from "../shared/schedule-run-facts";
import {
  isKe166MobileSupervisor,
  mustAutoFillPreNoon,
  type AssignmentTask,
} from "../flights/schedule-tasks";
import { isPriorityRotationPosition } from "../reviews/position-rotation-policy";
import { durationHours } from "../shared/time";
import type { ScheduleLedger } from "./schedule-ledger";
import type { SolverPort } from "../solver/solver-port";

export interface ScheduleTaskAssignerOptions {
  solver: SolverPort;
  state: AppState;
  date: string;
  ledger: ScheduleLedger;
  warnings: string[];
  tasks: AssignmentTask[];
  processedTasks: Set<string>;
  eligibleStaffIds: Map<string, Set<string>>;
  eligibleCounts: Map<string, number>;
  runFacts: ScheduleRunFacts;
  dutyStaffId: string | null;
  preferredDutyMorningTaskKey: string | null;
  preferredDutyLateTaskCandidates: AssignmentTask[];
  lockedAssignmentIds: Set<string>;
  candidateRulePlan: readonly CandidateRulePlanItem[];
  evaluateEligibility(
    context: AutomaticAssignmentEligibilityOptions
  ): AssignmentEligibilityDiagnostic;
}

export interface ScheduleTaskAssigner {
  readonly dutyTargetTaskKeys: ReadonlySet<string>;
  schedule(
    task: AssignmentTask,
    allowMorningReallocation: boolean,
    finalizingKe166Supervisor?: boolean
  ): Promise<void>;
  hasProcessedTask(taskKey: string): boolean;
  hasAssignedDutyLateTask(): boolean;
  markAssignedDutyLateTask(taskKey: string): void;
  finalizeDeferredKe166Supervisors(): Promise<void>;
}

export function createScheduleTaskAssigner(
  options: ScheduleTaskAssignerOptions
): ScheduleTaskAssigner {
  const {
    solver,
    state,
    date,
    ledger,
    warnings,
    tasks,
    processedTasks,
    eligibleStaffIds,
    eligibleCounts,
    runFacts,
    dutyStaffId,
    preferredDutyMorningTaskKey,
    preferredDutyLateTaskCandidates,
    lockedAssignmentIds,
    candidateRulePlan,
    evaluateEligibility,
  } = options;
  const deferredKe166SupervisorTasks: AssignmentTask[] = [];
  const deferredKe166SupervisorKeys = new Set<string>();
  const dutyTargets = createDutyTargetTracker({
    dutyStaffId,
    morningTaskKey: preferredDutyMorningTaskKey,
    lateTaskCandidates: preferredDutyLateTaskCandidates,
    processedTaskKeys: processedTasks,
  });

  const schedule = async (
    task: AssignmentTask,
    allowMorningReallocation: boolean,
    finalizingKe166Supervisor = false
  ): Promise<void> => {
    const { flight, rule, key: taskKey } = task;
    const hours = durationHours(flight.startTime, flight.endTime);
    const preNoonRequired = mustAutoFillPreNoon(flight, rule);
    const currentDutyTargetTaskKeys = dutyTargets.activeTaskKeys();
    const isDutyTarget = dutyTargets.isTarget(taskKey);
    const isDutyMorningTarget = taskKey === preferredDutyMorningTaskKey;
    if (isKe166MobileSupervisor(flight, rule) && !finalizingKe166Supervisor) {
      if (!deferredKe166SupervisorKeys.has(taskKey)) {
        deferredKe166SupervisorKeys.add(taskKey);
        deferredKe166SupervisorTasks.push(task);
      }
      return;
    }
    processedTasks.add(taskKey);
    const assignments: Assignment[] = ledger
      .snapshot()
      .map((assignment) => structuredClone(assignment) as Assignment);
    const commitAssignments = (): void =>
      ledger.commit({ type: "replace", assignments });
    const reserveDutyForPendingTarget =
      dutyTargets.shouldReserveForPendingTarget(taskKey);
    const protectDutyFromAdditionalPriorityPosition = Boolean(
      dutyStaffId &&
      dutyTargets.assignedLateTaskKey() &&
      taskKey !== dutyTargets.assignedLateTaskKey() &&
      isPriorityRotationPosition(rule)
    );
    const selection = selectAssignmentCandidate({
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
      canBreakStrictTransition:
        preNoonRequired || isKe166MobileSupervisor(flight, rule),
      finalizingKe166Supervisor,
      candidateRulePlan,
      evaluateEligibility,
    });
    const {
      candidates,
      priorities: candidatePriorities,
      runnerUp,
      decisiveRule: decisiveCandidateRule,
      strictTransitionBlockNotes,
    } = selection;
    let { selected } = selection;
    if (!selected && allowMorningReallocation && preNoonRequired) {
      const donor = findMorningReallocation(
        state,
        assignments,
        task,
        hours,
        eligibleCounts,
        evaluateEligibility
      );
      if (donor) {
        selected = donor.person;
        donor.source.staffId = null;
        donor.source.staffName = "";
        donor.source.status = "unfilled";
        donor.source.systemNotes = [
          `因抽调至 ${flight.flightNo}/${rule.name} 而空缺`,
        ];
        warnings.push(
          `${donor.source.flightNo} / ${donor.source.position} 因抽调至 ${flight.flightNo}/${rule.name} 而空缺`
        );
      }
    }

    const repeatedIndependentSupervisor =
      finalizingKe166Supervisor &&
      selected &&
      consecutivePositionAssignments(
        state,
        selected.id,
        flight.flightNo,
        rule.name,
        date
      ) > 0 &&
      assignments.some(
        (assignment) =>
          assignment.staffId === selected!.id &&
          assignment.status === "assigned" &&
          assignment.workHours > 0
      );
    if (repeatedIndependentSupervisor) {
      const reusedSupervisor = await assignKe166SupervisorByCounterCoverage(
        solver,
        state,
        assignments,
        flight,
        rule,
        date,
        runFacts,
        lockedAssignmentIds,
        selected!.id
      );
      if (reusedSupervisor) {
        assignments.push(reusedSupervisor);
        commitAssignments();
        return;
      }
    }

    if (!selected && finalizingKe166Supervisor) {
      const reusedSupervisor = await assignKe166SupervisorByCounterCoverage(
        solver,
        state,
        assignments,
        flight,
        rule,
        date,
        runFacts,
        lockedAssignmentIds
      );
      if (reusedSupervisor) {
        assignments.push(reusedSupervisor);
        commitAssignments();
        return;
      }
    }

    if (!selected) {
      const unfilled = makeUnfilled(flight, rule.name, rule);
      if (strictTransitionBlockNotes.length) {
        unfilled.status = "unfilled";
        unfilled.systemNotes = [
          `严格岗位衔接限制未满足：${strictTransitionBlockNotes.join("、")}`,
        ];
      } else if (preNoonRequired) {
        unfilled.status = "unfilled";
        unfilled.systemNotes = [
          preNoonShortageNote(state, assignments, task.flight, task.rule),
        ];
      }
      assignments.push(unfilled);
      warnings.push(
        `${flight.flightNo} / ${rule.name} ${unfilled.systemNotes?.[0] ?? "无可用人员"}`
      );
      dutyTargets.settle(taskKey, null);
      commitAssignments();
      return;
    }

    applyEarlyReleases(assignments, selected.id, flight, state);
    const systemNotes = strictOverrideNotes(state, assignments, selected, task);
    const decisionTrace = buildAssignmentDecisionTrace({
      state,
      date,
      assignments,
      task,
      selected,
      runnerUp,
      candidates,
      candidatePriorities,
      candidateRulePlan,
      decisiveCandidateRule,
      runFacts,
      dutyStaffId,
      isDutyTarget,
      hasAssignedDutyLateTask: dutyTargets.hasAssignedLateTask(),
      finalizingKe166Supervisor,
    });
    const assignment = createAssignedPosition(
      task,
      selected,
      hours,
      systemNotes,
      decisionTrace
    );
    assignments.push(assignment);
    dutyTargets.settle(taskKey, selected.id);
    if (selected.id === dutyStaffId && isDutyTarget && !isDutyMorningTarget)
      lockedAssignmentIds.add(assignment.id);
    warnings.push(
      ...systemNotes.map((note) => `${flight.flightNo} / ${rule.name} ${note}`)
    );
    commitAssignments();
  };

  return {
    dutyTargetTaskKeys: dutyTargets.allTaskKeys,
    schedule,
    hasProcessedTask: (taskKey) => processedTasks.has(taskKey),
    hasAssignedDutyLateTask: dutyTargets.hasAssignedLateTask,
    markAssignedDutyLateTask: (taskKey) => {
      dutyTargets.markLateTaskAssigned(taskKey);
    },
    finalizeDeferredKe166Supervisors: async () => {
      for (const task of deferredKe166SupervisorTasks)
        await schedule(task, false, true);
    },
  };
}
