import type { ScheduleResult } from "../../model";
import type { ScheduleGenerationFacts } from "../shared/scheduling-facts";
import { finalizeMobileSupervisors } from "../assignments/ke166-supervisor-finalizer";
import { evaluateAutomaticHardConstraints } from "../rules/built-in-rule-registry";
import type { SolverPort } from "../solver/solver-port";
import type { DailySchedulePlan } from "./daily-schedule-result";
import { optimizeDailySchedule } from "./daily-schedule-optimizer";
import { finalizeSchedule } from "./schedule-finalizer";
import { createScheduleLedger } from "./schedule-ledger";
import { createDefaultScheduleGuards } from "./schedule-guard";
import { placePassivePosition } from "./schedule-passive-position";
import {
  prepareSchedule,
  type SchedulePreparation,
} from "./schedule-preparation";
import {
  scheduleProgressPercent,
  type ScheduleProgressStage,
} from "./schedule-progress";
import type { ScheduleRunPreferences } from "../shared/schedule-run-preferences";
import { createId } from "../../utils";

export type { ScheduleProgressStage } from "./schedule-progress";

export interface GenerateScheduleOptions {
  solver: SolverPort;
  checkpointSolver?: SolverPort;
  onProgress?: (stage: ScheduleProgressStage, percent: number) => void;
  onSafeResult?: (result: ScheduleResult) => void;
  preferences?: ScheduleRunPreferences;
}

interface FinalizePlanOptions {
  state: ScheduleGenerationFacts;
  date: string;
  solver: SolverPort;
  preparation: SchedulePreparation;
  plan: DailySchedulePlan;
  reportProgress: (stage: ScheduleProgressStage, percent: number) => void;
  scheduleRunId: string;
}

async function finalizeDailyPlan({
  state,
  date,
  solver,
  preparation,
  plan,
  reportProgress,
  scheduleRunId,
}: FinalizePlanOptions): Promise<ScheduleResult> {
  const guards = createDefaultScheduleGuards();
  const warnings = [...plan.warnings];
  const guardWarnings: string[] = [];
  const ledger = createScheduleLedger(plan.assignments, {
    guards,
    guardContext: {
      phase: "partial",
      sameFlightStaffExclusionFacts: { state },
      halfRestFacts: preparation.runFacts.halfRest,
      airlineRotationFacts: {
        positionRules: state.positionRules,
      },
      minimumFlightTransitionFacts: {
        flights: state.flights,
        positionRules: state.positionRules,
        settings: state.settings,
      },
      lateShiftCutoffFacts: {
        state,
        date,
        crossDayRecovery: preparation.runFacts.crossDayRecovery,
      },
      crossWorkdayQualificationReservationFacts: { state },
      latePriorityFrequencyFacts: {
        state,
        date,
        scheduleFrequency: preparation.runFacts.scheduleFrequency,
      },
      latePriorityAggregateRotationFacts: {
        state,
        date,
        scheduleFrequency: preparation.runFacts.scheduleFrequency,
      },
      strictNextWorkdayRecoveryFacts: {
        state,
        date,
        crossDayRecovery: preparation.runFacts.crossDayRecovery,
        halfRestFacts: preparation.runFacts.halfRest,
      },
      highFatiguePositionFacts: {
        state,
        date,
        scheduleFrequency: preparation.runFacts.scheduleFrequency,
      },
      positionTransitionFacts: { state },
      positionFrequencyFacts: {
        state,
        date,
      },
      workloadBalanceFacts: {
        state,
        date,
        dutyStaffId: preparation.runFacts.currentDutyStaffId,
      },
      sameDayLateObligationFacts: { state, date },
      lateShiftPositionReliefFacts: { state, date },
      mobileSupervisorCoverageFacts: { state, date },
      ke166SnapshotFacts: { state, date },
      scarceQualificationFacts: { state, date },
      dutyPositionFacts: { state, date },
      warningSink: guardWarnings,
    },
  });
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

  let mobileSupervisorsFinalized = false;
  return finalizeSchedule({
    solver,
    state,
    date,
    ledger,
    guards,
    guardWarnings,
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
    finalizeMobileSupervisors: async () => {
      if (mobileSupervisorsFinalized) return;
      const assignments = ledger
        .snapshot()
        .map((assignment) => structuredClone(assignment));
      await finalizeMobileSupervisors({
        solver,
        state,
        date,
        assignments,
        preparation,
        lockedAssignmentIds: plan.lockedAssignmentIds,
      });
      ledger.commit({ type: "replace", assignments });
      mobileSupervisorsFinalized = true;
    },
    reportProgress,
    scheduleRunId,
  });
}

export async function generateSchedule(
  state: ScheduleGenerationFacts,
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
    evaluateAutomaticHardConstraints,
    options.preferences
  );
  reportProgress("optimize", scheduleProgressPercent("optimize"));

  let pendingCheckpoint: DailySchedulePlan | null = null;
  const scheduleRunId = createId("schedule-run");
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
            scheduleRunId,
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
    scheduleRunId,
  });
  reportProgress("complete", scheduleProgressPercent("complete"));
  return result;
}
