import type { AppState, ScheduleResult } from "../../model";
import { evaluateAutomaticHardConstraints } from "../rules/built-in-rule-registry";
import { finalizeSchedule } from "./schedule-finalizer";
import { createScheduleLedger } from "./schedule-ledger";
import { placePassivePosition } from "./schedule-passive-position";
import { prepareSchedule } from "./schedule-preparation";
import { optimizeDailySchedule } from "./daily-schedule-optimizer";
import {
  scheduleProgressPercent,
  type ScheduleProgressStage,
} from "./schedule-progress";
import type { SolverPort } from "../solver/solver-port";
import { finalizeKe166Supervisors } from "../assignments/ke166-supervisor-finalizer";

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
  reportProgress("optimize", scheduleProgressPercent("optimize"));

  const ledger = createScheduleLedger();
  const plan = await optimizeDailySchedule({
    solver: options.solver,
    state,
    date,
    preparation,
  });
  let ke166Finalized = false;
  reportProgress("assign", scheduleProgressPercent("assign"));
  ledger.commit({ type: "replace", assignments: plan.assignments });
  const warnings = [...plan.warnings];
  const lockedAssignmentIds = plan.lockedAssignmentIds;
  const automaticTaskKeys = new Set(preparation.tasks.map((task) => task.key));
  for (const flight of preparation.flights) {
    const displayRules = preparation.displayRulesByFlight.get(flight.id) ?? [];
    const displayIndex = new Map(
      displayRules.map((rule, index) => [rule.id, index])
    );
    for (const rule of displayRules) {
      const taskKey = `${flight.id}:${rule.id}`;
      if (automaticTaskKeys.has(taskKey)) continue;
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
    finalizeKe166Supervisor: async () => {
      if (ke166Finalized) return;
      const assignments = ledger
        .snapshot()
        .map((assignment) => structuredClone(assignment));
      await finalizeKe166Supervisors({
        solver: options.solver,
        state,
        date,
        assignments,
        preparation,
        lockedAssignmentIds,
      });
      ledger.commit({ type: "replace", assignments });
      ke166Finalized = true;
    },
    reportProgress,
  });
  reportProgress("complete", scheduleProgressPercent("complete"));
  return result;
}
