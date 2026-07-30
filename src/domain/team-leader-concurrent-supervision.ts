import type {
  AppState,
  Assignment,
  Flight,
  PositionRule,
  Staff,
} from "../model";
import { eligibleStaffForRule } from "./assignment-eligibility";
import { assignmentRule, isGuideAssignment } from "./schedule-position-rules";
import type { ScheduleRunFacts } from "./schedule-run-facts";
import { schedulingDecision } from "../schedule-rule-contract";
import { appendAssignmentDecision } from "./assignment-evidence";
import { durationHours, intervalsOverlap, timeToMinutes } from "./time";
import { countedWorkloadAssignments } from "./workload-accounting";
import { reassignmentSafetyReasons } from "./rotation-review-safety";

const MAX_CONCURRENT_SUPERVISION_REASSIGNED_STAFF = 3;

interface PlannedChange {
  assignment: Assignment;
  person: Staff;
  startTime: string;
  endTime: string;
  workHours: number;
}

interface ConcurrentSupervisionCandidate {
  leader: Staff;
  supervisorAssignments: readonly [Assignment, Assignment];
  changes: PlannedChange[];
  vacancy: Assignment;
  overlapMinutes: number;
  vacancyReduction: number;
  leaderHours: number;
  leaderFatigue: number;
  staffOrder: number;
  stableKey: string;
}

function isKe166(flight: Pick<Flight, "flightNo"> | undefined): boolean {
  return Boolean(flight && /^KE\s*166$/i.test(flight.flightNo.trim()));
}

