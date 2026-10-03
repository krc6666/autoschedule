import type {
  Assignment,
  Flight,
  PositionRule,
  ScheduleResult,
} from "../../model";
import type { ScheduleGenerationFacts } from "../shared/scheduling-facts";
import {
  assignmentDecisionMessages,
  attachAssignmentDecisionEvidence,
} from "../assignments/assignment-evidence";
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
import type { ScheduleSafetySession } from "./schedule-safety-session";
import { scheduleRuleFingerprint } from "../rules/schedule-rule-fingerprint";
import { enforceDailyFlightCountBalance } from "../assignments/daily-flight-count-balance";

export interface ScheduleFinalizerOptions {
  solver: SolverPort;
  state: ScheduleGenerationFacts;
  date: string;
  ledger: ScheduleLedger;
  safetySession: ScheduleSafetySession;
  warnings: string[];
  flights: readonly Flight[];
  displayRulesByFlight: ReadonlyMap<string, readonly PositionRule[]>;
  lockedAssignmentIds: Set<string>;
  dailyFlightCountBalanceFallback: boolean;
  candidateStaffIds: ReadonlySet<string>;
  runFacts: ScheduleRunFacts;
  automaticTasks: readonly AssignmentTask[];
  preservedAssignments: readonly Assignment[];
  optimizationQuality: DailySchedulePlan["optimizationQuality"];
  finalizeMobileSupervisors: () => Promise<void>;
  reportProgress: (stage: ScheduleProgressStage, percent: number) => void;
  scheduleRunId: string;
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
    if (assignment.status === "unfilled" && assignment.systemNotes?.length) {
      const category = assignmentRule(state, assignment)?.category;
      const baseWarning = `${assignment.flightNo} / ${assignment.position} ${category === "\u5f15\u5bfc" ? "\u6ca1\u6709\u53ef\u590d\u7528\u7684\u5e38\u89c4\u4eba\u5458" : "\u65e0\u53ef\u7528\u4eba\u5458"}`;
      return [
        baseWarning,
        ...assignment.systemNotes.map(
          (note) => `${assignment.flightNo} / ${assignment.position} ${note}`
        ),
      ];
    }
    if (assignment.systemNotes?.length)
      return assignment.systemNotes.map(
        (note) => `${assignment.flightNo} / ${assignment.position} ${note}`
      );
    if (assignment.status !== "unfilled") return [];
    const category = assignmentRule(state, assignment)?.category;
    return [
      `${assignment.flightNo} / ${assignment.position} ${category === "引导" ? "没有可复用的常规人员" : "无可用人员"}`,
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
  safetySession,
  warnings,
  flights,
  displayRulesByFlight,
  lockedAssignmentIds,
  candidateStaffIds,
  runFacts,
  automaticTasks,
  preservedAssignments,
  optimizationQuality,
  finalizeMobileSupervisors,
  reportProgress,
  scheduleRunId,
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
    finalizeMobileSupervisors,
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
  // Recheck after every coverage, rotation, and KE166 mutation. Those stages
  // can add a valid same-flight reuse or a new flight after the solver plan.
  // The shared fallback only releases unlocked flight groups and records why.
  const balance = enforceDailyFlightCountBalance(state, assignments, {
    dutyStaffId: runFacts.currentDutyStaffId,
    halfRestStaffIds: runFacts.halfRest.activeStaffIds,
    lockedAssignmentIds,
    candidateStaffIds,
    useFullEligibility: true,
  });
  if (balance.spread > 1) {
    throw new Error(
      `最终班表航班数差值为 ${balance.spread}，无法在不移动锁定岗位的情况下满足差值不超过 1`
    );
  }
  applyPreNoonDecisionNotes(state, assignments);
  sortAssignments(assignments, flights, displayRulesByFlight);
  ledger.commit({ type: "replace", assignments });
  const resultAssignments = workingAssignments(ledger);
  const ruleFingerprint = scheduleRuleFingerprint(state);
  resultAssignments.forEach((assignment) =>
    attachAssignmentDecisionEvidence(assignment, {
      scheduleRunId,
      ruleFingerprint,
    })
  );
  ledger.commit({ type: "replace", assignments: resultAssignments });
  safetySession.resetWarnings();
  safetySession.assertAssignmentsSafe(resultAssignments);
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
      [...warnings.filter(isHalfRestWarning), ...safetySession.warnings()]
    )
  );
  return {
    assignments: resultAssignments,
    unfilledCount: resultAssignments.filter(
      (assignment) => assignment.status === "unfilled"
    ).length,
    warnings: [...warnings],
    safetyCredential: safetySession.createCredential(date, resultAssignments),
  };
}
