import type { Assignment, Flight, PositionRule } from "../../model";
import { diagnoseBaseAssignmentEligibility } from "../candidates/assignment-eligibility";
import type { CandidatePriority } from "../candidates/candidate-priority";
import { assignmentRule } from "../flights/schedule-position-rules";
import { isPreNoonFlight } from "../flights/schedule-tasks";
import type { ScheduleRunPreferences } from "../shared/schedule-run-preferences";
import type { ScheduleGenerationFacts } from "../shared/scheduling-facts";
import { timeToMinutes } from "../shared/time";
import { isStrictNextWorkdayRecoveryTarget } from "../reviews/cross-day-recovery";
import type {
  DecisionVariable,
  LexicographicObjective,
  LinearConstraint,
} from "../solver/solver-port";

export interface HalfRestFacts {
  requestedStaffIds: readonly string[];
  activeStaffIds: ReadonlySet<string>;
  ignoredWarnings: readonly string[];
}

export interface HalfRestChoiceFact {
  variableId: string;
  staffId: string;
  startTime: string;
  endTime: string;
}

export interface HalfRestOptimizationModel {
  variables: readonly DecisionVariable[];
  constraints: readonly LinearConstraint[];
  objectives: readonly LexicographicObjective[];
}

export const HALF_REST_WARNING_PREFIX = "半休安排：";

export function isHalfRestWarning(message: string): boolean {
  return message.includes(HALF_REST_WARNING_PREFIX);
}

export function createHalfRestFacts(
  state: ScheduleGenerationFacts,
  preferences: ScheduleRunPreferences,
  dutyStaffId: string | null
): HalfRestFacts {
  const activeStaffIds = new Set<string>();
  const ignoredWarnings: string[] = [];
  for (const staffId of preferences.halfRestStaffIds) {
    const person = state.staff.find((item) => item.id === staffId);
    if (!person) {
      ignoredWarnings.push(
        `${HALF_REST_WARNING_PREFIX}已选择的人员不存在，本次已忽略`
      );
      continue;
    }
    if (person.staffType !== "常规" || person.status !== "正常") {
      ignoredWarnings.push(
        `${HALF_REST_WARNING_PREFIX}${person.name}不是正常在岗的常规人员，本次不能设置半休`
      );
      continue;
    }
    if (person.id === dutyStaffId) {
      ignoredWarnings.push(
        `${HALF_REST_WARNING_PREFIX}${person.name}是当日值班人员，值班岗位优先，本次不能设置半休`
      );
      continue;
    }
    activeStaffIds.add(person.id);
  }
  return {
    requestedStaffIds: preferences.halfRestStaffIds,
    activeStaffIds,
    ignoredWarnings,
  };
}

export function restrictHalfRestToMorningCandidates(
  state: ScheduleGenerationFacts,
  facts: HalfRestFacts,
  morningEligibleStaffIds: ReadonlySet<string>
): HalfRestFacts {
  const activeStaffIds = new Set(
    [...facts.activeStaffIds].filter((staffId) =>
      morningEligibleStaffIds.has(staffId)
    )
  );
  const missingMorningWarnings = [...facts.activeStaffIds]
    .filter((staffId) => !activeStaffIds.has(staffId))
    .map((staffId) => {
      const name = state.staff.find((person) => person.id === staffId)?.name;
      return `${HALF_REST_WARNING_PREFIX}${name ?? "所选人员"}没有可合法承担的12点前岗位，本次已按普通人员参加排班`;
    });
  return {
    ...facts,
    activeStaffIds,
    ignoredWarnings: [...facts.ignoredWarnings, ...missingMorningWarnings],
  };
}

export function hasHalfRestRecoveryConflict(
  priority: CandidatePriority
): boolean {
  return (
    priority.lateShiftRecovery.protectedMorningTarget ||
    priority.lateShiftRecovery.protectedLatePriorityTarget ||
    priority.lateShiftCutoff.disposition === "after-cutoff"
  );
}

export function excludeCandidateForHalfRest(options: {
  facts: HalfRestFacts;
  staffId: string;
  preNoon: boolean;
  priority: CandidatePriority;
}): boolean {
  const selected = options.facts.activeStaffIds.has(options.staffId);
  const recoveryConflict = hasHalfRestRecoveryConflict(options.priority);
  return selected && (recoveryConflict || !options.preNoon);
}

export function halfRestBackfillStaffIds(options: {
  state: ScheduleGenerationFacts;
  facts: HalfRestFacts;
  flight: Flight;
  rule: PositionRule;
}): readonly string[] {
  if (isPreNoonFlight(options.flight)) return [];
  return [...options.facts.activeStaffIds].filter((staffId) => {
    const person = options.state.staff.find((item) => item.id === staffId);
    return Boolean(
      person &&
      diagnoseBaseAssignmentEligibility(
        options.state,
        options.flight,
        options.rule,
        person
      ).eligible
    );
  });
}

export function isStrictRecoveryHalfRestBackfill(options: {
  state: ScheduleGenerationFacts;
  facts: HalfRestFacts;
  protectedStaffIds: ReadonlySet<string>;
  staffId: string;
  flight: Flight;
  rule: PositionRule;
}): boolean {
  return (
    !options.facts.activeStaffIds.has(options.staffId) &&
    options.protectedStaffIds.has(options.staffId) &&
    isStrictNextWorkdayRecoveryTarget(options.state, {
      flightNo: options.flight.flightNo,
      position: options.rule.name,
      remark: options.rule.remark,
    }) &&
    halfRestBackfillStaffIds(options).length > 0
  );
}

