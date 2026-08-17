import type { Assignment, Flight, PositionRule, Staff } from "../../model";
import type { ScheduleGenerationFacts } from "../shared/scheduling-facts";
import { assignmentRule } from "../flights/schedule-position-rules";
import type { ScheduleRunFacts } from "../shared/schedule-run-facts";
import { durationHours, timeToMinutes } from "../shared/time";
import { countedWorkloadAssignments } from "../shared/workload-accounting";
import { optimizeReassignment } from "../solver/reassignment-optimizer";
import type { SolverPort } from "../solver/solver-port";
import type { RotationStaffChange } from "../reviews/rotation-review-safety";

export interface PlannedConcurrentChange extends RotationStaffChange {
  assignment: Assignment;
  person: Staff;
  startTime: string;
  endTime: string;
  workHours: number;
  status: "assigned";
}

export interface ConcurrentSupervisionCandidate {
  leader: Staff;
  supervisorAssignments: readonly [Assignment, Assignment];
  changes: PlannedConcurrentChange[];
  vacancy: Assignment;
  overlapMinutes: number;
  vacancyReduction: number;
  leaderHours: number;
  leaderFatigue: number;
  staffOrder: number;
  stableKey: string;
}

export function isKe166(flight: Pick<Flight, "flightNo"> | undefined): boolean {
  return Boolean(flight && /^KE\s*166$/i.test(flight.flightNo.trim()));
}

export function isConcurrentSupervisor(
  rule: PositionRule | undefined,
  flight: Flight | undefined
): rule is PositionRule {
  return Boolean(
    rule &&
    flight &&
    (rule.category === "常规" || rule.category === "分流") &&
    !rule.manual &&
    !isKe166(flight) &&
    `${rule.name} ${rule.remark}`.includes("督导")
  );
}

function intervalBounds(startTime: string, endTime: string): [number, number] {
  const start = timeToMinutes(startTime);
  let end = timeToMinutes(endTime);
  if (end <= start) end += 24 * 60;
  return [start, end];
}

export function concurrentOverlapMinutes(
  state: ScheduleGenerationFacts,
  left: Assignment,
  right: Assignment
): number {
  const leftFlight = state.flights.find(
    (flight) => flight.id === left.flightId
  );
  const rightFlight = state.flights.find(
    (flight) => flight.id === right.flightId
  );
  if (!leftFlight || !rightFlight) return 0;
  const [leftStart, leftEnd] = intervalBounds(
    leftFlight.startTime,
    leftFlight.endTime
  );
  const [rightStart, rightEnd] = intervalBounds(
    rightFlight.startTime,
    rightFlight.endTime
  );
  return Math.max(
    0,
    Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart),
    Math.min(leftEnd, rightEnd + 24 * 60) -
      Math.max(leftStart, rightStart + 24 * 60),
    Math.min(leftEnd + 24 * 60, rightEnd) -
      Math.max(leftStart + 24 * 60, rightStart)
  );
}

function isMovableAssignment(
  state: ScheduleGenerationFacts,
  assignment: Assignment,
  lockedAssignmentIds: ReadonlySet<string>
): boolean {
  const flight = state.flights.find((item) => item.id === assignment.flightId);
  const rule = assignmentRule(state, assignment);
  return Boolean(
    assignment.status === "assigned" &&
    assignment.staffId &&
    !lockedAssignmentIds.has(assignment.id) &&
    assignment.supervisorSourceAssignmentId === undefined &&
    flight &&
    !isKe166(flight) &&
    rule &&
    !rule.manual &&
    (rule.category === "常规" || isConcurrentSupervisor(rule, flight))
  );
}

function pairChanges(
  state: ScheduleGenerationFacts,
  pair: readonly [Assignment, Assignment],
  leader: Staff,
  overlapMinutes: number
): PlannedConcurrentChange[] {
  const ordered = [...pair].sort(
    (left, right) =>
      timeToMinutes(left.startTime) - timeToMinutes(right.startTime)
  );
  return ordered.map((assignment, index) => {
    const flight = state.flights.find(
      (item) => item.id === assignment.flightId
    )!;
    const fullHours = durationHours(flight.startTime, flight.endTime);
    return {
      assignmentId: assignment.id,
      staffId: leader.id,
      assignment,
      person: leader,
      startTime: flight.startTime,
      endTime: flight.endTime,
      workHours:
        index === 0 ? fullHours : Math.max(0, fullHours - overlapMinutes / 60),
      status: "assigned",
    };
  });
}

function completeChange(
  state: ScheduleGenerationFacts,
  assignments: readonly Assignment[],
  change: RotationStaffChange
): PlannedConcurrentChange {
  const assignment = assignments.find(
    (item) => item.id === change.assignmentId
  )!;
  const person = state.staff.find((item) => item.id === change.staffId)!;
  const flight = state.flights.find((item) => item.id === assignment.flightId)!;
  return {
    ...change,
    assignment,
    person,
    startTime: change.startTime ?? flight.startTime,
    endTime: change.endTime ?? flight.endTime,
    workHours:
      change.workHours ?? durationHours(flight.startTime, flight.endTime),
    status: "assigned",
  };
}