function isConcurrentSupervisor(
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

function isMovableRegularAssignment(
  state: AppState,
  assignment: Assignment,
  lockedAssignmentIds: ReadonlySet<string>
): boolean {
  const flight = state.flights.find((item) => item.id === assignment.flightId);
  const rule = assignmentRule(state, assignment);
  return (
    assignment.status === "assigned" &&
    Boolean(assignment.staffId) &&
    !lockedAssignmentIds.has(assignment.id) &&
    assignment.supervisorSourceAssignmentId === undefined &&
    Boolean(
      flight && !isKe166(flight) && rule?.category === "常规" && !rule.manual
    )
  );
}

function intervalBounds(startTime: string, endTime: string): [number, number] {
  const start = timeToMinutes(startTime);
  let end = timeToMinutes(endTime);
  if (end <= start) end += 24 * 60;
  return [start, end];
}

function overlapMinutes(
  state: AppState,
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

function countedHours(
  state: AppState,
  assignments: Assignment[],
  staffId: string
): number {
  return countedWorkloadAssignments(state, assignments)
    .filter((assignment) => assignment.staffId === staffId)
    .reduce((sum, assignment) => sum + assignment.workHours, 0);
}

function countedFatigue(
  state: AppState,
  assignments: Assignment[],
  staffId: string
): number {
  return countedWorkloadAssignments(state, assignments)
    .filter((assignment) => assignment.staffId === staffId)
    .reduce((sum, assignment) => sum + assignment.fatiguePoints, 0);
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  return items.flatMap((item, index) =>
    permutations(items.filter((_, itemIndex) => itemIndex !== index)).map(
      (remaining) => [item, ...remaining]
    )
  );
}

function plannedAssignments(
  assignments: Assignment[],
  changes: readonly PlannedChange[]
): Assignment[] {
  const changeByAssignmentId = new Map(
    changes.map((change) => [change.assignment.id, change])
  );
  return assignments.map((assignment) => {
    const change = changeByAssignmentId.get(assignment.id);
    return change
      ? {
          ...assignment,
          staffId: change.person.id,
          staffName: change.person.name,
          startTime: change.startTime,
          endTime: change.endTime,
          workHours: change.workHours,
          status: "assigned" as const,
        }
      : assignment;
  });
}

function eligibleForAssignment(
  state: AppState,
  person: Staff,
  assignment: Assignment
): boolean {
  const flight = state.flights.find((item) => item.id === assignment.flightId);
  const rule = assignmentRule(state, assignment);
  return Boolean(
    flight &&
    rule &&
    eligibleStaffForRule(state, flight, rule).some(
      (candidate) => candidate.id === person.id
    )
  );
}

function isSafePlan(
  state: AppState,
  assignments: Assignment[],
  changes: PlannedChange[],
  supervisorAssignments: readonly [Assignment, Assignment],
  date: string,
  lockedAssignmentIds: ReadonlySet<string>,
  facts: ScheduleRunFacts
): boolean {
  if (
    changes.some(
      (change) =>
        lockedAssignmentIds.has(change.assignment.id) &&
        change.assignment.staffId !== change.person.id
    )
  )
    return false;
  const changesForSafety = changes.map((change) => ({
    assignmentId: change.assignment.id,
    staffId: change.person.id,
    startTime: change.startTime,
    endTime: change.endTime,
    workHours: change.workHours,
    status: "assigned" as const,
  }));
  return (
    reassignmentSafetyReasons({
      kind: "plan",
      state,
      assignments,
      changes: changesForSafety,
      primaryAssignmentId:
        changes[0]?.assignment.id ?? supervisorAssignments[0].id,
      date,
      review: "coverage",
      facts,
      permittedConcurrentAssignmentIds: new Set(
        supervisorAssignments.map((assignment) => assignment.id)
      ),
    }).length === 0
  );
}

function supervisorPairChanges(
  state: AppState,
  pair: readonly [Assignment, Assignment],
  leader: Staff,
  overlap: number
): PlannedChange[] {
  const ordered = pair
    .slice()
    .sort(
      (left, right) =>
        timeToMinutes(left.startTime) - timeToMinutes(right.startTime)
    );
  const first = ordered[0]!;
  const second = ordered[1]!;
  const firstFlight = state.flights.find(
    (flight) => flight.id === first.flightId
  )!;
  const secondFlight = state.flights.find(
    (flight) => flight.id === second.flightId
  )!;
  return [
    {
      assignment: first,
      person: leader,
      startTime: firstFlight.startTime,
      endTime: firstFlight.endTime,
      workHours: durationHours(firstFlight.startTime, firstFlight.endTime),
    },
    {
      assignment: second,
      person: leader,
      startTime: secondFlight.startTime,
      endTime: secondFlight.endTime,
      workHours: Math.max(
        0,
        durationHours(secondFlight.startTime, secondFlight.endTime) -
          overlap / 60
      ),
    },
  ];
}

function assignmentChange(
  state: AppState,
  assignment: Assignment,
  person: Staff
): PlannedChange {
  const flight = state.flights.find((item) => item.id === assignment.flightId)!;
  return {
    assignment,
    person,
    startTime: flight.startTime,
    endTime: flight.endTime,
    workHours: durationHours(flight.startTime, flight.endTime),
  };
}

function makeCandidate(
  state: AppState,
  assignments: Assignment[],
  leader: Staff,
  pair: readonly [Assignment, Assignment],
  vacancy: Assignment,
  changes: PlannedChange[],
  overlap: number,
  date: string,
  lockedAssignmentIds: ReadonlySet<string>,
  facts: ScheduleRunFacts
): ConcurrentSupervisionCandidate | null {
  const uniqueChanges = [
    ...new Map(
      changes.map((change) => [change.assignment.id, change])
    ).values(),
  ];
  if (
    !isSafePlan(
      state,
      assignments,
      uniqueChanges,
      pair,
      date,
      lockedAssignmentIds,
      facts
    )
  )
    return null;
  const planned = plannedAssignments(assignments, uniqueChanges);
  const beforeVacancies = assignments.filter(
    (assignment) => assignment.status === "unfilled"
  ).length;
  const afterVacancies = planned.filter(
    (assignment) => assignment.status === "unfilled"
  ).length;
  const vacancyReduction = beforeVacancies - afterVacancies;
  if (vacancyReduction <= 0) return null;
  return {
    leader,
    supervisorAssignments: pair,
    changes: uniqueChanges,
    vacancy,
    overlapMinutes: overlap,
    vacancyReduction,
    leaderHours: countedHours(state, assignments, leader.id),
    leaderFatigue: countedFatigue(state, assignments, leader.id),
    staffOrder: state.staff.findIndex((item) => item.id === leader.id),
    stableKey: uniqueChanges
      .map((change) => `${change.assignment.id}:${change.person.id}`)
      .sort()
      .join("|"),
  };
}

function directCandidates(
  state: AppState,
  assignments: Assignment[],
  leader: Staff,
  pair: readonly [Assignment, Assignment],
  vacancy: Assignment,
  overlap: number,
  date: string,
  lockedAssignmentIds: ReadonlySet<string>,
  facts: ScheduleRunFacts
): ConcurrentSupervisionCandidate[] {
  const pairWorkers = pair
    .filter((assignment) => assignment.staffId !== leader.id)
    .map((assignment) =>
      state.staff.find((person) => person.id === assignment.staffId)
    )
    .filter((person): person is Staff => Boolean(person));
  const leaderConflicts = assignments.filter(
    (assignment) =>
      assignment.status === "assigned" &&
      assignment.staffId === leader.id &&
      !pair.some((target) => target.id === assignment.id) &&
      pair.some((target) => overlapMinutes(state, assignment, target) > 0)
  );
  const baseChanges = supervisorPairChanges(state, pair, leader, overlap);
  const candidates: ConcurrentSupervisionCandidate[] = [];

  if (pairWorkers.length === 1 && leaderConflicts.length === 0) {
    const candidate = makeCandidate(
      state,
      assignments,
      leader,
      pair,
      vacancy,
      [...baseChanges, assignmentChange(state, vacancy, pairWorkers[0]!)],
      overlap,
      date,
      lockedAssignmentIds,
      facts
    );
    if (candidate) candidates.push(candidate);
    return candidates;
  }

  if (
    pairWorkers.length !== 2 ||
    new Set(pairWorkers.map((person) => person.id)).size !== 2 ||
    leaderConflicts.length !== 1 ||
    !isMovableRegularAssignment(state, leaderConflicts[0]!, lockedAssignmentIds)
  )
    return candidates;

  const leaderSource = leaderConflicts[0]!;
  for (const workers of permutations(pairWorkers)) {
    const candidate = makeCandidate(
      state,
      assignments,
      leader,
      pair,
      vacancy,
      [
        ...baseChanges,
        assignmentChange(state, leaderSource, workers[0]!),
        assignmentChange(state, vacancy, workers[1]!),
      ],
      overlap,
      date,
      lockedAssignmentIds,
      facts
    );
    if (candidate) candidates.push(candidate);
  }

  const excludedAssignmentIds = new Set([
    ...pair.map((assignment) => assignment.id),
    leaderSource.id,
    vacancy.id,
  ]);
  const excludedStaffIds = new Set([
    leader.id,
    ...pairWorkers.map((person) => person.id),
  ]);
  const borrowedAssignments = assignments.filter(
    (assignment) =>
      !excludedAssignmentIds.has(assignment.id) &&
      isMovableRegularAssignment(state, assignment, lockedAssignmentIds) &&
      !excludedStaffIds.has(assignment.staffId!) &&
      overlapMinutes(state, assignment, vacancy) > 0
  );
  for (const borrowedAssignment of borrowedAssignments) {
    const borrowedPerson = state.staff.find(
      (person) => person.id === borrowedAssignment.staffId
    )!;
    const slots = [leaderSource, vacancy, borrowedAssignment] as const;
    for (const people of permutations([...pairWorkers, borrowedPerson])) {
      if (people[2]!.id === borrowedPerson.id) continue;
      const candidate = makeCandidate(
        state,
        assignments,
        leader,
        pair,
        vacancy,
        [
          ...baseChanges,
          ...slots.map((slot, index) =>
            assignmentChange(state, slot, people[index]!)
          ),
        ],
        overlap,
        date,
        lockedAssignmentIds,
        facts
      );
      if (candidate) candidates.push(candidate);
    }
  }
  return candidates;
}

function isRelocatableSlot(
  state: AppState,
  assignment: Assignment,
  lockedAssignmentIds: ReadonlySet<string>
): boolean {
  const flight = state.flights.find((item) => item.id === assignment.flightId);
  const rule = assignmentRule(state, assignment);
  return (
    assignment.status !== "manual" &&
    !lockedAssignmentIds.has(assignment.id) &&
    assignment.supervisorSourceAssignmentId === undefined &&
    Boolean(
      flight &&
      !isKe166(flight) &&
      rule &&
      !rule.manual &&
      (rule.category === "常规" || isConcurrentSupervisor(rule, flight))
    )
  );
}

function effectiveInterval(
  state: AppState,
  assignment: Assignment,
  plannedStaff: ReadonlyMap<string, string | null>
): Pick<Assignment, "startTime" | "endTime"> {
  if (plannedStaff.get(assignment.id) === assignment.staffId) return assignment;
  const flight = state.flights.find((item) => item.id === assignment.flightId)!;
  return { startTime: flight.startTime, endTime: flight.endTime };
}

function relocationCandidate(
  state: AppState,
  assignments: Assignment[],
  leader: Staff,
  pair: readonly [Assignment, Assignment],
  vacancy: Assignment,
  overlap: number,
  date: string,
  lockedAssignmentIds: ReadonlySet<string>,
  facts: ScheduleRunFacts
): ConcurrentSupervisionCandidate | null {
  const leaderConflicts = assignments.filter(
    (assignment) =>
      assignment.status === "assigned" &&
      assignment.staffId === leader.id &&
      !pair.some((target) => target.id === assignment.id) &&
      !isGuideAssignment(state, assignment) &&
      pair.some((target) => overlapMinutes(state, assignment, target) > 0)
  );
  const affectedFlightIds = new Set([
    pair[0].flightId,
    pair[1].flightId,
    vacancy.flightId,
    ...leaderConflicts.map((assignment) => assignment.flightId),
  ]);
  const mutable = assignments.filter(
    (assignment) =>
      affectedFlightIds.has(assignment.flightId) &&
      isRelocatableSlot(state, assignment, lockedAssignmentIds)
  );
  const mutableIds = new Set(mutable.map((assignment) => assignment.id));
  if (
    !mutableIds.has(vacancy.id) ||
    pair.some((assignment) => !mutableIds.has(assignment.id)) ||
    leaderConflicts.some((assignment) => !mutableIds.has(assignment.id))
  )
    return null;

  const requiredIds = new Set(
    mutable
      .filter(
        (assignment) => assignment.status === "assigned" && assignment.staffId
      )
      .map((assignment) => assignment.id)
  );
  requiredIds.add(vacancy.id);
  const fixedIds = new Set(pair.map((assignment) => assignment.id));
  const initial = new Map(
    mutable.map((assignment) => [assignment.id, assignment.staffId])
  );
  pair.forEach((assignment) => initial.set(assignment.id, leader.id));
  leaderConflicts.forEach((assignment) => initial.set(assignment.id, null));
  const assignmentOrder = new Map(
    assignments.map((assignment, index) => [assignment.id, index])
  );
  const memo = new Set<string>();

  const assignedStaffId = (
    assignment: Assignment,
    plannedStaff: ReadonlyMap<string, string | null>
  ) =>
    mutableIds.has(assignment.id)
      ? (plannedStaff.get(assignment.id) ?? null)
      : assignment.staffId;
  const conflictIdsFor = (
    slot: Assignment,
    person: Staff,
    plannedStaff: ReadonlyMap<string, string | null>
  ): string[] | null => {
    const flight = state.flights.find((item) => item.id === slot.flightId)!;
    const slotInterval = {
      startTime: flight.startTime,
      endTime: flight.endTime,
    };
    const conflicts = assignments.filter(
      (assignment) =>
        assignment.id !== slot.id &&
        assignedStaffId(assignment, plannedStaff) === person.id &&
        !isGuideAssignment(state, assignment) &&
        intervalsOverlap(
          effectiveInterval(state, assignment, plannedStaff).startTime,
          effectiveInterval(state, assignment, plannedStaff).endTime,
          slotInterval.startTime,
          slotInterval.endTime
        )
    );
    if (
      conflicts.some(
        (assignment) =>
          fixedIds.has(assignment.id) || !mutableIds.has(assignment.id)
      )
    )
      return null;
    return conflicts.map((assignment) => assignment.id);
  };

  const search = (
    plannedStaff: Map<string, string | null>,
    vacatedAssignmentIds: ReadonlySet<string>,
    reassignedStaffIds: ReadonlySet<string>
  ): ConcurrentSupervisionCandidate | null => {
    const key = mutable
      .map(
        (assignment) =>
          `${assignment.id}:${plannedStaff.get(assignment.id) ?? ""}`
      )
      .join("|");
    if (memo.has(key)) return null;
    memo.add(key);
    const openSlots = mutable.filter(
      (assignment) =>
        requiredIds.has(assignment.id) && !plannedStaff.get(assignment.id)
    );
    if (!openSlots.length) {
      const ordinaryChanges = mutable
        .filter(
          (assignment) =>
            plannedStaff.get(assignment.id) !== assignment.staffId &&
            !fixedIds.has(assignment.id)
        )
        .map((assignment) =>
          assignmentChange(
            state,
            assignment,
            state.staff.find(
              (person) => person.id === plannedStaff.get(assignment.id)
            )!
          )
        );
      const candidate = makeCandidate(
        state,
        assignments,
        leader,
        pair,
        vacancy,
        [
          ...ordinaryChanges,
          ...supervisorPairChanges(state, pair, leader, overlap),
        ],
        overlap,
        date,
        lockedAssignmentIds,
        facts
      );
      if (candidate) return candidate;
      return null;
    }
    if (reassignedStaffIds.size >= MAX_CONCURRENT_SUPERVISION_REASSIGNED_STAFF)
      return null;

    const slot = openSlots.sort((left, right) => {
      const leftFlight = state.flights.find(
        (flight) => flight.id === left.flightId
      )!;
      const rightFlight = state.flights.find(
        (flight) => flight.id === right.flightId
      )!;
      const leftRule = assignmentRule(state, left)!;
      const rightRule = assignmentRule(state, right)!;
      return (
        eligibleStaffForRule(state, leftFlight, leftRule).length -
          eligibleStaffForRule(state, rightFlight, rightRule).length ||
        (assignmentOrder.get(left.id) ?? 0) -
          (assignmentOrder.get(right.id) ?? 0)
      );
    })[0]!;
    const flight = state.flights.find((item) => item.id === slot.flightId)!;
    const rule = assignmentRule(state, slot)!;
    const people = eligibleStaffForRule(state, flight, rule)
      .filter((person) => person.id !== leader.id)
      .map((person) => ({
        person,
        conflicts: conflictIdsFor(slot, person, plannedStaff),
      }))
      .filter(
        (item): item is { person: Staff; conflicts: string[] } =>
          item.conflicts !== null &&
          item.conflicts.length <= 1 &&
          !reassignedStaffIds.has(item.person.id) &&
          item.conflicts.every(
            (assignmentId) => !vacatedAssignmentIds.has(assignmentId)
          )
      )
      .sort(
        (left, right) =>
          left.conflicts.length - right.conflicts.length ||
          state.staff.findIndex((person) => person.id === left.person.id) -
            state.staff.findIndex((person) => person.id === right.person.id)
      );
    for (const { person, conflicts } of people) {
      const next = new Map(plannedStaff);
      next.set(slot.id, person.id);
      conflicts.forEach((assignmentId) => next.set(assignmentId, null));
      const nextVacatedAssignmentIds = new Set(vacatedAssignmentIds);
      conflicts.forEach((assignmentId) =>
        nextVacatedAssignmentIds.add(assignmentId)
      );
      const nextReassignedStaffIds = new Set(reassignedStaffIds);
      nextReassignedStaffIds.add(person.id);
      const candidate = search(
        next,
        nextVacatedAssignmentIds,
        nextReassignedStaffIds
      );
      if (candidate) return candidate;
    }
    return null;
  };

  const initiallyVacatedAssignmentIds = new Set(
    mutable
      .filter(
        (assignment) =>
          requiredIds.has(assignment.id) && !initial.get(assignment.id)
      )
      .map((assignment) => assignment.id)
  );
  return search(initial, initiallyVacatedAssignmentIds, new Set());
}

function buildCandidates(
  state: AppState,
  assignments: Assignment[],
  date: string,
  lockedAssignmentIds: ReadonlySet<string>,
  facts: ScheduleRunFacts
): ConcurrentSupervisionCandidate[] {
  const vacancies = assignments.filter((assignment) => {
    const rule = assignmentRule(state, assignment);
    return (
      assignment.status === "unfilled" &&
      rule?.category === "常规" &&
      !rule.manual
    );
  });
  if (!vacancies.length) return [];
  const supervisors = assignments.filter((assignment) => {
    const rule = assignmentRule(state, assignment);
    const flight = state.flights.find(
      (item) => item.id === assignment.flightId
    );
    return (
      assignment.status === "assigned" &&
      assignment.staffId &&
      !lockedAssignmentIds.has(assignment.id) &&
      isConcurrentSupervisor(rule, flight)
    );
  });
  const leaders = state.staff.filter(
    (person) =>
      person.teamLeader &&
      person.status === "正常" &&
      person.staffType === "常规"
  );
  const candidates: ConcurrentSupervisionCandidate[] = [];

  for (let leftIndex = 0; leftIndex < supervisors.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < supervisors.length;
      rightIndex += 1
    ) {
      const pair = [supervisors[leftIndex]!, supervisors[rightIndex]!] as const;
      if (pair[0].flightId === pair[1].flightId) continue;
      const overlap = overlapMinutes(state, pair[0], pair[1]);
      if (
        overlap <= 0 ||
        overlap >
          state.settings.teamLeaderConcurrentSupervisionMaxOverlapMinutes
      )
        continue;
      for (const leader of leaders) {
        if (
          !pair.every((assignment) =>
            eligibleForAssignment(state, leader, assignment)
          )
        )
          continue;
        for (const vacancy of vacancies) {
          if (lockedAssignmentIds.has(vacancy.id)) continue;
          const direct = directCandidates(
            state,
            assignments,
            leader,
            pair,
            vacancy,
            overlap,
            date,
            lockedAssignmentIds,
            facts
          );
          candidates.push(...direct);
          if (!direct.length) {
            const relocated = relocationCandidate(
              state,
              assignments,
              leader,
              pair,
              vacancy,
              overlap,
              date,
              lockedAssignmentIds,
              facts
            );
            if (relocated) candidates.push(relocated);
          }
        }
      }
    }
  }
  return candidates;
}

function applyCandidate(
  state: AppState,
  candidate: ConcurrentSupervisionCandidate,
  lockedAssignmentIds: Set<string>
): string {
  const [left, right] = candidate.supervisorAssignments;
  const leftFlight = state.flights.find(
    (flight) => flight.id === left.flightId
  )!;
  const rightFlight = state.flights.find(
    (flight) => flight.id === right.flightId
  )!;
  const vacancyFlight = state.flights.find(
    (flight) => flight.id === candidate.vacancy.flightId
  )!;
  const reassigned = candidate.changes
    .filter(
      (change) =>
        !candidate.supervisorAssignments.some(
          (assignment) => assignment.id === change.assignment.id
        )
    )
    .map(
      (change) =>
        `${change.assignment.flightNo}/${change.assignment.position}由${change.person.name}补位`
    )
    .join("，");
  const message = `分队长并行督导补缺：${candidate.leader.name}同时承担${leftFlight.flightNo}/${left.position}与${rightFlight.flightNo}/${right.position}（重叠${candidate.overlapMinutes}分钟），通过安全重排补齐${vacancyFlight.flightNo}/${candidate.vacancy.position}；${reassigned}，未产生其他岗位空缺。`;
  const decision = schedulingDecision(
    "team-leader-concurrent-supervision",
    "selected",
    message
  );

  for (const change of candidate.changes) {
    change.assignment.staffId = change.person.id;
    change.assignment.staffName = change.person.name;
    change.assignment.startTime = change.startTime;
    change.assignment.endTime = change.endTime;
    change.assignment.workHours = change.workHours;
    change.assignment.status = "assigned";
    delete change.assignment.systemNotes;
    appendAssignmentDecision(change.assignment, decision);
    lockedAssignmentIds.add(change.assignment.id);
  }
  return message;
}

export function fillVacancyWithTeamLeaderConcurrentSupervision(
  state: AppState,
  assignments: Assignment[],
  date: string,
  lockedAssignmentIds: Set<string>,
  facts: ScheduleRunFacts
): string[] {
  const messages: string[] = [];
  while (true) {
    const candidate = buildCandidates(
      state,
      assignments,
      date,
      lockedAssignmentIds,
      facts
    ).sort(
      (left, right) =>
        right.vacancyReduction - left.vacancyReduction ||
        left.leaderHours - right.leaderHours ||
        left.leaderFatigue - right.leaderFatigue ||
        left.staffOrder - right.staffOrder ||
        left.changes.length - right.changes.length ||
        left.stableKey.localeCompare(right.stableKey)
    )[0];
    if (!candidate) break;
    messages.push(applyCandidate(state, candidate, lockedAssignmentIds));
  }
  return messages;
}
