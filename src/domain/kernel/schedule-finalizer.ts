import type {
  Assignment,
  Flight,
  PositionRule,
  ScheduleResult,
} from "../../model";
import type { ScheduleGenerationFacts } from "../shared/scheduling-facts";
import { assignmentDecisionMessages } from "../assignments/assignment-evidence";
import { strictOverrideNotes } from "../assignments/schedule-decision-notes";
import type { ScheduleLedger } from "./schedule-ledger";
import {
  runCoveragePipeline,
  runPostSchedulePipeline,
} from "./schedule-pipeline";
import { assignmentRule } from "../flights/schedule-position-rules";
import type { ScheduleProgressStage } from "./schedule-progress";
import type { ScheduleRunFacts } from "../shared/schedule-run-facts";
import { isPreNoonFlight } from "../flights/schedule-tasks";
import type { SolverPort } from "../solver/solver-port";
import {
  crossWorkdayReservationStatuses,
  crossWorkdayReservationWarning,
} from "../reviews/cross-workday-qualification-reservation";
import type { AssignmentTask } from "../flights/schedule-tasks";
import type { DailySchedulePlan } from "./daily-schedule-result";
import { assertDailyScheduleSafety } from "./daily-schedule-safety";
import { evaluateAutomaticHardConstraints } from "../rules/built-in-rule-registry";
import { scheduleOptimizationWarning } from "../reviews/schedule-warning-message";
import { isHalfRestWarning } from "../rules/half-rest";
import {
  assertScheduleAssignmentsSafe,
  type ScheduleGuard,
  type ScheduleGuardContext,
} from "./schedule-guard";
import { createScheduleSafetyCredential } from "./schedule-safety-credential";

export interface ScheduleFinalizerOptions {
  solver: SolverPort;
  state: ScheduleGenerationFacts;
  date: string;
  ledger: ScheduleLedger;
  guards: readonly ScheduleGuard[];
  guardWarnings: string[];
  warnings: string[];
  flights: readonly Flight[];
  displayRulesByFlight: ReadonlyMap<string, readonly PositionRule[]>;
  lockedAssignmentIds: Set<string>;
  runFacts: ScheduleRunFacts;
  automaticTasks: readonly AssignmentTask[];
  preservedAssignments: readonly Assignment[];
  optimizationQuality: DailySchedulePlan["optimizationQuality"];
  finalizeKe166Supervisor: () => Promise<void>;
  reportProgress: (stage: ScheduleProgressStage, percent: number) => void;
}

function workingAssignments(ledger: ScheduleLedger): Assignment[] {
  return ledger
    .snapshot()
    .map((assignment) => structuredClone(assignment) as Assignment);
}

function applyPreNoonDecisionNotes(
  state: ScheduleGenerationFacts,
  assignments: Assignment[]
): void {
  assignments
    .filter(
      (assignment) =>
        assignment.status === "assigned" &&
        assignment.staffId &&
        isPreNoonFlight(assignment)
    )
    .forEach((assignment) => {
      const rule = assignmentRule(state, assignment);
      const flight = state.flights.find(
        (item) => item.id === assignment.flightId
      );
      const person = state.staff.find((item) => item.id === assignment.staffId);
      if (!rule || rule.category !== "常规" || !flight || !person) return;
      const preserved = (assignment.systemNotes ?? []).filter(
        (note) => !note.startsWith("已突破严格限制仍安排：")
      );
      const strictNotes = strictOverrideNotes(
        state,
        assignments.filter((item) => item.id !== assignment.id),
        person,
        { key: `${flight.id}:${rule.id}`, flight, rule }
      );
      assignment.systemNotes = [...preserved, ...strictNotes];
      if (!assignment.systemNotes.length) delete assignment.systemNotes;
    });
}

function rebuildWarnings(
  state: ScheduleGenerationFacts,
  assignments: readonly Assignment[],
  postReviewWarnings: readonly string[],
  optimizationQuality: DailySchedulePlan["optimizationQuality"],
  persistentRunWarnings: readonly string[]
): string[] {
  const warnings = assignments.flatMap((assignment) => {
    if (assignment.systemNotes?.length)
      return assignment.systemNotes.map(
        (note) => `${assignment.flightNo} / ${assignment.position} ${note}`
      );
    if (assignment.status !== "unfilled") return [];
    const category = assignmentRule(state, assignment)?.category;
    return [
      `${assignment.flightNo} / ${assignment.position} ${category === "引导" ? "没有可复用的常规岗位人员" : "无可用人员"}`,
    ];
  });
  const reservationWarnings = crossWorkdayReservationStatuses(
    state,
    assignments
  )
    .filter((status) => status.shortfall > 0)
    .map(crossWorkdayReservationWarning);
  const optimizationWarning = scheduleOptimizationWarning(optimizationQuality);
  return [
    ...new Set([
      ...warnings,
      ...reservationWarnings,
      ...postReviewWarnings,
      ...persistentRunWarnings,
      ...(optimizationWarning ? [optimizationWarning] : []),
    ]),
  ];
}

