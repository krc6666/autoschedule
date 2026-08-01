import type { AppState, ScheduleResult } from "../../model";
import { createCandidateRulePlan } from "../rules/candidate-rule-plan";
import { evaluateAutomaticHardConstraints } from "../rules/built-in-rule-registry";
import { finalizeSchedule } from "./schedule-finalizer";
import { createScheduleLedger } from "./schedule-ledger";
import { placePassivePosition } from "./schedule-passive-position";
import { prepareSchedule } from "./schedule-preparation";
import {
  scheduleProgressPercent,
  type ScheduleProgressStage,
} from "./schedule-progress";
import { createScheduleTaskAssigner } from "./schedule-task-assigner";
import { orderFlightRules, orderPreNoonTasks } from "./schedule-task-order";
import type { SolverPort } from "../solver/solver-port";

export type { ScheduleProgressStage } from "./schedule-progress";

export interface GenerateScheduleOptions {
  solver: SolverPort;
  onProgress?: (stage: ScheduleProgressStage, percent: number) => void;
}

export async function generateSchedule(
  state: AppState,
  date: string,
  options: GenerateScheduleOptions
): Promise<ScheduleResult> {
  const reportProgress = (
    stage: ScheduleProgressStage,
    percent: number
  ): void => options.onProgress?.(stage, percent);
  reportProgress("prepare", scheduleProgressPercent("prepare"));
  const preparation = prepareSchedule(
    state,
    date,
    evaluateAutomaticHardConstraints
  );
  reportProgress("history", scheduleProgressPercent("history"));

  const ledger = createScheduleLedger();
  const warnings: string[] = [];
  const processedTasks = new Set<string>();
  const lockedAssignmentIds = new Set<string>();
  const taskAssigner = createScheduleTaskAssigner({
    solver: options.solver,
    state,
    date,
    ledger,
    warnings,
    tasks: preparation.tasks,
    processedTasks,
    eligibleStaffIds: preparation.eligibleStaffIds,
    eligibleCounts: preparation.eligibleCounts,
    runFacts: preparation.runFacts,
    dutyStaffId: preparation.dutyStaffId,
    preferredDutyMorningTaskKey: preparation.preferredDutyMorningTaskKey,
    preferredDutyLateTaskCandidates:
      preparation.preferredDutyLateTaskCandidates,
    lockedAssignmentIds,
    candidateRulePlan: createCandidateRulePlan(state.settings),
    evaluateEligibility: evaluateAutomaticHardConstraints,
  });

  reportProgress("assign", scheduleProgressPercent("assign"));
  for (const task of orderPreNoonTasks(
    preparation.tasks,
    preparation.eligibleCounts,
    preparation.displayRulesByFlight
  ))
    await taskAssigner.schedule(task, true);

  for (const task of preparation.preferredDutyLateTaskCandidates) {
    if (!taskAssigner.hasProcessedTask(task.key))
      await taskAssigner.schedule(task, false);
    if (
      ledger
        .snapshot()
        .some(
          (assignment) =>
            assignment.flightId === task.flight.id &&
            assignment.positionRuleId === task.rule.id &&
            assignment.staffId === preparation.dutyStaffId
        )
    ) {
      taskAssigner.markAssignedDutyLateTask(task.key);
      break;
    }
  }

  for (const flight of preparation.flights) {
    const displayRules = preparation.displayRulesByFlight.get(flight.id) ?? [];
    const displayIndex = new Map(
      displayRules.map((rule, index) => [rule.id, index])
    );
    for (const rule of orderFlightRules(
      flight,
      displayRules,
      preparation.eligibleCounts,
      taskAssigner.dutyTargetTaskKeys
    )) {
      const taskKey = `${flight.id}:${rule.id}`;
      if (taskAssigner.hasProcessedTask(taskKey)) continue;
      if (
        placePassivePosition({
          state,
          ledger,
          warnings,
          flight,
          rule,
          displayIndex,
        })
      )
        continue;
      await taskAssigner.schedule({ key: taskKey, flight, rule }, false);
    }
  }

  const result = await finalizeSchedule({
    solver: options.solver,
    state,
    date,
    ledger,
    warnings,
    flights: preparation.flights,
    displayRulesByFlight: preparation.displayRulesByFlight,
    lockedAssignmentIds,
    runFacts: preparation.runFacts,
    finalizeKe166Supervisor: () =>
      taskAssigner.finalizeDeferredKe166Supervisors(),
    reportProgress,
  });
  reportProgress("complete", scheduleProgressPercent("complete"));
  return result;
}
