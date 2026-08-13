import type { AppState, ScheduleResult } from "../../model";
import { finalizeKe166Supervisors } from "../assignments/ke166-supervisor-finalizer";
import { evaluateAutomaticHardConstraints } from "../rules/built-in-rule-registry";
import type { SolverPort } from "../solver/solver-port";
import type { DailySchedulePlan } from "./daily-schedule-result";
import { optimizeDailySchedule } from "./daily-schedule-optimizer";
import { finalizeSchedule } from "./schedule-finalizer";
import { createScheduleLedger } from "./schedule-ledger";
import { placePassivePosition } from "./schedule-passive-position";
import {
  prepareSchedule,
  type SchedulePreparation,
} from "./schedule-preparation";
import {
  scheduleProgressPercent,
  type ScheduleProgressStage,
} from "./schedule-progress";

export type { ScheduleProgressStage } from "./schedule-progress";

export interface GenerateScheduleOptions {
  solver: SolverPort;
  checkpointSolver?: SolverPort;
  onProgress?: (stage: ScheduleProgressStage, percent: number) => void;
  onSafeResult?: (result: ScheduleResult) => void;
}

interface FinalizePlanOptions {
  state: AppState;
  date: string;
  solver: SolverPort;
  preparation: SchedulePreparation;
  plan: DailySchedulePlan;
  reportProgress: (stage: ScheduleProgressStage, percent: number) => void;
}

async function finalizeDailyPlan({
  state,
  date,
  solver,
  preparation,
  plan,
  reportProgress,
}: FinalizePlanOptions): Promise<ScheduleResult> {
  const ledger = createScheduleLedger(plan.assignments);
  const warnings = [...plan.warnings];
  const automaticTaskKeys = new Set(preparation.tasks.map((task) => task.key));
  for (const flight of preparation.flights) {
    const displayRules = preparation.displayRulesByFlight.get(flight.id) ?? [];
    const displayIndex = new Map(
      displayRules.map((rule, index) => [rule.id, index])
    );
    for (const rule of displayRules) {
      if (automaticTaskKeys.has(`${flight.id}:${rule.id}`)) continue;
      placePassivePosition({
        state,
        ledger,
        warnings,
        flight,
        rule,
        displayIndex,
      });
    }
  }

  let ke166Finalized = false;
  return finalizeSchedule({
    solver,
    state,
    date,
    ledger,
    warnings,
    flights: preparation.flights,
    displayRulesByFlight: preparation.displayRulesByFlight,
    lockedAssignmentIds: plan.lockedAssignmentIds,
    runFacts: preparation.runFacts,
    automaticTasks: preparation.tasks,
    preservedAssignments: plan.assignments
      .filter((assignment) => plan.lockedAssignmentIds.has(assignment.id))
      .map((assignment) => structuredClone(assignment)),
    optimizationQuality: plan.optimizationQuality,
    finalizeKe166Supervisor: async () => {
      if (ke166Finalized) return;
      const assignments = ledger
        .snapshot()
        .map((assignment) => structuredClone(assignment));
      await finalizeKe166Supervisors({
        solver,
        state,
        date,
        assignments,
        preparation,
        lockedAssignmentIds: plan.lockedAssignmentIds,
      });
      ledger.commit({ type: "replace", assignments });
      ke166Finalized = true;
    },
    reportProgress,
  });
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
  reportProgress("optimize", scheduleProgressPercent("optimize"));

  let pendingCheckpoint: DailySchedulePlan | null = null;
  let checkpointRunning = false;
  const queueCheckpoint = (checkpointPlan: DailySchedulePlan): void => {
    if (!options.onSafeResult || !options.checkpointSolver) return;
    pendingCheckpoint = checkpointPlan;
    if (checkpointRunning) return;
    checkpointRunning = true;
    const processLatest = async (): Promise<void> => {
      while (pendingCheckpoint) {
        const current = pendingCheckpoint;
        pendingCheckpoint = null;
        try {
          const safeResult = await finalizeDailyPlan({
            state,
            date,
            solver: options.checkpointSolver!,
            preparation,
            plan: current,
            reportProgress: () => undefined,
          });
          options.onSafeResult?.(safeResult);
        } catch {
          // A checkpoint is only published after the full safety review.
        }
      }
      checkpointRunning = false;
    };
    void processLatest();
  };

  const plan = await optimizeDailySchedule({
    solver: options.solver,
    state,
    date,
    preparation,
    onRequiredPlan: queueCheckpoint,
    onImprovedPlan: queueCheckpoint,
  });

  reportProgress("assign", scheduleProgressPercent("assign"));
  const result = await finalizeDailyPlan({
    state,
    date,
    solver: options.solver,
    preparation,
    plan,
    reportProgress,
  });
  reportProgress("complete", scheduleProgressPercent("complete"));
  return result;
}