export function strictRecoveryHalfRestBackfillCount(options: {
  state: ScheduleGenerationFacts;
  assignments: readonly Assignment[];
  facts: HalfRestFacts;
  protectedStaffIds: ReadonlySet<string>;
}): number {
  return options.assignments.filter((assignment) => {
    if (assignment.status !== "assigned" || !assignment.staffId) return false;
    const flight = options.state.flights.find(
      (item) => item.id === assignment.flightId
    );
    const rule = assignmentRule(options.state, assignment);
    return Boolean(
      flight &&
      rule &&
      isStrictRecoveryHalfRestBackfill({
        state: options.state,
        facts: options.facts,
        protectedStaffIds: options.protectedStaffIds,
        staffId: assignment.staffId,
        flight,
        rule,
      })
    );
  }).length;
}

function operationalEndMinutes(startTime: string, endTime: string): number {
  const start = timeToMinutes(startTime);
  let end = timeToMinutes(endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  if (end <= start) end += 24 * 60;
  return end;
}

export function buildHalfRestOptimizationModel(
  facts: HalfRestFacts,
  choices: readonly HalfRestChoiceFact[]
): HalfRestOptimizationModel {
  const variables: DecisionVariable[] = [];
  const constraints: LinearConstraint[] = [];
  const participationTerms: Array<{
    variableId: string;
    coefficient: number;
  }> = [];
  const latestEndTerms: Array<{ variableId: string; coefficient: number }> = [];

  for (const staffId of facts.activeStaffIds) {
    const staffChoices = choices.filter((choice) => choice.staffId === staffId);
    const morningChoices = staffChoices.filter((choice) =>
      isPreNoonFlight({ startTime: choice.startTime })
    );
    if (!morningChoices.length) continue;
    const workedId = `half-rest:worked:${staffId}`;
    const latestEndId = `half-rest:latest-end:${staffId}`;
    variables.push(
      { id: workedId, type: "binary" },
      {
        id: latestEndId,
        type: "continuous",
        lowerBound: 0,
        upperBound: 2 * 24 * 60,
        lowerEnvelope: true,
      }
    );
    constraints.push({
      id: `half-rest:morning-work:${staffId}`,
      terms: [
        { variableId: workedId, coefficient: 1 },
        ...morningChoices.map((choice) => ({
          variableId: choice.variableId,
          coefficient: -1,
        })),
      ],
      upperBound: 0,
    });
    for (const choice of staffChoices) {
      constraints.push({
        id: `half-rest:latest-end:${staffId}:${choice.variableId}`,
        terms: [
          { variableId: latestEndId, coefficient: 1 },
          {
            variableId: choice.variableId,
            coefficient: -operationalEndMinutes(
              choice.startTime,
              choice.endTime
            ),
          },
        ],
        lowerBound: 0,
      });
    }
    participationTerms.push({ variableId: workedId, coefficient: 1 });
    latestEndTerms.push({ variableId: latestEndId, coefficient: 1 });
  }

  const objectives: LexicographicObjective[] = [];
  if (participationTerms.length) {
    objectives.push({
      id: "half-rest-morning:participation",
      direction: "maximize",
      terms: participationTerms,
    });
  }
  if (latestEndTerms.length) {
    objectives.push({
      id: "half-rest-early-finish:latest-end",
      direction: "minimize",
      terms: latestEndTerms,
    });
  }
  return { variables, constraints, objectives };
}

function latestAssignedEnd(
  assignments: readonly Assignment[],
  staffId: string
): number {
  return Math.max(
    0,
    ...assignments
      .filter(
        (assignment) =>
          assignment.status === "assigned" && assignment.staffId === staffId
      )
      .map((assignment) =>
        operationalEndMinutes(assignment.startTime, assignment.endTime)
      )
  );
}

export function halfRestRegressionReasons(
  before: readonly Assignment[],
  after: readonly Assignment[],
  facts: HalfRestFacts
): string[] {
  const reasons: string[] = [];
  for (const staffId of facts.activeStaffIds) {
    const hadMorning = before.some(
      (assignment) =>
        assignment.status === "assigned" &&
        assignment.staffId === staffId &&
        isPreNoonFlight(assignment)
    );
    const hasMorning = after.some(
      (assignment) =>
        assignment.status === "assigned" &&
        assignment.staffId === staffId &&
        isPreNoonFlight(assignment)
    );
    if (hadMorning && !hasMorning)
      reasons.push("调整会使半休人员失去12点前岗位");
    if (latestAssignedEnd(after, staffId) > latestAssignedEnd(before, staffId))
      reasons.push("调整会推迟半休人员的最终下班时间");
  }
  return [...new Set(reasons)];
}

export function halfRestBackfillRejectionReason(options: {
  state: ScheduleGenerationFacts;
  target: Assignment;
  facts: HalfRestFacts;
}): string | null {
  const flight = options.state.flights.find(
    (item) => item.id === options.target.flightId
  );
  const rule = assignmentRule(options.state, options.target);
  if (!flight || !rule || !options.facts.activeStaffIds.size) return null;
  return halfRestBackfillStaffIds({
    state: options.state,
    facts: options.facts,
    flight,
    rule,
  }).length
    ? "该岗位的其他资质人员已设置半休，不能重新安排到后续岗位"
    : null;
}