function sortAssignments(
  assignments: Assignment[],
  flights: readonly Flight[],
  displayRulesByFlight: ReadonlyMap<string, readonly PositionRule[]>
): void {
  const flightOrder = new Map(
    flights.map((flight, index) => [flight.id, index])
  );
  assignments.sort(
    (left, right) =>
      (flightOrder.get(left.flightId) ?? flights.length) -
        (flightOrder.get(right.flightId) ?? flights.length) ||
      ((displayRulesByFlight
        .get(left.flightId)
        ?.findIndex((rule) => rule.id === left.positionRuleId) ?? -1) + 1 ||
        Number.MAX_SAFE_INTEGER) -
        ((displayRulesByFlight
          .get(right.flightId)
          ?.findIndex((rule) => rule.id === right.positionRuleId) ?? -1) + 1 ||
          Number.MAX_SAFE_INTEGER)
  );
}

export async function finalizeSchedule({
  solver,
  state,
  date,
  ledger,
  guards,
  guardWarnings,
  warnings,
  flights,
  displayRulesByFlight,
  lockedAssignmentIds,
  runFacts,
  automaticTasks,
  preservedAssignments,
  optimizationQuality,
  finalizeKe166Supervisor,
  reportProgress,
}: ScheduleFinalizerOptions): Promise<ScheduleResult> {
  const pipelineContext = {
    solver,
    state,
    ledger,
    date,
    lockedAssignmentIds,
    runFacts,
    flights,
    displayRulesByFlight,
    finalizeKe166Supervisor,
    onProgress: reportProgress,
  };
  const postReviewWarnings = await runCoveragePipeline(pipelineContext);
  postReviewWarnings.push(...(await runPostSchedulePipeline(pipelineContext)));
  for (const message of assignmentDecisionMessages(ledger.snapshot(), {
    ruleIds: new Set(["position-rotation"]),
    outcomes: new Set(["fallback"]),
  })) {
    if (!postReviewWarnings.includes(message)) postReviewWarnings.push(message);
  }

  const assignments = workingAssignments(ledger);
  applyPreNoonDecisionNotes(state, assignments);
  sortAssignments(assignments, flights, displayRulesByFlight);
  ledger.commit({ type: "replace", assignments });
  const resultAssignments = workingAssignments(ledger);
  const finalGuardContext: ScheduleGuardContext = {
    phase: "final",
    halfRestFacts: runFacts.halfRest,
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
      crossDayRecovery: runFacts.crossDayRecovery,
    },
    crossWorkdayQualificationReservationFacts: { state },
    latePriorityFrequencyFacts: {
      state,
      date,
      scheduleFrequency: runFacts.scheduleFrequency,
    },
    latePriorityAggregateRotationFacts: {
      state,
      date,
      scheduleFrequency: runFacts.scheduleFrequency,
    },
    strictNextWorkdayRecoveryFacts: {
      state,
      date,
      crossDayRecovery: runFacts.crossDayRecovery,
      halfRestFacts: runFacts.halfRest,
    },
    highFatiguePositionFacts: {
      state,
      date,
      scheduleFrequency: runFacts.scheduleFrequency,
    },
    positionTransitionFacts: { state },
    positionFrequencyFacts: {
      state,
      date,
    },
    workloadBalanceFacts: {
      state,
      date,
      dutyStaffId: runFacts.currentDutyStaffId,
    },
    sameDayLateObligationFacts: { state, date },
    lateShiftPositionReliefFacts: { state, date },
    ke166SnapshotFacts: { state, date },
    scarceQualificationFacts: { state, date },
    dutyPositionFacts: { state, date },
    warningSink: guardWarnings,
  };
  guardWarnings.splice(0, guardWarnings.length);
  assertScheduleAssignmentsSafe({
    assignments: resultAssignments,
    context: finalGuardContext,
    guards,
  });
  assertDailyScheduleSafety({
    state,
    date,
    assignments: resultAssignments,
    tasks: automaticTasks,
    evaluateEligibility: evaluateAutomaticHardConstraints,
    allowFinalizedConcurrency: true,
    preservedAssignments,
    halfRestFacts: runFacts.halfRest,
  });
  warnings.splice(
    0,
    warnings.length,
    ...rebuildWarnings(
      state,
      resultAssignments,
      postReviewWarnings,
      optimizationQuality,
      [...warnings.filter(isHalfRestWarning), ...guardWarnings]
    )
  );
  return {
    assignments: resultAssignments,
    unfilledCount: resultAssignments.filter(
      (assignment) => assignment.status === "unfilled"
    ).length,
    warnings: [...warnings],
    safetyCredential: createScheduleSafetyCredential({
      date,
      assignments: resultAssignments,
      context: finalGuardContext,
    }),
  };
}
