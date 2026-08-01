import type {
  AppState,
  Assignment,
  Flight,
  PositionRule,
  ScheduleResult,
} from "../../model";
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

export interface ScheduleFinalizerOptions {
  solver: SolverPort;
  state: AppState;
  date: string;
  ledger: ScheduleLedger;
  warnings: string[];
  flights: readonly Flight[];
  displayRulesByFlight: ReadonlyMap<string, readonly PositionRule[]>;
  lockedAssignmentIds: Set<string>;
  runFacts: ScheduleRunFacts;
  finalizeKe166Supervisor: () => Promise<void>;
  reportProgress: (stage: ScheduleProgressStage, percent: number) => void;
}

function workingAssignments(ledger: ScheduleLedger): Assignment[] {
  return ledger
    .snapshot()
    .map((assignment) => structuredClone(assignment) as Assignment);
}

function applyPreNoonDecisionNotes(
  state: AppState,
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
  state: AppState,
  assignments: readonly Assignment[],
  postReviewWarnings: readonly string[]
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
  return [...new Set([...warnings, ...postReviewWarnings])];
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
  warnings,
  flights,
  displayRulesByFlight,
  lockedAssignmentIds,
  runFacts,
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
  warnings.splice(
    0,
    warnings.length,
    ...rebuildWarnings(state, resultAssignments, postReviewWarnings)
  );
  return {
    assignments: resultAssignments,
    unfilledCount: resultAssignments.filter(
      (assignment) => assignment.status === "unfilled"
    ).length,
    warnings: [...warnings],
  };
}
