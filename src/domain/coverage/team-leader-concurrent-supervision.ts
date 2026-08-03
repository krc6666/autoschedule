import type { AppState, Assignment } from "../../model";
import { appendAssignmentDecision } from "../assignments/assignment-evidence";
import { assignmentRule } from "../flights/schedule-position-rules";
import { schedulingDecision } from "../rules/schedule-rule-contract";
import type { ScheduleRunFacts } from "../shared/schedule-run-facts";
import type { SolverPort } from "../solver/solver-port";
import {
  concurrentOverlapMinutes,
  findConcurrentSupervisionPlan,
  isConcurrentSupervisor,
  type ConcurrentSupervisionCandidate,
} from "./team-leader-concurrent-plan";

async function buildCandidates(
  solver: SolverPort,
  state: AppState,
  assignments: Assignment[],
  date: string,
  lockedAssignmentIds: ReadonlySet<string>,
  facts: ScheduleRunFacts
): Promise<ConcurrentSupervisionCandidate[]> {
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
    return Boolean(
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
      const overlapMinutes = concurrentOverlapMinutes(state, pair[0], pair[1]);
      if (
        overlapMinutes <= 0 ||
        overlapMinutes >
          state.settings.teamLeaderConcurrentSupervisionMaxOverlapMinutes
      )
        continue;
      for (const leader of leaders) {
        for (const vacancy of vacancies) {
          if (lockedAssignmentIds.has(vacancy.id)) continue;
          const candidate = await findConcurrentSupervisionPlan({
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
          });
          if (candidate) candidates.push(candidate);
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
          (assignment) => assignment.id === change.assignmentId
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
    lockedAssignmentIds.add(change.assignment.id);
  }
  const affectedAssignments = new Map(
    [
      ...candidate.supervisorAssignments,
      candidate.vacancy,
      ...candidate.changes.map((change) => change.assignment),
    ].map((assignment) => [assignment.id, assignment])
  );
  affectedAssignments.forEach((assignment) =>
    appendAssignmentDecision(assignment, decision)
  );
  return message;
}

export async function fillVacancyWithTeamLeaderConcurrentSupervision(
  solver: SolverPort,
  state: AppState,
  assignments: Assignment[],
  date: string,
  lockedAssignmentIds: Set<string>,
  facts: ScheduleRunFacts
): Promise<string[]> {
  const messages: string[] = [];
  while (true) {
    const candidate = (
      await buildCandidates(
        solver,
        state,
        assignments,
        date,
        lockedAssignmentIds,
        facts
      )
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