function currentLoad(
  state: ScheduleGenerationFacts,
  assignments: readonly Assignment[],
  staffId: string,
  field: "workHours" | "fatiguePoints"
): number {
  return countedWorkloadAssignments(state, [...assignments])
    .filter((assignment) => assignment.staffId === staffId)
    .reduce((sum, assignment) => sum + assignment[field], 0);
}

export async function findConcurrentSupervisionPlan(options: {
  solver: SolverPort;
  state: ScheduleGenerationFacts;
  assignments: Assignment[];
  leader: Staff;
  pair: readonly [Assignment, Assignment];
  vacancy: Assignment;
  overlapMinutes: number;
  date: string;
  lockedAssignmentIds: ReadonlySet<string>;
  facts: ScheduleRunFacts;
}): Promise<ConcurrentSupervisionCandidate | null> {
  const {
    solver,
    state,
    assignments,
    leader,
    pair,
    vacancy,
    overlapMinutes,
    date,
    lockedAssignmentIds,
    facts,
  } = options;
  const pairAssignmentIds = new Set(pair.map((assignment) => assignment.id));
  const concurrentChanges = pairChanges(state, pair, leader, overlapMinutes);
  const pairChangeById = new Map(
    concurrentChanges.map((change) => [change.assignmentId, change])
  );
  const movableAssignments = assignments.filter(
    (assignment) =>
      assignment.id !== vacancy.id &&
      isMovableAssignment(state, assignment, lockedAssignmentIds)
  );
  const result = await optimizeReassignment({
    solver,
    state,
    assignments,
    primary: vacancy,
    movableAssignments,
    date,
    review: "coverage",
    facts,
    permittedConcurrentAssignmentIds: pairAssignmentIds,
    coupledAssignmentGroups: [[pair[0].id, pair[1].id]],
    candidateAllowed: (assignment, person) => {
      if (pairAssignmentIds.has(assignment.id)) return person.id === leader.id;
      if (person.id !== leader.id) return true;
      if (assignment.staffId !== leader.id) return false;
      return pair.every(
        (supervisorAssignment) =>
          concurrentOverlapMinutes(state, assignment, supervisorAssignment) ===
          0
      );
    },
    primaryCandidateAllowed: (person) => person.id !== leader.id,
    compareCandidates: (_assignment, left, right) =>
      state.staff.findIndex((person) => person.id === left.id) -
        state.staff.findIndex((person) => person.id === right.id) ||
      left.id.localeCompare(right.id, undefined, { numeric: true }),
    choiceWorkHours: (assignment, person) => {
      const pairChange = pairChangeById.get(assignment.id);
      if (pairChange && person.id === leader.id) return pairChange.workHours;
      if (assignment.staffId === person.id) return assignment.workHours;
      const flight = state.flights.find(
        (item) => item.id === assignment.flightId
      )!;
      return durationHours(flight.startTime, flight.endTime);
    },
    normalizeChanges: (changes) => {
      const normalized = new Map(
        changes.map((change) => [change.assignmentId, change])
      );
      concurrentChanges.forEach((change) =>
        normalized.set(change.assignmentId, change)
      );
      return [...normalized.values()].map((change) => {
        const pairChange = pairChangeById.get(change.assignmentId);
        if (pairChange) return pairChange;
        const assignment = assignments.find(
          (item) => item.id === change.assignmentId
        )!;
        const flight = state.flights.find(
          (item) => item.id === assignment.flightId
        )!;
        return {
          ...change,
          startTime: flight.startTime,
          endTime: flight.endTime,
          workHours: durationHours(flight.startTime, flight.endTime),
          status: "assigned" as const,
        };
      });
    },
    validateChanges: (changes) => {
      const staffByAssignmentId = new Map(
        changes.map((change) => [change.assignmentId, change.staffId])
      );
      const pairIsValid = pair.every(
        (assignment) =>
          (staffByAssignmentId.get(assignment.id) ?? assignment.staffId) ===
          leader.id
      );
      const vacancyIsFilled = staffByAssignmentId.has(vacancy.id);
      return [
        ...(pairIsValid ? [] : ["两个督导岗位未由同一分队长承担"]),
        ...(vacancyIsFilled ? [] : ["目标空缺未被补齐"]),
      ];
    },
    maxParticipants: 3,
    timeoutMs: 4_000,
  });
  if (!result.changes) return null;

  const changes = result.changes.map((change) =>
    completeChange(state, assignments, change)
  );
  return {
    leader,
    supervisorAssignments: pair,
    changes,
    vacancy,
    overlapMinutes,
    vacancyReduction: 1,
    leaderHours: currentLoad(state, assignments, leader.id, "workHours"),
    leaderFatigue: currentLoad(state, assignments, leader.id, "fatiguePoints"),
    staffOrder: state.staff.findIndex((person) => person.id === leader.id),
    stableKey: changes
      .map((change) => `${change.assignmentId}:${change.staffId}`)
      .sort()
      .join("|"),
  };
}
